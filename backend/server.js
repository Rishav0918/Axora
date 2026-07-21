const express = require('express');
const Razorpay = require('razorpay');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Debug logs to verify .env credentials
console.log('EMAIL_USER =', process.env.EMAIL_USER);
console.log('EMAIL_PASS =', process.env.EMAIL_PASS);
console.log('PASS LENGTH =', process.env.EMAIL_PASS?.length);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// OTP Storage with Expiry
const pendingOtps = new Map();

// OTP Delivery Logs
const otpLogs = [];

// Active Sessions
const activeSessions = new Map();

// Login History
const loginHistory = [];

// System Health Metrics
const systemMetrics = {
  otpSentCount: 0,
  otpVerifiedCount: 0,
  loginAttempts: 0,
  failedLogins: 0,
  blockedUsers: 0,
  systemStartTime: new Date()
};

// Executive Availability Management
const executives = new Map();
const chatQueue = [];
const activeChats = new Map();

// Initialize executives (in production, this would come from database)
const initializeExecutives = () => {
  // Sample executives - in production, load from database
  executives.set('exec1', {
    id: 'exec1',
    name: 'Executive 1',
    email: 'exec1@axorasoft.com',
    isAvailable: true,
    currentChat: null,
    totalChats: 0,
    averageChatDuration: 5 // minutes
  });
  executives.set('exec2', {
    id: 'exec2',
    name: 'Executive 2',
    email: 'exec2@axorasoft.com',
    isAvailable: true,
    currentChat: null,
    totalChats: 0,
    averageChatDuration: 6 // minutes
  });
  executives.set('exec3', {
    id: 'exec3',
    name: 'Executive 3',
    email: 'exec3@axorasoft.com',
    isAvailable: false,
    currentChat: null,
    totalChats: 0,
    averageChatDuration: 7 // minutes
  });
};

initializeExecutives();

// Calculate estimated wait time
function calculateWaitTime() {
  const availableExecutives = Array.from(executives.values()).filter(e => e.isAvailable);
  
  if (availableExecutives.length > 0) {
    return 0; // Immediate connection
  }
  
  // Calculate based on queue length and average chat duration
  const queueLength = chatQueue.length;
  const avgDuration = Array.from(executives.values())
    .reduce((sum, e) => sum + e.averageChatDuration, 0) / executives.size;
  
  return Math.ceil(queueLength * avgDuration); // minutes
}

// Assign executive to chat
function assignExecutive(userId, userEmail) {
  const availableExecutives = Array.from(executives.values()).filter(e => e.isAvailable);
  
  if (availableExecutives.length > 0) {
    // Assign to first available executive (could use smarter algorithm)
    const executive = availableExecutives[0];
    executive.isAvailable = false;
    executive.currentChat = userId;
    executive.totalChats++;
    
    activeChats.set(userId, {
      executiveId: executive.id,
      executiveName: executive.name,
      startTime: Date.now(),
      userEmail: userEmail
    });
    
    return executive;
  }
  
  // No available executives, add to queue
  chatQueue.push({
    userId,
    userEmail,
    queueTime: Date.now()
  });
  
  return null;
}

// Release executive after chat ends
function releaseExecutive(userId) {
  const chat = activeChats.get(userId);
  if (chat) {
    const executive = executives.get(chat.executiveId);
    if (executive) {
      executive.isAvailable = true;
      executive.currentChat = null;
      
      // Update average chat duration
      const duration = (Date.now() - chat.startTime) / 60000; // minutes
      executive.averageChatDuration = (executive.averageChatDuration * 0.8) + (duration * 0.2);
    }
    
    activeChats.delete(userId);
    
    // Assign next person in queue
    if (chatQueue.length > 0) {
      const nextInQueue = chatQueue.shift();
      assignExecutive(nextInQueue.userId, nextInQueue.userEmail);
    }
  }
}

// Auto-delete expired OTPs
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of pendingOtps.entries()) {
    if (data.expiresAt && now > data.expiresAt) {
      pendingOtps.delete(key);
    }
  }
}, 60000); // Check every minute

// Rate Limiting
const rateLimit = require('express-rate-limit');

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 OTP requests per window
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login attempts per window
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('../frontend'));

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: false, unique: false },
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  loginCount: { type: Number, default: 0 },
  isBlocked: { type: Boolean, default: false },
  blockReason: { type: String },
  blockedAt: { type: Date },
  cart: [{
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, default: 1 },
    image: { type: String },
    addedAt: { type: Date, default: Date.now }
  }],
  orders: [{
    orderId: { type: String, required: true },
    items: [{
      productId: { type: String },
      name: { type: String },
      price: { type: Number },
      quantity: { type: Number }
    }],
    totalAmount: { type: Number },
    status: { 
      type: String, 
      enum: ['pending', 'confirmed', 'preparing', 'building', 'ready', 'completed', 'cancelled'],
      default: 'pending' 
    },
    customization: {
      type: String,
      default: ''
    },
    shippingAddress: {
      fullname: String,
      email: String,
      phone: String,
      street: String,
      city: String,
      state: String,
      zipcode: String,
      country: String
    },
    paymentId: String,
    razorpayOrderId: String,
    downloadLink: String,
    trackingHistory: [{
      status: String,
      timestamp: { type: Date, default: Date.now },
      note: String
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }]
});

const User = mongoose.model('User', userSchema);

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// SMTP Verification
transporter.verify((error, success) => {
  if (error) {
    console.log(error);
  } else {
    console.log('SMTP READY');
  }
});

app.post('/create-order', async (req, res) => {
  try {
    const amount = req.body.amount;
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const options = {
      amount,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1
    };

    console.log('Creating Razorpay order with options:', options);
    const order = await razorpay.orders.create(options);
    console.log('Razorpay order created successfully:', order.id);
    return res.json({ order });
  } catch (error) {
    console.error('Create order failed:', error.message);
    console.error('Full error:', error);
    return res.status(500).json({ error: 'Unable to create order: ' + error.message });
  }
});

app.post('/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: 'Missing payment verification fields' });
  }

  const generated_signature = crypto
    .createHmac('sha256', razorpay.key_secret)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if (generated_signature === razorpay_signature) {
    return res.json({ success: true });
  }

  return res.status(400).json({ success: false, error: 'Invalid signature' });
});

const sendOTP = async (phone) => {
  try {
    console.log(`Sending OTP to: 91${phone}`);

    const response = await axios.post(
      "https://control.msg91.com/api/v5/otp",
      {
        mobile: `91${phone}`,
        template_id: process.env.MSG91_TEMPLATE_ID,
        otp_length: 6
      },
      {
        headers: {
          authkey: process.env.MSG91_AUTH_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("MSG91 Success:", response.data);

    return response.data;

  } catch (err) {
    console.log("MSG91 Error:", err.response?.data || err.message);
    throw err;
  }
};

// Gmail OTP SEND (Primary - User wants only Gmail OTP)
app.post("/send-email-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address"
      });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    console.log(`Sending email OTP to: ${email}, OTP: ${otp}`);

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Your Axora Soft OTP Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; border-radius: 10px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">Axora Soft</h1>
            <h2 style="margin: 20px 0 10px 0; font-size: 20px;">Email Verification</h2>
            <p style="margin: 10px 0; font-size: 16px;">Your verification code is:</p>
            <div style="background: white; color: #667eea; font-size: 32px; font-weight: bold; padding: 20px; border-radius: 5px; display: inline-block; margin: 20px 0;">
              ${otp}
            </div>
            <p style="margin: 10px 0; font-size: 14px; opacity: 0.8;">This code will expire in 10 minutes.</p>
            <p style="margin: 30px 0 0 0; font-size: 12px; opacity: 0.7;">© 2026 Axora Soft. All rights reserved.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    // Store OTP with expiry (5 minutes)
    pendingOtps.set(email, {
      otp: otp,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes from now
    });

    res.json({
      success: true,
      message: "OTP sent successfully via email"
    });

  } catch (error) {
    console.log('Email OTP Error:', error.message);

    res.status(500).json({
      success: false,
      message: "Failed to send email OTP",
    });
  }
});

// MSG91 OTP VERIFY
app.post("/verify-otp", async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    const response = await axios.get(
      `https://control.msg91.com/api/v5/otp/verify?mobile=91${mobile}&otp=${otp}`,
      {
        headers: {
          authkey: process.env.MSG91_AUTH_KEY,
        },
      }
    );

    if (response.data.type === "success") {
      // Update user verification status in MongoDB
      await User.findOneAndUpdate(
        { mobile: `91${mobile}` },
        { verified: true }
      );

      return res.json({
        success: true,
        message: "OTP verified successfully"
      });
    }

    return res.status(400).json({
      success: false,
      message: "Invalid OTP"
    });

  } catch (error) {
    console.log(error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: "OTP verification failed",
    });
  }
});

// Email OTP VERIFY
app.post("/verify-email-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Input validation
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required"
      });
    }

    // Email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }

    // OTP format validation (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "OTP must be 6 digits"
      });
    }

    // Verify OTP against stored pending OTP
    const storedOtpData = pendingOtps.get(email);
    
    if (!storedOtpData) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found. Please request a new OTP."
      });
    }

    // Check OTP expiry
    if (Date.now() > storedOtpData.expiresAt) {
      // Remove expired OTP
      pendingOtps.delete(email);
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new OTP."
      });
    }

    if (otp === storedOtpData.otp) {
      // Check if user exists
      let user = await User.findOne({ email });
      
      if (!user) {
        // Create user if doesn't exist
        const hashedPassword = await bcrypt.hash("defaultPassword123", 10);
        user = new User({
          name: email.split('@')[0], // Use email prefix as name
          email,
          password: hashedPassword,
          verified: true
        });
        await user.save();
        console.log(`New user created: ${email}`);
      } else {
        // Update existing user verification status
        await User.findOneAndUpdate(
          { email },
          { verified: true }
        );
        console.log(`User verified: ${email}`);
      }

      // Remove OTP after successful verification
      pendingOtps.delete(email);

      // Log successful verification
      otpLogs.push({
        email,
        status: 'verified',
        timestamp: new Date(),
        ip: req.ip || 'unknown'
      });
      systemMetrics.otpVerifiedCount++;

      // Generate JWT token with 24h expiry
      const token = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );

      // Generate refresh token with 7d expiry
      const refreshToken = jwt.sign(
        { userId: user._id, type: 'refresh' },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      return res.json({
        success: true,
        message: "Email OTP verified successfully",
        token,
        refreshToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          verified: true
        }
      });
    }

    // Log failed verification attempt
    console.log(`Failed OTP verification attempt for ${email}: ${otp}`);

    return res.status(400).json({
      success: false,
      message: "Invalid OTP. Please check your email and try again."
    });

  } catch (error) {
    console.error('OTP verification error:', error);

    res.status(500).json({
      success: false,
      message: "Email OTP verification failed. Please try again.",
    });
  }
});
app.post("/send-email-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Valid email address is required"
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Your Axora Soft OTP Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; border-radius: 10px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">Axora Soft</h1>
            <h2 style="margin: 20px 0 10px 0; font-size: 20px;">Email Verification</h2>
            <p style="margin: 10px 0; font-size: 16px;">Your verification code is:</p>
            <div style="background: white; color: #667eea; font-size: 32px; font-weight: bold; padding: 20px; border-radius: 5px; display: inline-block; margin: 20px 0;">
              ${otp}
            </div>
            <p style="margin: 10px 0; font-size: 14px; opacity: 0.8;">This code will expire in 10 minutes.</p>
            <p style="margin: 30px 0 0 0; font-size: 12px; opacity: 0.7;"> 2026 Axora Soft. All rights reserved.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    // Store OTP with expiry (5 minutes)
    pendingOtps.set(email, {
      otp: otp,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes from now
    });

    // Log OTP delivery
    otpLogs.push({
      email,
      otp: otp.substring(0, 3) + '***', // Partial OTP for security
      status: 'sent',
      timestamp: new Date(),
      ip: clientIP
    });

    // Update metrics
    systemMetrics.otpSentCount++;

    res.json({
      success: true,
      message: "OTP sent successfully via email"
    });

  } catch (error) {
    console.log('Email OTP Error:', error.message);

    // Log failed OTP
    otpLogs.push({
      email: email || 'unknown',
      status: 'failed',
      timestamp: new Date(),
      ip: req.ip || 'unknown',
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: "Failed to send email OTP",
    });
  }
});

// Password Reset - Send OTP
app.post("/send-reset-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Valid email address is required"
      });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email"
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Password Reset OTP - Axora Soft',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; border-radius: 10px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">Axora Soft</h1>
            <h2 style="margin: 20px 0 10px 0; font-size: 20px;">Password Reset</h2>
            <p style="margin: 10px 0; font-size: 16px;">Your password reset code is:</p>
            <div style="background: white; color: #667eea; font-size: 32px; font-weight: bold; padding: 20px; border-radius: 5px; display: inline-block; margin: 20px 0;">
              ${otp}
            </div>
            <p style="margin: 10px 0; font-size: 14px; opacity: 0.8;">This code will expire in 10 minutes.</p>
            <p style="margin: 10px 0; font-size: 12px;">If you didn't request this, please ignore this email.</p>
            <p style="margin: 30px 0 0 0; font-size: 12px; opacity: 0.7;">© 2026 Axora Soft. All rights reserved.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    // Store OTP with expiry (10 minutes) and mark as password reset
    pendingOtps.set(email, {
      otp: otp,
      expiresAt: Date.now() + 10 * 60 * 1000,
      purpose: 'password_reset'
    });

    res.json({
      success: true,
      message: "Password reset OTP sent successfully to your email"
    });

  } catch (error) {
    console.error('Password reset OTP error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to send password reset OTP"
    });
  }
});

// Password Reset - Verify OTP and Update Password
app.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Input validation
    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP, and new password are required"
      });
    }

    // Email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }

    // Password validation (minimum 6 characters)
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long"
      });
    }

    // OTP format validation (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "OTP must be 6 digits"
      });
    }

    // Verify OTP against stored pending OTP
    const storedOtpData = pendingOtps.get(email);

    if (!storedOtpData) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found. Please request a new OTP."
      });
    }

    // Check if OTP is for password reset
    if (storedOtpData.purpose !== 'password_reset') {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please request a password reset OTP."
      });
    }

    // Check OTP expiry
    if (Date.now() > storedOtpData.expiresAt) {
      pendingOtps.delete(email);
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new OTP."
      });
    }

    if (otp === storedOtpData.otp) {
      // Find user and update password
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      await User.findByIdAndUpdate(user._id, { password: hashedPassword });

      // Remove OTP after successful reset
      pendingOtps.delete(email);

      res.json({
        success: true,
        message: "Password reset successfully. Please login with your new password."
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please check your email and try again."
      });
    }

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      success: false,
      message: "Password reset failed. Please try again."
    });
  }
});

// Backend User Registration
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    // Validate input
    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    // Check if user already exists by email
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email already registered. Please login instead."
      });
    }

    // Check if user already exists by phone
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number already registered. Please login instead."
      });
    }

    // Hash password before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      phone,
      verified: false
    });

    await newUser.save();

    res.json({
      success: true,
      message: "User registered successfully",
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        verified: false
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
});

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "No token provided"
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid token"
    });
  }
};

// Login Route
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      // Log failed login attempt
      loginHistory.push({
        email,
        success: false,
        timestamp: new Date(),
        ip: clientIP,
        reason: 'User not found'
      });
      systemMetrics.failedLogins++;
      
      return res.status(400).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Check if user is blocked
    if (user.isBlocked) {
      loginHistory.push({
        email,
        success: false,
        timestamp: new Date(),
        ip: clientIP,
        reason: 'User blocked'
      });
      
      return res.status(403).json({
        success: false,
        message: "Account blocked. Please contact support."
      });
    }

    // Check if user is verified
    if (!user.verified) {
      loginHistory.push({
        email,
        success: false,
        timestamp: new Date(),
        ip: clientIP,
        reason: 'Account not verified'
      });
      
      return res.status(403).json({
        success: false,
        message: "Account not verified. Please verify your email first."
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // Log failed login attempt
      loginHistory.push({
        email,
        success: false,
        timestamp: new Date(),
        ip: clientIP,
        reason: 'Invalid password'
      });
      systemMetrics.failedLogins++;
      
      return res.status(400).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Update user login stats
    await User.findByIdAndUpdate(user._id, {
      lastLogin: new Date(),
      $inc: { loginCount: 1 }
    });

    // Generate JWT token with 24h expiry
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Generate refresh token with 7d expiry
    const refreshToken = jwt.sign(
      { userId: user._id, type: 'refresh' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    // Log successful login
    loginHistory.push({
      email,
      success: true,
      timestamp: new Date(),
      ip: clientIP
    });

    // Add to active sessions
    activeSessions.set(user._id.toString(), {
      email: user.email,
      loginTime: new Date(),
      lastActivity: new Date(),
      ip: clientIP,
      userAgent: req.headers['user-agent']
    });

    systemMetrics.loginAttempts++;

    res.json({
      success: true,
      message: "Login successful",
      token,
      refreshToken,
      tokenExpiresIn: 24 * 60 * 60, // 24 hours in seconds
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        verified: user.verified
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
});

// Protected Dashboard Route
app.get("/dashboard", authenticateToken, async (req, res) => {
  try {
    // Get user data from database
    const user = await User.findById(req.user.userId);
    
    res.json({
      success: true,
      message: "Dashboard access granted",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        verified: user.verified,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user data"
    });
  }
});

const port = process.env.PORT || 3000;
const host = '0.0.0.0'; // Bind to all interfaces

// Admin Routes
app.delete('/admin/clear-all-users', async (req, res) => {
  try {
    await User.deleteMany({});
    res.json({
      success: true,
      message: "All user data cleared successfully"
    });
  } catch (error) {
    console.error('Error clearing user data:', error);
    res.status(500).json({
      success: false,
      message: "Failed to clear user data"
    });
  }
});

app.delete('/admin/clear-all-otp', async (req, res) => {
  try {
    pendingOtps.clear();
    res.json({
      success: true,
      message: "All OTP data cleared successfully"
    });
  } catch (error) {
    console.error('Error clearing OTP data:', error);
    res.status(500).json({
      success: false,
      message: "Failed to clear OTP data"
    });
  }
});

app.get('/admin/system-stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const verifiedUsers = await User.countDocuments({ verified: true });
    const pendingOtpsCount = pendingOtps.size;
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeString = `${uptimeHours}h ${uptimeMinutes}m`;
    
    res.json({
      success: true,
      totalUsers,
      verifiedUsers,
      pendingOtps: pendingOtpsCount,
      uptime: uptimeString,
      dbStatus: 'Connected'
    });
  } catch (error) {
    console.error('Error fetching system stats:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch system statistics"
    });
  }
});

app.get('/admin/user-analytics', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const verifiedUsers = await User.countDocuments({ verified: true });
    const unverifiedUsers = totalUsers - verifiedUsers;
    const blockedUsers = await User.countDocuments({ isBlocked: true });
    
    // New users today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: today } });
    
    // Active users (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activeUsers = await User.countDocuments({ lastLogin: { $gte: sevenDaysAgo } });
    
    // Average login count
    const loginStats = await User.aggregate([
      { $group: { _id: null, avgLoginCount: { $avg: '$loginCount' } } }
    ]);
    const avgLoginCount = loginStats.length > 0 ? Math.round(loginStats[0].avgLoginCount) : 0;
    
    res.json({
      success: true,
      totalUsers,
      verifiedUsers,
      unverifiedUsers,
      blockedUsers,
      newUsersToday,
      activeUsers,
      avgLoginCount
    });
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user analytics"
    });
  }
});

app.get('/admin/otp-logs', async (req, res) => {
  try {
    // Return last 100 logs
    const logs = otpLogs.slice(-100).reverse();
    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Error fetching OTP logs:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch OTP logs"
    });
  }
});

app.get('/admin/active-sessions', async (req, res) => {
  try {
    const sessions = Array.from(activeSessions.values()).map(session => ({
      ...session,
      loginTime: session.loginTime,
      lastActivity: session.lastActivity
    }));
    
    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    console.error('Error fetching active sessions:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch active sessions"
    });
  }
});

app.get('/admin/login-history', async (req, res) => {
  try {
    // Return last 50 login attempts
    const history = loginHistory.slice(-50).reverse();
    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Error fetching login history:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch login history"
    });
  }
});

app.get('/admin/verification-metrics', async (req, res) => {
  try {
    const totalSent = systemMetrics.otpSentCount;
    const totalVerified = systemMetrics.otpVerifiedCount;
    const successRate = totalSent > 0 ? Math.round((totalVerified / totalSent) * 100) : 0;
    const failedAttempts = loginHistory.filter(log => !log.success && log.reason === 'Invalid OTP').length;
    
    // Calculate average verification time (mock data for now)
    const avgVerificationTime = 45; // seconds
    
    // Count expired OTPs
    const expiredOtps = otpLogs.filter(log => log.status === 'expired').length;
    
    // Today's verification rate
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOtps = otpLogs.filter(log => new Date(log.timestamp) >= today);
    const todayVerified = todayOtps.filter(log => log.status === 'verified').length;
    const todayRate = todayOtps.length > 0 ? Math.round((todayVerified / todayOtps.length) * 100) : 0;
    
    res.json({
      success: true,
      totalSent,
      totalVerified,
      successRate,
      failedAttempts,
      avgVerificationTime,
      expiredOtps,
      todayRate
    });
  } catch (error) {
    console.error('Error fetching verification metrics:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch verification metrics"
    });
  }
});

app.get('/admin/system-health', async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const memoryUsage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeString = `${uptimeHours}h ${uptimeMinutes}m`;
    
    // Mock CPU usage (would need actual monitoring in production)
    const cpuUsage = Math.round(Math.random() * 30 + 10); // 10-40%
    
    const activeConnections = activeSessions.size;
    
    // Mock response time
    const responseTime = Math.round(Math.random() * 50 + 20); // 20-70ms
    
    // Calculate error rate
    const totalRequests = systemMetrics.loginAttempts + systemMetrics.otpSentCount;
    const errorRate = totalRequests > 0 ? Math.round((systemMetrics.failedLogins / totalRequests) * 100) : 0;
    
    res.json({
      success: true,
      memoryUsage,
      cpuUsage,
      uptime: uptimeString,
      activeConnections,
      responseTime,
      errorRate
    });
  } catch (error) {
    console.error('Error fetching system health:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch system health"
    });
  }
});

app.post('/admin/manage-user-blocking', async (req, res) => {
  try {
    const { email, block } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    if (block) {
      // Block user
      await User.findByIdAndUpdate(user._id, {
        isBlocked: true,
        blockedAt: new Date(),
        blockReason: 'Blocked by admin'
      });
      
      // Remove from active sessions
      activeSessions.delete(user._id.toString());
      
      res.json({
        success: true,
        message: "User blocked successfully"
      });
    } else {
      // Unblock user
      await User.findByIdAndUpdate(user._id, {
        isBlocked: false,
        blockReason: null,
        blockedAt: null
      });
      
      res.json({
        success: true,
        message: "User unblocked successfully"
      });
    }
  } catch (error) {
    console.error('Error managing user blocking:', error);
    res.status(500).json({
      success: false,
      message: "Failed to manage user blocking"
    });
  }
});

app.get('/admin/export-users', async (req, res) => {
  try {
    const users = await User.find({}, { _id: 0, password: 0 }); // Exclude password
    const csvData = [
      'Name,Email,Phone,Verified,Created At,Last Login,Login Count,Blocked',
      ...users.map(user => 
        `"${user.name}","${user.email}","${user.phone || ''}","${user.verified}","${user.createdAt}","${user.lastLogin || ''}","${user.loginCount}","${user.isBlocked || false}"`
      )
    ].join('\n');
    
    res.json({
      success: true,
      csvData
    });
  } catch (error) {
    console.error('Error exporting user data:', error);
    res.status(500).json({
      success: false,
      message: "Failed to export user data"
    });
  }
});

// ===== CART & ORDER API ENDPOINTS =====

// GET /api/cart - Get user's cart
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({
      success: true,
      cart: user.cart || [],
      itemCount: user.cart ? user.cart.reduce((sum, item) => sum + item.quantity, 0) : 0,
      totalPrice: user.cart ? user.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0) : 0
    });
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch cart' });
  }
});

// POST /api/cart - Add item to cart
app.post('/api/cart', authenticateToken, async (req, res) => {
  try {
    const { productId, name, price, quantity = 1, image } = req.body;
    if (!productId || !name || price == null) {
      return res.status(400).json({ success: false, message: 'Missing product details' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.cart) user.cart = [];

    const existingItem = user.cart.find(item => item.productId === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      user.cart.push({ productId, name, price, quantity, image, addedAt: new Date() });
    }

    await user.save();
    res.json({
      success: true,
      message: 'Item added to cart',
      cart: user.cart,
      itemCount: user.cart.reduce((sum, item) => sum + item.quantity, 0),
      totalPrice: user.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ success: false, message: 'Failed to add item to cart' });
  }
});

// PUT /api/cart/:productId - Update cart item quantity
app.put('/api/cart/:productId', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const item = user.cart.find(item => item.productId === productId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not in cart' });
    }

    if (quantity <= 0) {
      user.cart = user.cart.filter(item => item.productId !== productId);
    } else {
      item.quantity = quantity;
    }

    await user.save();
    res.json({
      success: true,
      message: 'Cart updated',
      cart: user.cart,
      itemCount: user.cart.reduce((sum, item) => sum + item.quantity, 0),
      totalPrice: user.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    });
  } catch (error) {
    console.error('Error updating cart:', error);
    res.status(500).json({ success: false, message: 'Failed to update cart' });
  }
});

// DELETE /api/cart/:productId - Remove item from cart
app.delete('/api/cart/:productId', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.cart = user.cart.filter(item => item.productId !== productId);
    await user.save();

    res.json({
      success: true,
      message: 'Item removed from cart',
      cart: user.cart,
      itemCount: user.cart.reduce((sum, item) => sum + item.quantity, 0),
      totalPrice: user.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    });
  } catch (error) {
    console.error('Error removing from cart:', error);
    res.status(500).json({ success: false, message: 'Failed to remove item' });
  }
});

// DELETE /api/cart - Clear entire cart
app.delete('/api/cart', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.cart = [];
    await user.save();

    res.json({
      success: true,
      message: 'Cart cleared',
      cart: [],
      itemCount: 0,
      totalPrice: 0
    });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({ success: false, message: 'Failed to clear cart' });
  }
});

// POST /api/orders - Place order & clear cart
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.cart || user.cart.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const { customization, shippingAddress } = req.body;
    const totalAmount = user.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Create Razorpay Order
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // paise
      currency: "INR",
      receipt: `receipt_${Date.now()}`
    });

    const order = {
      orderId: razorpayOrder.id, // Razorpay Order ID
      razorpayOrderId: razorpayOrder.id,
      items: user.cart.map(item => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity
      })),
      totalAmount,
      status: 'pending',
      customization: customization || '',
      shippingAddress: shippingAddress || {},
      trackingHistory: [{
        status: 'pending',
        timestamp: new Date(),
        note: 'Order placed successfully'
      }],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (!user.orders) user.orders = [];
    user.orders.push(order);

    await user.save();

    res.json({
      success: true,
      message: "Order created successfully",
      key: process.env.RAZORPAY_KEY_ID,
      razorpayOrder: razorpayOrder,
      order: order
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

// GET /api/orders - Get user's orders
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      orders: user.orders || []
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// Chat API Endpoints

// GET /api/chat/status - Get chat status and wait time
app.get('/api/chat/status', (req, res) => {
  try {
    const waitTime = calculateWaitTime();
    const availableExecutives = Array.from(executives.values()).filter(e => e.isAvailable).length;
    const queuePosition = chatQueue.length;

    res.json({
      success: true,
      waitTime: waitTime,
      waitTimeText: waitTime === 0 ? 'Available now' : `${waitTime} minutes`,
      availableExecutives: availableExecutives,
      queuePosition: queuePosition,
      totalExecutives: executives.size
    });
  } catch (error) {
    console.error('Error getting chat status:', error);
    res.status(500).json({ success: false, message: 'Failed to get chat status' });
  }
});

// POST /api/ai/chat - AI Chatbot Assistant
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    // AI Response Logic (Rule-based for now, can be replaced with actual AI API)
    const lowerMessage = message.toLowerCase();
    let aiResponse = '';

    // Product-related queries
    if (lowerMessage.includes('product') || lowerMessage.includes('software') || lowerMessage.includes('game')) {
      if (lowerMessage.includes('price') || lowerMessage.includes('cost')) {
        aiResponse = "Our products range from $50 to $500 depending on the complexity. Game source codes start at $50, website templates at $100, and custom software solutions at $300+. You can view detailed pricing on our Products page.";
      } else if (lowerMessage.includes('recommend') || lowerMessage.includes('suggest') || lowerMessage.includes('best')) {
        aiResponse = "Based on popular demand, I'd recommend our Unity Game Source Codes for beginners, and our Custom Website Solutions for businesses. For specific recommendations, could you tell me more about your project requirements?";
      } else {
        aiResponse = "We offer a wide range of products including Unity game source codes, website templates, custom software solutions, mobile app templates, and UI/UX design kits. Each product comes with full documentation and support.";
      }
    }
    // Order-related queries
    else if (lowerMessage.includes('order') || lowerMessage.includes('delivery') || lowerMessage.includes('shipping')) {
      if (lowerMessage.includes('track') || lowerMessage.includes('status')) {
        aiResponse = "You can track your order status in your dashboard under the Order History section. Each order shows real-time tracking with status updates from 'Pending' to 'Completed'.";
      } else if (lowerMessage.includes('cancel') || lowerMessage.includes('refund')) {
        aiResponse = "For order cancellations or refunds, please contact our support team through the Live Chat or email us at support@axorasoft.com. Our team will assist you within 24 hours.";
      } else {
        aiResponse = "Orders are typically processed within 1-2 business days. Custom software projects may take 3-7 days depending on complexity. You'll receive email notifications at each stage.";
      }
    }
    // Support-related queries
    else if (lowerMessage.includes('help') || lowerMessage.includes('support') || lowerMessage.includes('issue')) {
      aiResponse = "I'm here to help! You can reach our support team through Live Chat (available during business hours), email us at support@axorasoft.com, or call us at +91-6299867638. For urgent issues, Live Chat is recommended.";
    }
    // Account-related queries
    else if (lowerMessage.includes('account') || lowerMessage.includes('login') || lowerMessage.includes('password')) {
      if (lowerMessage.includes('password') || lowerMessage.includes('reset')) {
        aiResponse = "To reset your password, click 'Forgot Password' on the login page. You'll receive an OTP via email to verify your identity and set a new password.";
      } else if (lowerMessage.includes('register') || lowerMessage.includes('sign up')) {
        aiResponse = "You can create an account by clicking 'Sign Up' on the login page. Registration requires your name, email, phone number, and password. Email verification is required for account activation.";
      } else {
        aiResponse = "You can manage your account settings, view order history, track orders, and update your profile from the dashboard. Navigate to different sections using the sidebar menu.";
      }
    }
    // Customization queries
    else if (lowerMessage.includes('custom') || lowerMessage.includes('customize') || lowerMessage.includes('modify')) {
      aiResponse = "Yes, we offer customization services! During checkout, you can specify your customization requirements in the dedicated field. Our team will review your needs and provide a quote if additional costs apply.";
    }
    // Payment queries
    else if (lowerMessage.includes('payment') || lowerMessage.includes('pay') || lowerMessage.includes('razorpay')) {
      aiResponse = "We accept payments through Razorpay, supporting credit/debit cards, UPI, net banking, and popular wallets. All transactions are secure and encrypted. You'll receive payment confirmation via email.";
    }
    // Greeting
    else if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
      aiResponse = "Hello! I'm your AI assistant at Axora Soft. How can I help you today? I can assist with product information, order tracking, account issues, and general support questions.";
    }
    // Thank you
    else if (lowerMessage.includes('thank')) {
      aiResponse = "You're welcome! If you need any further assistance, feel free to ask. Have a great day!";
    }
    // Default response
    else {
      aiResponse = "I understand you have a question. For more specific assistance, please provide more details about what you're looking for, or contact our support team directly through Live Chat or email at support@axorasoft.com.";
    }

    res.json({
      success: true,
      response: aiResponse,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ success: false, message: 'Failed to process AI chat' });
  }
});

// GET /api/ai/recommendations - AI-powered product recommendations
app.get('/api/ai/recommendations', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Analyze user behavior for recommendations
    const userOrders = user.orders || [];
    const userCart = user.cart || [];
    
    // Simple recommendation logic based on order history
    let recommendations = [];
    const purchasedCategories = new Set();
    
    userOrders.forEach(order => {
      order.items.forEach(item => {
        if (item.name.toLowerCase().includes('game')) purchasedCategories.add('games');
        if (item.name.toLowerCase().includes('website') || item.name.toLowerCase().includes('web')) purchasedCategories.add('websites');
        if (item.name.toLowerCase().includes('app') || item.name.toLowerCase().includes('mobile')) purchasedCategories.add('apps');
        if (item.name.toLowerCase().includes('software') || item.name.toLowerCase().includes('custom')) purchasedCategories.add('software');
      });
    });

    // Generate recommendations based on categories
    if (purchasedCategories.has('games')) {
      recommendations.push({
        id: 'rec1',
        name: 'Advanced Unity Game Bundle',
        description: 'Complete game development bundle with 50+ source codes',
        price: 299,
        category: 'games',
        reason: 'Based on your game purchases'
      });
    }
    
    if (purchasedCategories.has('websites')) {
      recommendations.push({
        id: 'rec2',
        name: 'Premium Website Templates Pack',
        description: '20+ professional website templates with full source code',
        price: 199,
        category: 'websites',
        reason: 'Complementary to your website purchases'
      });
    }

    if (purchasedCategories.has('software')) {
      recommendations.push({
        id: 'rec3',
        name: 'Enterprise Software Suite',
        description: 'Complete business management software solution',
        price: 499,
        category: 'software',
        reason: 'Upgrade for your software needs'
      });
    }

    // Default recommendations for new users
    if (recommendations.length === 0) {
      recommendations = [
        {
          id: 'rec4',
          name: 'Starter Bundle',
          description: 'Perfect for beginners - includes basic game and website templates',
          price: 149,
          category: 'bundle',
          reason: 'Popular choice for new users'
        },
        {
          id: 'rec5',
          name: 'Unity Game Masterclass',
          description: 'Complete game development course with source codes',
          price: 99,
          category: 'education',
          reason: 'Learn game development'
        }
      ];
    }

    res.json({
      success: true,
      recommendations: recommendations,
      userCategories: Array.from(purchasedCategories)
    });
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ success: false, message: 'Failed to get recommendations' });
  }
});

// POST /api/chat/join - Join chat queue
app.post('/api/chat/join', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const userId = email; // Use email as user ID for simplicity
    const executive = assignExecutive(userId, email);

    if (executive) {
      res.json({
        success: true,
        status: 'connected',
        message: 'Connected to executive',
        executive: {
          id: executive.id,
          name: executive.name
        },
        waitTime: 0
      });
    } else {
      const waitTime = calculateWaitTime();
      const queuePosition = chatQueue.length;

      res.json({
        success: true,
        status: 'queued',
        message: 'Added to queue',
        queuePosition: queuePosition,
        waitTime: waitTime,
        waitTimeText: `${waitTime} minutes`
      });
    }
  } catch (error) {
    console.error('Error joining chat:', error);
    res.status(500).json({ success: false, message: 'Failed to join chat' });
  }
});

// POST /api/chat/leave - Leave chat queue
app.post('/api/chat/leave', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const userId = email;

    // Remove from queue if queued
    const queueIndex = chatQueue.findIndex(q => q.userId === userId);
    if (queueIndex !== -1) {
      chatQueue.splice(queueIndex, 1);
    }

    // Release executive if in active chat
    releaseExecutive(userId);

    res.json({
      success: true,
      message: 'Left chat successfully'
    });
  } catch (error) {
    console.error('Error leaving chat:', error);
    res.status(500).json({ success: false, message: 'Failed to leave chat' });
  }
});

// GET /api/chat/executives - Get all executives status (for admin)
app.get('/api/chat/executives', (req, res) => {
  try {
    const execList = Array.from(executives.values()).map(e => ({
      id: e.id,
      name: e.name,
      isAvailable: e.isAvailable,
      currentChat: e.currentChat,
      totalChats: e.totalChats,
      averageChatDuration: e.averageChatDuration
    }));

    res.json({
      success: true,
      executives: execList
    });
  } catch (error) {
    console.error('Error getting executives:', error);
    res.status(500).json({ success: false, message: 'Failed to get executives' });
  }
});

// Order Management Endpoints

// PUT /api/orders/:orderId/status - Update order status (admin)
app.put('/api/orders/:orderId/status', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, note, downloadLink } = req.body;

    const validStatuses = ['pending', 'confirmed', 'preparing', 'building', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const order = user.orders.find(o => o.orderId === orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Update status and add tracking history
    order.status = status;
    order.trackingHistory.push({
      status: status,
      timestamp: new Date(),
      note: note || `Order status updated to ${status}`
    });

    // Add download link if provided
    if (downloadLink && status === 'completed') {
      order.downloadLink = downloadLink;
    }

    order.updatedAt = new Date();

    await user.save();

    res.json({
      success: true,
      message: 'Order status updated successfully',
      order: order
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

// GET /api/orders/:orderId/receipt - Generate order receipt
app.get('/api/orders/:orderId/receipt', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const order = user.orders.find(o => o.orderId === orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Generate receipt HTML
    const receiptHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Order Receipt - ${order.orderId}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
    .receipt { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; border-bottom: 2px solid #00c6ff; padding-bottom: 20px; margin-bottom: 20px; }
    .header h1 { color: #00c6ff; margin: 0; }
    .order-info { background: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .order-info p { margin: 5px 0; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .items-table th, .items-table td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    .items-table th { background: #00c6ff; color: white; }
    .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 20px; }
    .status { text-align: center; padding: 10px; border-radius: 5px; margin-top: 20px; font-weight: bold; }
    .status.pending { background: #fff3cd; color: #856404; }
    .status.confirmed { background: #d1ecf1; color: #0c5460; }
    .status.preparing { background: #d4edda; color: #155724; }
    .status.building { background: #cce5ff; color: #004085; }
    .status.ready { background: #e2e3e5; color: #383d41; }
    .status.completed { background: #d4edda; color: #155724; }
    .status.cancelled { background: #f8d7da; color: #721c24; }
    .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>🧾 Order Receipt</h1>
      <p>Axora Soft</p>
    </div>
    
    <div class="order-info">
      <p><strong>Order ID:</strong> ${order.orderId}</p>
      <p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
      <p><strong>Status:</strong> ${order.status.toUpperCase()}</p>
      ${order.customization ? `<p><strong>Customization:</strong> ${order.customization}</p>` : ''}
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th>Product</th>
          <th>Price</th>
          <th>Quantity</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${order.items.map(item => `
          <tr>
            <td>${item.name}</td>
            <td>$${item.price}</td>
            <td>${item.quantity}</td>
            <td>$${(item.price * item.quantity).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="total">
      Total: $${order.totalAmount.toFixed(2)}
    </div>

    <div class="status ${order.status}">
      Current Status: ${order.status.toUpperCase()}
    </div>

    ${order.downloadLink ? `
      <div style="text-align: center; margin-top: 20px;">
        <a href="${order.downloadLink}" style="background: #00c6ff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Download Software</a>
      </div>
    ` : ''}

    <div class="footer">
      <p>Thank you for your order!</p>
      <p>For support, contact: support@axorasoft.com</p>
      <p>Generated on: ${new Date().toLocaleString()}</p>
    </div>
  </div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(receiptHtml);
  } catch (error) {
    console.error('Error generating receipt:', error);
    res.status(500).json({ success: false, message: 'Failed to generate receipt' });
  }
});

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
  console.log(`Local IP: http://192.168.1.37:${port}`);
  console.log(`Public IP: http://103.196.0.153:${port}`);
});

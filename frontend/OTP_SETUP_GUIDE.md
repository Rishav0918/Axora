# OTP Provider Setup Guide

## Email Provider (Gmail SMTP)

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate an App Password**:
   - Go to Google Account settings → Security → 2-Step Verification → App passwords
   - Select "Mail" for app and "Other (Custom name)" for device
   - Enter "Rishav Software" as the name
   - Copy the 16-character password generated

3. **Update your .env file**:
   ```
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-16-character-app-password
   EMAIL_FROM=Rishav Software <your-email@gmail.com>
   ```

## SMS Provider (Twilio)

1. **Create a Twilio Account**:
   - Sign up at https://www.twilio.com/
   - Verify your phone number
   - Get a trial phone number

2. **Get your credentials**:
   - Account SID: From Twilio Console → Settings → General
   - Auth Token: From Twilio Console → Settings → General
   - Phone Number: From Twilio Console → Phone Numbers → Manage Numbers

3. **Update your .env file**:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=+1234567890
   ```

## Testing

After updating the .env file:
1. Restart the server: `node server.js`
2. Test OTP sending from the signup form
3. Check the server console for any errors
4. Verify you receive OTP via email and/or SMS

## Troubleshooting

- **Gmail Issues**: Make sure you're using an App Password, not your regular password
- **Twilio Issues**: Ensure your trial account has credits and the phone number is verified
- **Port Issues**: Make sure port 3000 is not blocked by firewall

## Development Mode

If you don't want to configure providers, the system will automatically fall back to development mode where OTPs are shown in the server console.

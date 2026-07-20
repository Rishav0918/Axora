# Deployment Guide

## Frontend-Backend Configuration

The frontend is now configured to automatically switch between local and production backend URLs based on the hostname.

### Local Development
When running locally (localhost or 127.0.0.1), the frontend automatically connects to:
- **Backend URL**: `http://127.0.0.1:3000`

### Production Deployment
When deployed to a production domain, you need to update the backend URL in all frontend files.

#### Files to Update
The following files contain the API configuration that needs to be updated for production:

1. **frontend/cart.js**
2. **frontend/dashboard.html**
3. **frontend/login.html**
4. **frontend/payment.html**
5. **frontend/reset-password.html**
6. **frontend/admin-data-management.html**

#### Configuration Pattern
Each file contains this configuration block:

```javascript
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:3000'
  : 'https://your-backend-domain.com'; // Replace with your actual deployed backend URL
```

#### Steps to Configure for Production

1. **Deploy your backend** to your server/domain (e.g., `https://api.yourdomain.com` or `https://backend.yourdomain.com`)

2. **Update the API URL** in each frontend file:
   - Replace `https://your-backend-domain.com` with your actual backend URL
   - Example: `https://api.axorasoft.com` or `https://backend.axorasoft.com`

3. **Deploy the frontend** to your frontend domain (e.g., `https://www.yourdomain.com`)

4. **Test the connection**:
   - Open your deployed frontend in a browser
   - Try logging in, adding items to cart, etc.
   - Check browser console for any API connection errors

## Backend Deployment

### Environment Variables
Ensure your backend `.env` file contains all required variables:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/axorasoft
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
JWT_SECRET=your_jwt_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret
```

### MongoDB Atlas (Recommended for Production)
For production deployment, use MongoDB Atlas instead of local MongoDB:

1. Create a MongoDB Atlas account
2. Create a cluster
3. Get your connection string
4. Update `MONGODB_URI` in `.env`:
   ```
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/axorasoft
   ```

### Server Startup
```bash
cd backend
npm install
node server.js
```

## Frontend Deployment

### Static Hosting Options
You can deploy the frontend to various static hosting services:

1. **Netlify**
2. **Vercel**
3. **GitHub Pages**
4. **AWS S3 + CloudFront**
5. **Your own web server**

### Deployment Steps (General)
1. Update all API URLs in frontend files as described above
2. Upload the `frontend` folder contents to your hosting service
3. Configure your hosting to serve `index.html` as the default page
4. Set up proper routing for single-page application (SPA) behavior

## Testing Checklist

After deployment, test the following:

- [ ] User registration with email OTP verification
- [ ] User login
- [ ] Password reset functionality
- [ ] Add items to cart
- [ ] Checkout process
- [ ] Payment integration
- [ ] Order placement and tracking
- [ ] Live chat functionality
- [ ] AI assistant chat
- [ ] AI recommendations
- [ ] Order history and receipt viewing
- [ ] Admin panel functionality

## Troubleshooting

### CORS Issues
If you encounter CORS errors, ensure your backend has proper CORS configuration:

```javascript
// In server.js
app.use(cors({
  origin: ['https://your-frontend-domain.com', 'http://localhost:3000'],
  credentials: true
}));
```

### API Connection Errors
- Check that backend is running and accessible
- Verify the API URL is correct in frontend files
- Check browser console for specific error messages
- Ensure firewall/security groups allow API access

### Email OTP Not Sending
- Verify email credentials in `.env`
- Check if email provider requires app-specific password
- Ensure SMTP is not blocked by hosting provider
- Check backend logs for email sending errors

## Security Considerations

1. **Never commit `.env` files** to version control
2. **Use HTTPS** for both frontend and backend in production
3. **Keep dependencies updated** regularly
4. **Implement rate limiting** for API endpoints
5. **Use strong JWT secrets** and rotate them periodically
6. **Enable MongoDB authentication** and use strong passwords
7. **Regularly backup your database**

## Support

For issues or questions, refer to the codebase documentation or contact the development team.

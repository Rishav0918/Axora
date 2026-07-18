# Twilio Troubleshooting Guide

## Error 20003: Permission Denied

The Twilio SMS provider is returning authentication errors. Here are the possible causes and solutions:

## Common Issues

### 1. Incorrect Credentials
**Problem**: Wrong Account SID or Auth Token
**Solution**: 
- Double-check your Twilio Console → Settings → General
- Copy credentials directly (no extra spaces)
- Ensure you're using Account SID (not API Key SID)

### 2. Test vs Live Credentials
**Problem**: Using test credentials with live endpoints
**Solution**: 
- Use live Account SID and Auth Token from your main account
- Test credentials only work with specific test endpoints

### 3. Account Status
**Problem**: Account suspended or closed
**Solution**: 
- Check your Twilio account status
- Verify billing information is current
- Contact Twilio support if needed

### 4. Phone Number Verification
**Problem**: Phone number not verified or active
**Solution**: 
- Ensure your Twilio phone number is active
- Verify the number can send SMS
- Check geographic restrictions

## Current Configuration

TWILIO_ACCOUNT_SID=YOUR_TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN=YOUR_TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER=YOUR_TWILIO_PHONE_NUMBER

## Verification Steps

1. **Check Account SID**: Should start with "AC" followed by 32 characters
2. **Check Auth Token**: Should be 32 characters long
3. **Test via Twilio Console**: Try sending an SMS from the Twilio Console first
4. **Verify Phone Number**: Ensure +19015060704 is active in your Twilio account

## Alternative: Email-Only OTP

If SMS continues to fail, you can:
1. Configure only the email provider (Gmail SMTP)
2. The system will work with email OTP only
3. Remove or comment out Twilio credentials

## Development Mode

The system currently falls back to development mode where OTPs are shown in the server console. This works for testing but doesn't send real SMS.

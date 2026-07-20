// API Configuration
// Change this URL to match your deployed backend URL
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:3000'
  : 'https://your-backend-domain.com'; // Replace with your actual deployed backend URL

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { API_BASE_URL };
}

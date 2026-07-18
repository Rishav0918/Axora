// ===== CART API UTILITY =====
// Backend cart integration with JWT authentication

const API_BASE = 'http://127.0.0.1:3000';

function getToken() {
  return sessionStorage.getItem('token');
}

function isLoggedIn() {
  return sessionStorage.getItem('isLoggedIn') === 'true' && !!getToken();
}

async function apiCall(endpoint, method = 'GET', body = null) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }

  const options = {
    method,
    headers
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(API_BASE + endpoint, options);
  return response.json();
}

// --- Cart Operations ---

async function fetchCart() {
  if (!isLoggedIn()) {
    // Fallback to localStorage for guests
    const guestCart = sessionStorage.getItem('guestCart');
    return guestCart ? JSON.parse(guestCart) : [];
  }
  const data = await apiCall('/api/cart');
  return data.success ? data.cart : [];
}

async function addToCartAPI(productId, name, price, quantity = 1, image = '') {
  if (!isLoggedIn()) {
    // Fallback to localStorage for guests
    let cart = JSON.parse(sessionStorage.getItem('guestCart') || '[]');
    const existing = cart.find(item => item.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({ productId, name, price, quantity, image, addedAt: new Date().toISOString() });
    }
    sessionStorage.setItem('guestCart', JSON.stringify(cart));
    updateCartBadgeUI(cart.reduce((sum, item) => sum + item.quantity, 0));
    return { success: true, cart };
  }
  const data = await apiCall('/api/cart', 'POST', { productId, name, price, quantity, image });
  if (data.success) {
    updateCartBadgeUI(data.itemCount);
  }
  return data;
}

async function updateCartItemAPI(productId, quantity) {
  if (!isLoggedIn()) {
    let cart = JSON.parse(sessionStorage.getItem('guestCart') || '[]');
    if (quantity <= 0) {
      cart = cart.filter(item => item.productId !== productId);
    } else {
      const item = cart.find(i => i.productId === productId);
      if (item) item.quantity = quantity;
    }
    sessionStorage.setItem('guestCart', JSON.stringify(cart));
    updateCartBadgeUI(cart.reduce((sum, item) => sum + item.quantity, 0));
    return { success: true, cart };
  }
  const data = await apiCall('/api/cart/' + productId, 'PUT', { quantity });
  if (data.success) {
    updateCartBadgeUI(data.itemCount);
  }
  return data;
}

async function removeFromCartAPI(productId) {
  if (!isLoggedIn()) {
    let cart = JSON.parse(sessionStorage.getItem('guestCart') || '[]');
    cart = cart.filter(item => item.productId !== productId);
    sessionStorage.setItem('guestCart', JSON.stringify(cart));
    updateCartBadgeUI(cart.reduce((sum, item) => sum + item.quantity, 0));
    return { success: true, cart };
  }
  const data = await apiCall('/api/cart/' + productId, 'DELETE');
  if (data.success) {
    updateCartBadgeUI(data.itemCount);
  }
  return data;
}

async function clearCartAPI() {
  if (!isLoggedIn()) {
    sessionStorage.removeItem('guestCart');
    updateCartBadgeUI(0);
    return { success: true, cart: [] };
  }
  const data = await apiCall('/api/cart', 'DELETE');
  if (data.success) {
    updateCartBadgeUI(0);
  }
  return data;
}

async function placeOrderAPI() {
  if (!isLoggedIn()) {
    alert('Please login to place an order.');
    window.location.href = 'login.html';
    return { success: false };
  }
  const data = await apiCall('/api/orders', 'POST');
  if (data.success) {
    updateCartBadgeUI(0);
  }
  return data;
}

async function fetchOrdersAPI() {
  if (!isLoggedIn()) return { success: true, orders: [] };
  return await apiCall('/api/orders');
}

// --- UI Helpers ---

function updateCartBadgeUI(count) {
  const badges = document.querySelectorAll('.cart-badge, #cart-count');
  badges.forEach(badge => {
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  });
}

async function syncCartBadge() {
  if (isLoggedIn()) {
    const data = await apiCall('/api/cart');
    if (data.success) {
      updateCartBadgeUI(data.itemCount);
    }
  } else {
    const guestCart = JSON.parse(sessionStorage.getItem('guestCart') || '[]');
    const count = guestCart.reduce((sum, item) => sum + item.quantity, 0);
    updateCartBadgeUI(count);
  }
}

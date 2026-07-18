// Clear all user data from localStorage and sessionStorage
function clearAllUserData() {
    // Clear localStorage completely
    localStorage.clear();
    
    // Clear sessionStorage completely
    sessionStorage.clear();
    
    // Double-check and remove any remaining items
    try {
        // Remove specific user-related keys
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.includes('user') || key.includes('cart') || key.includes('pending') || key.includes('otp')) {
                localStorage.removeItem(key);
            }
        });
    } catch (e) {
        console.log('Error clearing localStorage:', e);
    }
    
    // Clear any remaining sessionStorage items
    try {
        const sessionKeys = Object.keys(sessionStorage);
        sessionKeys.forEach(key => {
            if (key.includes('user') || key.includes('cart') || key.includes('pending') || key.includes('otp')) {
                sessionStorage.removeItem(key);
            }
        });
    } catch (e) {
        console.log('Error clearing sessionStorage:', e);
    }
    
    // Force clear again to be sure
    localStorage.clear();
    sessionStorage.clear();
    
    console.log('All user data cleared from browser storage');
    alert('All user data has been cleared successfully!');
    
    // Reload page to ensure clean state
    setTimeout(() => {
        window.location.reload();
    }, 1000);
}

// Execute the function
clearAllUserData();

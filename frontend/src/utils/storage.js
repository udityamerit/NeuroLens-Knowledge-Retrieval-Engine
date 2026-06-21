// Memory fallback in case localStorage is blocked by WebView permissions or sandboxing
const memoryStore = {};

export const safeStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      console.warn(`localStorage.getItem failed for key "${key}", using memory fallback:`, e);
      return memoryStore[key] || null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn(`localStorage.setItem failed for key "${key}", using memory fallback:`, e);
      memoryStore[key] = String(value);
      return false;
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn(`localStorage.removeItem failed for key "${key}", using memory fallback:`, e);
      delete memoryStore[key];
      return false;
    }
  }
};

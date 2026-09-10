// High-Capacity Asynchronous IndexedDB Storage for NeuroLens
// Bypasses the 5MB quota limit of localStorage for multi-page long documents (supports 500MB+)

import { safeStorage } from './storage';

const DB_NAME = 'neurolens_knowledge_db';
const DB_VERSION = 1;
const STORE_NAME = 'kv_store';

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB not available, falling back to localStorage');
      resolve(null);
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.warn('Failed to open IndexedDB:', event.target.error);
        resolve(null); // Fallback to safeStorage gracefully
      };
    } catch (e) {
      console.warn('IndexedDB open error:', e);
      resolve(null);
    }
  });

  return dbPromise;
}

export const indexedStorage = {
  async getItem(key) {
    try {
      const db = await getDB();
      if (!db) {
        const raw = safeStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      }

      return new Promise((resolve) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readonly');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.get(key);

          request.onsuccess = () => {
            if (request.result !== undefined) {
              resolve(request.result);
            } else {
              // Check fallback in case it was saved in localStorage previously
              const fallback = safeStorage.getItem(key);
              if (fallback) {
                try {
                  const parsed = JSON.parse(fallback);
                  // Auto-migrate to IndexedDB
                  indexedStorage.setItem(key, parsed).catch(() => {});
                  resolve(parsed);
                  return;
                } catch {
                  resolve(fallback);
                  return;
                }
              }
              resolve(null);
            }
          };

          request.onerror = () => {
            const raw = safeStorage.getItem(key);
            resolve(raw ? JSON.parse(raw) : null);
          };
        } catch (e) {
          console.warn(`IndexedDB transaction error for key "${key}":`, e);
          const raw = safeStorage.getItem(key);
          resolve(raw ? JSON.parse(raw) : null);
        }
      });
    } catch (e) {
      console.warn(`indexedStorage.getItem failed for "${key}":`, e);
      const raw = safeStorage.getItem(key);
      try {
        return raw ? JSON.parse(raw) : null;
      } catch {
        return raw;
      }
    }
  },

  async setItem(key, value) {
    try {
      const db = await getDB();
      if (!db) {
        safeStorage.setItem(key, JSON.stringify(value));
        return true;
      }

      return new Promise((resolve) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(value, key);

          request.onsuccess = () => resolve(true);
          request.onerror = (e) => {
            console.warn(`IndexedDB put error for key "${key}":`, e);
            safeStorage.setItem(key, JSON.stringify(value));
            resolve(false);
          };
        } catch (e) {
          console.warn(`IndexedDB set error for "${key}":`, e);
          safeStorage.setItem(key, JSON.stringify(value));
          resolve(false);
        }
      });
    } catch (e) {
      console.warn(`indexedStorage.setItem failed for "${key}":`, e);
      safeStorage.setItem(key, JSON.stringify(value));
      return false;
    }
  },

  async removeItem(key) {
    try {
      safeStorage.removeItem(key);
      const db = await getDB();
      if (!db) return true;

      return new Promise((resolve) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.delete(key);

          request.onsuccess = () => resolve(true);
          request.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  },

  async clear() {
    try {
      safeStorage.removeItem('neurolens_docs');
      safeStorage.removeItem('neurolens_chunks');
      const db = await getDB();
      if (!db) return true;

      return new Promise((resolve) => {
        try {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.clear();

          request.onsuccess = () => resolve(true);
          request.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  }
};

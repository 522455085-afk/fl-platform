/**
 * Service Worker for PWA offline support.
 * Enhanced version with offline sync and background sync.
 */

const CACHE_NAME = "fl-platform-v2";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

// Install: cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: smarter caching strategy
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") {
    // For POST requests (like sending messages), use Background Sync
    if (event.request.method === "POST") {
      event.respondWith(handlePostRequest(event.request));
      return;
    }
    return;
  }

  // Skip cross-origin requests (except for CDN)
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && !url.hostname.includes("cdn")) {
    return;
  }

  // Different strategies for different types of requests
  if (isAPRequest(event.request.url)) {
    // Network-first for API requests (always try network first)
    event.respondWith(networkFirst(event.request));
  } else if (isStaticAsset(event.request.url)) {
    // Cache-first for static assets
    event.respondWith(cacheFirst(event.request));
  } else {
    // Stale-while-revalidate for HTML pages
    event.respondWith(staleWhileRevalidate(event.request));
  }
});

// Background Sync: listen for sync events
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-messages") {
    event.waitUntil(syncOfflineMessages());
  }
});

// Push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || "新消息",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "default",
    data: data.url || "/",
  };

  event.waitUntil(self.registration.showNotification(data.title || "ForgottenLand", options));
});

// Notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  
  const url = event.notification.data || "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      // If a window is already open, focus it and navigate
      for (const client of windowClients) {
        if ("focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// ============================================================
// Helper functions
// ============================================================

function isAPRequest(url) {
  return url.includes("/api/") || url.includes("/.cloudbase/");
}

function isStaticAsset(url) {
  return url.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/);
}

// Cache-first strategy (for static assets)
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, clone);
      });
    }
    return response;
  } catch {
    // Offline and not in cache
    if (request.mode === "navigate") {
      return caches.match("/");
    }
    return new Response("Offline", { status: 503 });
  }
}

// Network-first strategy (for API requests)
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, clone);
      });
    }
    return response;
  } catch {
    // Network failed, try cache
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Return offline response
    return new Response(
      JSON.stringify({ error: "Offline", cached: true }),
      { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}

// Stale-while-revalidate (for HTML pages)
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, clone);
      });
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

// Handle POST requests (queue for background sync)
async function handlePostRequest(request) {
  try {
    // Try to send immediately
    const response = await fetch(request.clone());
    return response;
  } catch {
    // Failed (offline), queue for sync
    const body = await request.clone().json();
    await storeOfflineMessage(body);
    
    // Register for background sync
    await self.registration.sync.register("sync-messages");
    
    // Return a fake success response
    return new Response(
      JSON.stringify({ success: true, queued: true }),
      { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}

// Store offline message for later sync
async function storeOfflineMessage(message) {
  const db = await openDB();
  const tx = db.transaction("offline-messages", "readwrite");
  const store = tx.objectStore("offline-messages");
  await store.add({
    ...message,
    timestamp: Date.now(),
    synced: false,
  });
}

// Sync offline messages when back online
async function syncOfflineMessages() {
  const db = await openDB();
  const tx = db.transaction("offline-messages", "readwrite");
  const store = tx.objectStore("offline-messages");
  const messages = await store.getAll();

  for (const msg of messages) {
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      });
      
      // Mark as synced
      msg.synced = true;
      await store.put(msg);
    } catch {
      // Still offline, will retry later
      break;
    }
  }
}

// Open IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fl-platform-offline", 1);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("offline-messages")) {
        db.createObjectStore("offline-messages", { keyPath: "id", autoIncrement: true });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

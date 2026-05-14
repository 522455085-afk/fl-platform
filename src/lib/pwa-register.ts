/**
 * Register Service Worker for PWA offline support.
 * Enhanced with push notification support.
 * Call this once on client-side mount.
 */

/**
 * Register service worker and request notification permission.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const swUrl = "/sw.js";

    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log("[PWA] SW registered, scope:", registration.scope);

        // Request notification permission
        requestNotificationPermission(registration);

        // Check for updates
        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "installed") {
              if (navigator.serviceWorker.controller) {
                // New content available
                console.log("[PWA] New content available, please refresh.");
                // Optionally notify user via toast
                showUpdateToast();
              } else {
                console.log("[PWA] Content cached for offline use.");
              }
            }
          });
        });
      })
      .catch((error) => {
        console.error("[PWA] SW registration failed:", error);
      });
  });
}

/**
 * Unregister all service workers (useful during development).
 */
export function unregisterServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.unregister();
    })
    .catch((error) => {
      console.error(error.message);
    });
}

/**
 * Request notification permission and subscribe to push.
 */
async function requestNotificationPermission(registration: ServiceWorkerRegistration) {
  if (!("Notification" in window)) {
    console.log("[PWA] Notifications not supported");
    return;
  }

  // Check if permission already granted
  if (Notification.permission === "granted") {
    await subscribeToPush(registration);
    return;
  }

  // Don't ask immediately, wait for user interaction
  // This function can be called from a user action (e.g., clicking "Enable Notifications")
  console.log("[PWA] Notification permission not yet granted");
}

/**
 * Subscribe to push notifications.
 */
async function subscribeToPush(registration: ServiceWorkerRegistration) {
  try {
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      console.log("[PWA] Already subscribed to push");
      return;
    }

    // TODO: Get VAPID key from server
    // const vapidKey = await fetchVapidKey();
    // const newSubscription = await registration.pushManager.subscribe({
    //   userVisibleOnly: true,
    //   applicationServerKey: vapidKey,
    // });
    // await sendSubscriptionToServer(newSubscription);

    console.log("[PWA] Push subscription ready (VAPID key needed)");
  } catch (error) {
    console.error("[PWA] Push subscription failed:", error);
  }
}

/**
 * Show update available toast.
 */
function showUpdateToast() {
  // Dispatch custom event that UI can listen for
  window.dispatchEvent(new CustomEvent("pwa-update-available"));
}

/**
 * Request notification permission from user (call this from a button click).
 */
export async function requestNotificationPermissionFromUser(): Promise<boolean> {
  if (!("Notification" in window)) {
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission === "denied") {
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

/**
 * Register for background sync (call this when offline action needs to be synced).
 */
export async function registerBackgroundSync(tag: string): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if ("sync" in registration) {
      await (registration as any).sync.register(tag);
      console.log("[PWA] Background sync registered:", tag);
    }
  } catch (error) {
    console.error("[PWA] Background sync registration failed:", error);
  }
}

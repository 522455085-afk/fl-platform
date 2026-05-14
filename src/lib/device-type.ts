/**
 * Device type classification for the single-instance-per-platform-type
 * session policy (see `sessions.ts`).
 *
 * Per product spec (2026-05-09 revision 2):
 *  - There are exactly TWO slots: `web` and `app`.
 *  - `web` covers ALL browsers (PC Chrome/Firefox/Edge, mobile Safari,
 *    mobile Chrome, iPad browser, Electron client, anything that runs
 *    in a Chromium / WebKit / Gecko shell). One slot total — opening on
 *    PC kicks mobile browser, opening on mobile browser kicks PC, etc.
 *  - `app` covers only NATIVE installed mobile apps (Capacitor / Cordova
 *    bundles for Android & iOS). One slot total.
 *  - A user can therefore be online simultaneously on AT MOST one web +
 *    one app. PC web + mobile app: yes. PC web + mobile browser: no.
 *
 * The classification runs at module load time (no React hooks) so the
 * auth flow can use it before any UI mounts.
 */

export type DeviceType = "web" | "app";

export const DEVICE_LABEL: Record<DeviceType, string> = {
  web: "网页/客户端",
  app: "手机 App",
};

/**
 * Detect the current device type. SSR-safe: returns "web" without a
 * navigator (the value is only consulted on the client anyway).
 *
 * App detection looks for known native-shell markers injected at runtime:
 *  - `window.Capacitor`  → Capacitor wrapper
 *  - `window.cordova`    → Cordova wrapper
 *  - UA contains `Capacitor` / `CapacitorWebView`
 * Electron is deliberately classified as `web` (it's still Chromium),
 * matching the product spec.
 */
export function detectDeviceType(): DeviceType {
  if (typeof window === "undefined") return "web";

  // Check for native shell markers
  const w = window as Window & { Capacitor?: unknown; cordova?: unknown };
  if (w.Capacitor || w.cordova) return "app";

  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  if (/Capacitor|Cordova|CapacitorWebView/i.test(ua)) return "app";

  return "web";
}

/**
 * Friendly UA → display label, e.g. "Chrome on Windows".
 * Used in the "kicked by..." modal so users see a recognisable name.
 */
export function describeDevice(ua: string = ""): string {
  if (!ua && typeof navigator !== "undefined") ua = navigator.userAgent || "";
  if (!ua) return "未知设备";

  // OS
  let os = "未知系统";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/iPhone OS|iPad; CPU OS/.test(ua)) os = "iOS";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";

  // Browser
  let browser = "浏览器";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  // Electron / Capacitor markers (override browser).
  if (/Electron/i.test(ua)) browser = "客户端";
  else if (/Capacitor/i.test(ua)) browser = "App";

  return `${browser} · ${os}`;
}

/**
 * Generate a stable, opaque session id for this tab/instance. We use it
 * to disambiguate "is the kick targeting THIS session" from "is it some
 * older one I had". crypto.randomUUID is supported everywhere we care
 * about (Chrome 92+, Safari 15.4+, Firefox 95+, modern Electron).
 */
export function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: 16 random bytes rendered as hex.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

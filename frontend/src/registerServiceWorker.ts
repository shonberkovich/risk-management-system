// Registers the app-shell service worker (public/sw.js) so RMIS can be installed as a PWA.
// Only runs in production builds — registering it during `vite dev` would let the SW intercept
// and cache HMR/module requests, breaking live reload.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}

// Minimal service worker. Its only job is to let browsers offer "Install app".
//
// It deliberately caches NOTHING: every page and API response is per-user and
// changes constantly, so serving a cached copy would show stale or other people's
// data. Every request goes straight to the network, exactly as without a worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

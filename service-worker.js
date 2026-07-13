const CACHE_NAME = "gimpo-b-pwa-runtime-v4";

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css?v=20260713-2",
    "./script.js?v=20260713-2",
    "./manifest.json",
    "./icons/icon-180.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);

        await Promise.all(APP_SHELL.map(async url => {
            try {
                const response = await fetch(new Request(url, { cache: "reload" }));
                if (response && response.ok) {
                    await cache.put(url, response.clone());
                }
            } catch (error) {
                console.warn("초기 캐시 저장 실패:", url, error);
            }
        }));
    })());

    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();

        await Promise.all(
            keys
                .filter(key => key !== CACHE_NAME && key.startsWith("gimpo-b-pwa-"))
                .map(key => caches.delete(key))
        );

        await self.clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (
        url.hostname === "script.google.com" ||
        url.hostname === "script.googleusercontent.com"
    ) {
        event.respondWith(fetch(request));
        return;
    }

    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith(networkFirst(request, "./index.html"));
        return;
    }

    event.respondWith(networkFirst(request));
});

async function networkFirst(request, fallbackUrl = "") {
    const cache = await caches.open(CACHE_NAME);

    try {
        const response = await fetch(new Request(request, { cache: "no-store" }));

        if (response && response.ok) {
            await cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;

        if (fallbackUrl) {
            const fallback = await cache.match(fallbackUrl, { ignoreSearch: true });
            if (fallback) return fallback;
        }

        return Response.error();
    }
}

const CACHE_NAME = "gimpo-b-pwa-runtime-v15";
const NAVIGATION_TIMEOUT_MS = 2000;

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css?v=20260715-3",
    "./script.js?v=20260715-3",
    "./manifest.json",
    "./locations.json",
    "./icons/icon-180.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

const GATE_IMAGES = [
    "./gate-images/썬앤빌.webp",
    "./gate-images/럭스A.webp",
    "./gate-images/럭스B.webp",
    "./gate-images/루체뷰1.webp"
];

const PRECACHE_URLS = [...APP_SHELL, ...GATE_IMAGES];

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(PRECACHE_URLS.map(async url => {
            try {
                const response = await fetch(new Request(url, { cache: "reload" }));
                if (response?.ok) await cache.put(url, response.clone());
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
    if (url.hostname === "script.google.com" || url.hostname === "script.googleusercontent.com") {
        event.respondWith(fetch(request));
        return;
    }
    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith(navigationNetworkFirst(request, "./index.html", event));
        return;
    }
    if (url.pathname.endsWith("/locations.json")) {
        event.respondWith(networkFirst(request));
        return;
    }
    if (isCacheFirstAsset(url.pathname)) {
        event.respondWith(cacheFirst(request));
        return;
    }
    event.respondWith(networkFirst(request));
});

function isCacheFirstAsset(pathname) {
    return pathname.includes("/gate-images/") ||
        pathname.includes("/icons/") ||
        pathname.endsWith("/script.js") ||
        pathname.endsWith("/style.css") ||
        pathname.endsWith("/manifest.json");
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response?.ok) await cache.put(request, response.clone());
        return response;
    } catch (error) {
        return Response.error();
    }
}

async function navigationNetworkFirst(request, fallbackUrl, event) {
    const cache = await caches.open(CACHE_NAME);
    const networkPromise = fetch(new Request(request, { cache: "no-cache" }))
        .then(async response => {
            if (response?.ok) await cache.put(request, response.clone());
            return response;
        });
    event.waitUntil(networkPromise.catch(() => {}));

    const timeoutPromise = new Promise(resolve => {
        setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS);
    });

    const fastNetworkResponse = await Promise.race([
        networkPromise.catch(() => null),
        timeoutPromise
    ]);
    if (fastNetworkResponse) return fastNetworkResponse;

    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const fallback = await cache.match(fallbackUrl, { ignoreSearch: true });
    if (fallback) return fallback;

    try {
        return await networkPromise;
    } catch (error) {
        return Response.error();
    }
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(new Request(request, { cache: "no-cache" }));
        if (response?.ok) await cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        return cached || Response.error();
    }
}

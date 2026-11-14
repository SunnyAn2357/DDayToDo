/* =====================================================================
 * PWA Service Worker for D-Day 일정관리 (PWA Icon & Maskable Support)
 * ===================================================================== */
const APP_VERSION = '1.0.14';
const CACHE_NAME = 'todo-pwa-v1.0.14';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-32.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192x192.png',
  './icon-maskable-512x512.png'
];

// 서비스워커 메시지 수신 (새 버전 배포 시 즉시 활성화 트리거)
self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting')) {
    self.skipWaiting();
  }
});

// 1. 서비스워커 설치 (핵심 에셋 캐싱)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url))
      );
    })
  );
  self.skipWaiting();
});

// 2. 구버전 캐시 정리 및 즉시 활성화
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. 네트워크 요청 처리
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Firebase Firestore, Google Auth 및 외부 CDN, 비 GET 요청은 캐싱하지 않고 네트워크로 직접 전달
  if (
    req.method !== 'GET' ||
    req.url.includes('firestore.googleapis.com') ||
    req.url.includes('identitytoolkit.googleapis.com') ||
    req.url.includes('securetoken.googleapis.com') ||
    req.url.includes('apis.data.go.kr') ||
    req.url.includes('gstatic.com/firebasejs')
  ) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        // 캐시 히트 시에도 백그라운드에서 최신 버전 페치하여 캐시 갱신 (Stale-While-Revalidate)
        fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const resClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return networkResponse;
      }).catch(() => {
        // 오프라인 폴백: 탐색 요청(HTML)일 경우 루트 index.html 반환
        if (req.mode === 'navigate') {
          return caches.match('./index.html') || caches.match('./');
        }
      });
    })
  );
});

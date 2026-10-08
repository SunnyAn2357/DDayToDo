/* =====================================================================
 * PWA Service Worker for D-Day 일정관리
 * ===================================================================== */
const CACHE_NAME = 'todo-calendar-pwa-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './icon-32.png',
  './icon-192.png',
  './icon-512.png'
];

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

  // Firebase Firestore, Google Auth 및 외부 CDN, 비-GET 요청은 캐싱하지 않고 네트워크로 직접 전달
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) {
    return;
  }

  // HTML 페이지 접속(네비게이션): Network-First (온라인 시 최신 코드 반영, 오프라인 시 캐시 사용)
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(req).then((cached) => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // 정적 에셋(아이콘, 매니페스트 등): Cache-First
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      });
    })
  );
});

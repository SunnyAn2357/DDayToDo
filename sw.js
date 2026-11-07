/* =====================================================================
 * PWA Service Worker for D-Day 일정관리 (PWA Icon & Maskable Support)
 * ===================================================================== */
const APP_VERSION = '1.0.1';
const CACHE_NAME = 'todo-pwa-v1.0.1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './아이콘/manifest.json',
  './아이콘/favicon.ico',
  './아이콘/favicon-16x16.png',
  './아이콘/favicon-32x32.png',
  './아이콘/favicon-48x48.png',
  './아이콘/apple-touch-icon.png',
  './아이콘/icon-192x192.png',
  './아이콘/icon-512x512.png',
  './아이콘/icon-maskable-192x192.png',
  './아이콘/icon-maskable-512x512.png'
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

  // Firebase Firestore, Google Auth 및 외부 CDN, 비 GET 요청은 캐싱하지 않고 네트워크로 직접 전달
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) {
    return;
  }

  // HTML 페이지 접속(네비게이션): Network-First (온라인 시 최신 코드 반영, 오프라인 시 캐시 활용)
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          return caches.match('./index.html') || caches.match('./');
        })
    );
    return;
  }

  // 정적 리소스(JS, CSS, 이미지, 파비콘, 매니페스트): Cache-First (속도 최적화 및 오프라인 지원)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});

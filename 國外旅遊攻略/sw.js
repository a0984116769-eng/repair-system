// 國外旅遊攻略：Service Worker（讓網頁可以安裝到主畫面，並在離線時開啟）
//
// 快取策略：
// - 網頁本身（HTML）：先連網路取得最新版，連不上才用快取。
// - CSS、JS、圖示、supabase-js：先用快取，同時在背景更新。
// - Supabase 讀取攻略與留言（GET）：先連網路，連不上才用上次看過的內容。
// - 產生攻略、留言、回報（POST）與其他網站：一律直接連網路，不快取。
//
// 修改網頁檔案後，請把 VERSION 加 1，讓使用者拿到新版。

var VERSION = "v2";
var SHELL_CACHE = "travel-shell-" + VERSION;
var DATA_CACHE = "travel-data-" + VERSION;

var SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
];
var CDN_FILES = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
];
var SUPABASE_HOST = "ltmuuxslnawhwzguosyi.supabase.co";

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // 外部 CDN 失敗時不影響安裝，之後第一次載入時再快取
      var cdn = Promise.all(CDN_FILES.map(function (url) {
        return fetch(new Request(url, { mode: "cors" }))
          .then(function (res) { if (res.ok) return cache.put(url, res); })
          .catch(function () {});
      }));
      return Promise.all([cache.addAll(SHELL_FILES), cdn]);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf("travel-") === 0 && key !== SHELL_CACHE && key !== DATA_CACHE) {
          return caches.delete(key);
        }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(request, cacheName, fallbackUrl) {
  return fetch(request).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(request, { ignoreVary: true }).then(function (hit) {
      if (hit) return hit;
      if (fallbackUrl) return caches.match(fallbackUrl);
      return Response.error();
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var update = fetch(request).then(function (res) {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(function () { return hit || Response.error(); });
      return hit || update;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return; // POST 等一律直接連網路

  var url = new URL(request.url);

  // 網頁本身
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, "./index.html"));
    return;
  }

  // Supabase 讀取資料：只快取攻略和留言的讀取
  if (url.hostname === SUPABASE_HOST) {
    if (/^\/rest\/v1\/travel_(guides|comments)$/.test(url.pathname)) {
      event.respondWith(networkFirst(request, DATA_CACHE));
    }
    return;
  }

  // 同一個資料夾內的檔案與 supabase-js
  var inScope = url.origin === self.location.origin &&
    url.pathname.indexOf(new URL("./", self.location).pathname) === 0;
  if (inScope || CDN_FILES.indexOf(request.url) !== -1) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

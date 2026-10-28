/* Carnet de Suivi : hors ligne + photos servies depuis le téléphone */
var CACHE = "carnet-v2.37";
self.addEventListener("install", function(e){ e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(["./","index.html","manifest.webmanifest","icone-192.png","icone-512.png"]); })); self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(caches.keys().then(function(ks){ return Promise.all(ks.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); })); }).then(function(){ return self.clients.claim(); })); });
function photo(id){ return new Promise(function(ok){
  var r = indexedDB.open("carnet-ml", 1);
  r.onupgradeneeded = function(){ var d = r.result; if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs"); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); };
  r.onsuccess = function(){ var g = r.result.transaction("blobs","readonly").objectStore("blobs").get(id);
    g.onsuccess = function(){ ok(g.result ? new Response(g.result) : new Response("", {status:404})); }; g.onerror = function(){ ok(new Response("", {status:404})); }; };
  r.onerror = function(){ ok(new Response("", {status:404})); };
}); }
self.addEventListener("fetch", function(e){
  var u = new URL(e.request.url);
  var i = u.pathname.indexOf("/_blob/");
  if (u.origin === location.origin && i >= 0){ e.respondWith(photo(decodeURIComponent(u.pathname.slice(i+7)))); return; }
  if (e.request.method !== "GET") return;
  // réseau d'abord (mises à jour), cache si hors ligne
  e.respondWith(fetch(e.request).then(function(r){ var cp = r.clone(); caches.open(CACHE).then(function(c){ c.put(e.request, cp); }); return r; })
    .catch(function(){ return caches.match(e.request).then(function(m){ return m || caches.match("index.html"); }); }));
});

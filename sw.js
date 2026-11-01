// Service worker: guarda la "carcasa" de la app para que abra rápido.
// Los datos (Supabase) nunca se guardan en caché.
// Al publicar cambios, sube el número de VERSION.
const VERSION = 'mb-0.5.0';
const CARCASA = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/config.js', './js/db.js', './js/util.js', './js/fechas.js', './js/pin.js',
  './js/ajustes.js', './js/citas.js', './js/caja.js', './js/tpv.js', './js/factura.js', './js/ics.js', './js/importar.js',
  './js/vistas/agenda.js', './js/vistas/clientas.js', './js/vistas/servicios.js', './js/vistas/ajustes.js',
  './js/vistas/caja.js', './js/vistas/catalogo.js', './js/vistas/productos.js', './js/vistas/inventario.js',
  './iconos/icon-192.png', './iconos/icon-512.png', './iconos/insignia.png', './iconos/flor.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CARCASA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return; // datos: siempre red
  if (url.origin === location.origin) {
    // Primero la red (para recibir cambios), si no hay conexión, la copia guardada
    e.respondWith(fetch(e.request).then((r) => {
      const copia = r.clone();
      if (r.ok) caches.open(VERSION).then((c) => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
    return;
  }
  // Librerías y fuentes externas: la copia guardada primero
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
    const copia = resp.clone();
    if (resp.ok || resp.type === 'opaque') caches.open(VERSION).then((c) => c.put(e.request, copia));
    return resp;
  })));
});

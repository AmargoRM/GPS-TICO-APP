/* =======================================================================
   SERVICE WORKER — lo que hace que la app abra SIN INTERNET.
   La primera vez que se abre con internet, guarda en el celular una copia
   de todos los archivos de la app. Después, siempre los sirve desde esa
   copia, aunque no haya conexión.

   IMPORTANTE para publicar una versión nueva: cambiar el número de VERSION.
   Así el celular detecta el cambio y la app muestra "Hay una versión nueva".
   ======================================================================= */
const VERSION = '1.1.0';
const CACHE = 'gps-tico-web-' + VERSION;

// Todos los archivos que forman la app (rutas relativas a esta carpeta).
const ARCHIVOS = [
  './',
  'index.html',
  'estilos.css',
  'manifest.webmanifest',
  'iconos/icono-180.png',
  'iconos/icono-192.png',
  'iconos/icono-512.png',
  'iconos/icono-maskable-512.png',
  'js/app.js',
  'js/estado.js',
  'js/ui.js',
  'js/geodesia.js',
  'js/bd.js',
  'js/mapa.js',
  'js/importar.js',
  'js/capas.js',
  'js/capas-url.js',
  'js/gps.js',
  'js/puntos.js',
  'js/exportar.js',
  'js/copia.js',
  'js/ajustes.js',
  'js/instalar.js'
];

// Instalación: descarga y guarda todos los archivos. Si falta uno, no se instala
// (así nunca queda una app a medias en el celular).
self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' })))));
  // No se activa sola: espera a que el usuario toque "Actualizar".
});

// Activación: borra las copias de versiones viejas.
self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => n.startsWith('gps-tico-web-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// La app pide activar la versión nueva (botón "Actualizar").
self.addEventListener('message', ev => {
  if (ev.data && ev.data.tipo === 'ACTUALIZAR') self.skipWaiting();
  if (ev.data && ev.data.tipo === 'VERSION') ev.source.postMessage({ tipo: 'VERSION', version: VERSION });
});

// Cada pedido: los archivos de la app salen de la copia guardada.
// Lo de afuera (fondos de mapa, capas por URL) va directo a internet.
self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // externo: no se toca

  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Abrir la app (navegación): siempre la página guardada.
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    const guardado = await cache.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    try { return await fetch(req); }
    catch (e) { return new Response('Sin conexión', { status: 503, statusText: 'Sin conexion' }); }
  })());
});

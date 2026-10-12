/* =======================================================================
   ARRANQUE DE LA APP
   1. Abre la base de datos del celular y carga capas, puntos y ajustes.
   2. Pide almacenamiento persistente.
   3. Inicia el mapa, las herramientas y el GPS.
   4. Registra el service worker (funcionar sin internet + avisar versiones
      nuevas) y el botón "Instalar app".
   5. Recibe archivos compartidos desde otras apps (Android) o abiertos con
      la app (computadora).
   6. Conecta los botones.
   ======================================================================= */
import './compat.js';   // primero: piezas que faltan en Safari viejos
import { S, cargarTodo, cambiarAjuste } from './estado.js';
import { abrirBD } from './bd.js';
import { toast, alerta, avisoFijo, cerrarPanel } from './ui.js';
import { textoCoord, PROY } from './geodesia.js';
import { iniciarMapa, pedirDibujo, irA, cambiarZoom, vista, FONDOS } from './mapa.js';
import { iniciarGPS, actualizarBarra, panelCaptura } from './gps.js';
import { panelPuntos, dejarDeNavegar } from './puntos.js';
import { panelCapas, importarArchivos, completarCapasURL } from './capas.js';
import { consultarEnPantalla, cerrarTablaLateral } from './consulta.js';
import { cambiarModo, tocarConHerramienta, abrirMenuMantener, actualizarBarra as barraHerramienta } from './herramientas.js';
import { panelMenu } from './menu.js';
import { pedirPersistencia, revisarAvisoCopia } from './ajustes.js';
import { iniciarInstalacion } from './instalar.js';

async function iniciar() {
  // 1. Datos guardados
  try {
    await abrirBD();
    await cargarTodo();
  } catch (e) {
    alerta('No se pueden guardar datos', 'Este navegador no permite guardar datos (' + (e.message || e) + '). ' +
      'Si estás en modo privado (Safari: pestañas privadas), abrí la app en una ventana normal.');
    return;
  }

  // 2. Almacenamiento persistente (el resultado se ve en Ajustes)
  pedirPersistencia();

  // 3. Mapa: arranca donde quedó la última vez
  if (S.ajustes.vista) { vista.lat = S.ajustes.vista.lat; vista.lon = S.ajustes.vista.lon; vista.zoom = S.ajustes.vista.zoom; S.seguir = false; }
  let tGuardarVista = null;
  iniciarMapa(document.getElementById('mapa'), {
    alTocar: tocarMapa,
    alMantener: abrirMenuMantener,
    // Guardar el encuadre un momento después de mover (no en cada movimiento).
    alMover: () => {
      document.getElementById('btnYo').classList.toggle('activo', S.seguir);
      clearTimeout(tGuardarVista);
      tGuardarVista = setTimeout(() => cambiarAjuste('vista', { lat: vista.lat, lon: vista.lon, zoom: vista.zoom }), 1500);
    }
  });
  actualizarBarra();
  iniciarGPS();
  completarCapasURL();
  revisarAvisoCopia();
  document.addEventListener('datos-cambiados', revisarAvisoCopia);
  estadoRed();

  // 4. Service worker y botón "Instalar app"
  registrarServiceWorker();
  iniciarInstalacion();

  // 5. Archivos compartidos o abiertos con la app
  recibirArchivos();

  // 6. Botones
  conectarBotones();
}

// Toque en el mapa: herramienta activa, o consulta (punto, elemento de capa, WMS);
// si no hay nada, muestra las coordenadas del lugar tocado.
async function tocarMapa(lat, lon, px, py) {
  if (tocarConHerramienta(lat, lon)) return;
  if (await consultarEnPantalla(px, py)) return;
  const modo = S.ajustes.proyeccion;
  const t = textoCoord(lat, lon, modo);
  toast(`${PROY[modo].nom}: ${t.a} · ${t.b}`, 5000);
}

function conectarBotones() {
  const $ = id => document.getElementById(id);
  // Sistema de coordenadas: GEO / CRTM05 / LAM·N / LAM·S (como Android).
  document.querySelectorAll('#sistemas [data-m]').forEach(b => b.onclick = async () => {
    await cambiarAjuste('proyeccion', b.dataset.m);
    actualizarBarra();
    barraHerramienta();
  });
  $('btnMas').onclick = () => cambiarZoom(1);
  $('btnMenos').onclick = () => cambiarZoom(-1);
  $('btnYo').onclick = () => {
    if (!S.fix) { toast('Todavía no hay señal del GPS.'); return; }
    S.seguir = true; irA(S.fix.lat, S.fix.lon, Math.max(vista.zoom, 16));
  };
  $('btnFondo').onclick = async () => {
    const orden = Object.keys(FONDOS);
    const sig = orden[(orden.indexOf(S.ajustes.fondo) + 1) % orden.length];
    await cambiarAjuste('fondo', sig);
    pedirDibujo();
    toast('Fondo: ' + FONDOS[sig].nom + (sig !== 'ninguno' && !navigator.onLine ? ' (sin internet se ve solo lo guardado)' : ''));
  };
  $('btnMedir').onclick = () => cambiarModo('medir');
  $('btnNav').onclick = () => cambiarModo('navegar');
  $('btnCapas').onclick = panelCapas;
  $('btnPuntos').onclick = panelPuntos;
  $('btnCapturar').onclick = panelCaptura;
  $('btnMenu').onclick = panelMenu;
  $('panelCerrar').onclick = cerrarPanel;
  $('panel').onclick = e => { if (e.target.id === 'panel') cerrarPanel(); };   // tocar fuera cierra
  $('navCerrar').onclick = () => { dejarDeNavegar(); barraHerramienta(); };
  $('tablaLatCerrar').onclick = cerrarTablaLateral;
  window.addEventListener('online', () => { estadoRed(); completarCapasURL(); pedirDibujo(); });
  window.addEventListener('offline', () => { estadoRed(); pedirDibujo(); });
}

function estadoRed() {
  avisoFijo('red', navigator.onLine ? null : 'Sin conexión. Tus capas, puntos y el mapa ya guardado funcionan.', null, 'info');
}

/* --- Archivos compartidos (Android: "Compartir" → GPS TICO) o abiertos con la app --- */
async function recibirArchivos() {
  // Compartidos: el service worker los dejó guardados y abrió la app con ?compartido=1
  if (new URLSearchParams(location.search).has('compartido') && 'caches' in window) {
    history.replaceState(null, '', location.pathname);
    try {
      const cache = await caches.open('gps-tico-compartidos');
      const archivos = [];
      for (const req of await cache.keys()) {
        const r = await cache.match(req);
        archivos.push(new File([await r.blob()], decodeURIComponent(r.headers.get('X-Nombre') || 'archivo'), { type: r.headers.get('Content-Type') || '' }));
        await cache.delete(req);
      }
      if (archivos.length) importarArchivos(archivos);
    } catch (e) { toast('No se pudo leer el archivo compartido.'); }
  }
  // "Abrir con" en computadoras (Chrome/Edge): File Handling API.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      if (!params.files || !params.files.length) return;
      const archivos = await Promise.all(params.files.map(h => h.getFile()));
      importarArchivos(archivos);
    });
  }
}

/* --- Service worker y aviso de versión nueva --- */
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let pidioActualizar = false;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const avisar = trabajador => avisoFijo('version', 'Hay una versión nueva de la app.', {
      texto: 'Actualizar',
      accion: () => { pidioActualizar = true; trabajador.postMessage({ tipo: 'ACTUALIZAR' }); }
    }, 'info');
    if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => {
        // "installed" con una versión ya activa = hay una versión nueva esperando.
        if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w);
      });
    });
    // Cuando la versión nueva toma el control, recargar (solo si el usuario lo pidió).
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (pidioActualizar) location.reload(); });
    // Buscar versiones nuevas al volver a la app y cada hora.
    const buscar = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') buscar(); });
    setInterval(buscar, 3600000);
  } catch (e) {
    console.warn('No se pudo registrar el service worker:', e);
  }
}

iniciar();

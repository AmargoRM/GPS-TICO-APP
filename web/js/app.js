/* =======================================================================
   ARRANQUE DE LA APP
   1. Abre la base de datos del celular y carga capas, puntos y ajustes.
   2. Pide almacenamiento persistente.
   3. Inicia el mapa y el GPS.
   4. Registra el service worker (funcionar sin internet + avisar versiones nuevas).
   5. Conecta los botones.
   ======================================================================= */
import { S, cargarTodo, cambiarAjuste } from './estado.js';
import { abrirBD } from './bd.js';
import { toast, alerta, avisoFijo, cerrarPanel } from './ui.js';
import { textoCoord, PROY } from './geodesia.js';
import { iniciarMapa, pedirDibujo, irA, cambiarZoom, vista, buscarEn, FONDOS } from './mapa.js';
import { iniciarGPS, actualizarBarra, panelCaptura } from './gps.js';
import { panelPuntos, panelPunto, panelElemento, dejarDeNavegar } from './puntos.js';
import { panelCapas, cargarCapasURLVisibles } from './capas.js';
import { panelExportar } from './exportar.js';
import { panelAjustes, pedirPersistencia, revisarAvisoCopia } from './ajustes.js';

async function iniciar() {
  // 1. Datos guardados
  try {
    await abrirBD();
    await cargarTodo();
  } catch (e) {
    alerta('No se pueden guardar datos', 'Este navegador no permite guardar datos (' + (e.message || e) + '). ' +
      'Si estás en modo incógnito o privado, abrí la app en una ventana normal.');
    return;
  }

  // 2. Almacenamiento persistente (el resultado se ve en Ajustes)
  pedirPersistencia();

  // 3. Mapa: arranca donde quedó la última vez
  if (S.ajustes.vista) { vista.lat = S.ajustes.vista.lat; vista.lon = S.ajustes.vista.lon; vista.zoom = S.ajustes.vista.zoom; S.seguir = false; }
  let tGuardarVista = null;
  iniciarMapa(document.getElementById('mapa'), {
    alTocar: tocarMapa,
    // Guardar el encuadre un momento después de mover (no en cada movimiento).
    alMover: () => {
      document.getElementById('btnYo').classList.toggle('activo', S.seguir);
      clearTimeout(tGuardarVista);
      tGuardarVista = setTimeout(() => cambiarAjuste('vista', { lat: vista.lat, lon: vista.lon, zoom: vista.zoom }), 1500);
    }
  });
  actualizarBarra();
  iniciarGPS();
  cargarCapasURLVisibles(pedirDibujo);
  revisarAvisoCopia();
  document.addEventListener('datos-cambiados', revisarAvisoCopia);
  estadoRed();

  // 4. Service worker
  registrarServiceWorker();

  // 5. Botones
  conectarBotones();
}

// Toque en el mapa: abre un punto o elemento; si no hay nada, muestra las coordenadas del lugar.
function tocarMapa(lat, lon, px, py) {
  const r = buscarEn(px, py, lat, lon);
  if (r?.tipo === 'punto') return panelPunto(r.punto);
  if (r?.tipo === 'elemento') return panelElemento(r.capa, r.feature);
  const modo = S.ajustes.proyeccion;
  const t = textoCoord(lat, lon, modo);
  toast(`${PROY[modo].nom}: ${t.a} · ${t.b}`, 5000);
}

function conectarBotones() {
  const $ = id => document.getElementById(id);
  // Tocar las coordenadas cambia de sistema: CRTM05 → Lambert Norte → Lambert Sur → Geográficas.
  $('btnProy').onclick = async () => {
    const orden = ['crtm05', 'ln', 'ls', 'geo'];
    const sig = orden[(orden.indexOf(S.ajustes.proyeccion) + 1) % orden.length];
    await cambiarAjuste('proyeccion', sig);
    actualizarBarra();
    toast('Coordenadas en ' + PROY[sig].largo);
  };
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
    toast('Fondo: ' + FONDOS[sig].nom + (sig !== 'ninguno' && !navigator.onLine ? ' (necesita internet)' : ''));
  };
  $('btnCapas').onclick = panelCapas;
  $('btnPuntos').onclick = panelPuntos;
  $('btnCapturar').onclick = panelCaptura;
  $('btnExportar').onclick = panelExportar;
  $('btnAjustes').onclick = panelAjustes;
  $('panelCerrar').onclick = cerrarPanel;
  $('panel').onclick = e => { if (e.target.id === 'panel') cerrarPanel(); };   // tocar fuera cierra
  $('navCerrar').onclick = dejarDeNavegar;
  window.addEventListener('online', () => { estadoRed(); cargarCapasURLVisibles(pedirDibujo); pedirDibujo(); });
  window.addEventListener('offline', () => { estadoRed(); pedirDibujo(); });
}

function estadoRed() {
  avisoFijo('red', navigator.onLine ? null : 'Sin conexión. Tus capas de archivo y puntos funcionan; el fondo y las capas de URL no.', null, 'info');
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

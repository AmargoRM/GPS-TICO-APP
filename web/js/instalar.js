/* =======================================================================
   INSTALAR LA APP EN EL CELULAR
   Muestra arriba el aviso "Instalá la app" con un botón Instalar.
   - Android (Chrome, Brave, Edge, Samsung): el navegador avisa que la app
     se puede instalar (evento "beforeinstallprompt") y el botón abre su
     ventana de instalación.
   - iPhone (Safari) y navegadores sin ese aviso: el botón muestra los
     pasos para instalarla a mano desde el menú del navegador.
   Si la app ya está instalada (abierta desde el ícono), no se muestra nada.
   ======================================================================= */
import { avisoFijo, alerta, toast } from './ui.js';

let pedidoInstalacion = null;   // lo que entrega el navegador para instalar
const CLAVE_POSPUESTO = 'gps-tico-web-instalar-pospuesto';
const DIAS_POSPUESTO = 3;

// ¿Ya se está usando como app instalada?
export function estaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function esIPhone() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

function pospuesto() {
  try { const t = +localStorage.getItem(CLAVE_POSPUESTO); return t && Date.now() - t < DIAS_POSPUESTO * 86400000; }
  catch (e) { return false; }
}

// Pasos a mano según el celular.
export function mostrarPasos() {
  if (esIPhone()) {
    alerta('Instalar en iPhone', '1. Abrí esta página en <b>Safari</b> (en otros navegadores de iPhone no se puede).<br>' +
      '2. Tocá el botón <b>Compartir</b> (cuadrado con flecha hacia arriba).<br>' +
      '3. Elegí <b>"Agregar a inicio"</b> y tocá <b>Agregar</b>.<br>4. Abrí la app desde el ícono nuevo.');
  } else {
    alerta('Instalar en Android', '1. Tocá el menú del navegador (<b>⋮</b>, arriba o abajo a la derecha).<br>' +
      '2. Elegí <b>"Instalar aplicación"</b> o <b>"Agregar a pantalla de inicio"</b>.<br>' +
      '3. Confirmá. Después abrí la app desde el ícono nuevo.<br><br>' +
      '<small>Si no aparece la opción, probá abriendo el enlace en <b>Chrome</b>.</small>');
  }
}

// Instalar: con la ventana del navegador si está disponible; si no, los pasos.
export async function instalar() {
  if (!pedidoInstalacion) { mostrarPasos(); return; }
  pedidoInstalacion.prompt();
  const r = await pedidoInstalacion.userChoice.catch(() => null);
  pedidoInstalacion = null;
  if (r && r.outcome === 'accepted') avisoFijo('instalar', null);
}

function mostrarAviso() {
  if (estaInstalada() || pospuesto()) { avisoFijo('instalar', null); return; }
  avisoFijo('instalar', 'Instalá la app para usarla sin internet desde un ícono.', [
    { texto: 'Instalar', accion: instalar },
    { texto: 'Ahora no', clase: 'borde', accion: () => {
      try { localStorage.setItem(CLAVE_POSPUESTO, String(Date.now())); } catch (e) { /* sin almacenamiento */ }
      avisoFijo('instalar', null);
    } }
  ], 'info');
}

export function iniciarInstalacion() {
  // El navegador avisa que la app es instalable: guardamos el pedido para el botón.
  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    pedidoInstalacion = ev;
    mostrarAviso();
  });
  window.addEventListener('appinstalled', () => {
    pedidoInstalacion = null;
    avisoFijo('instalar', null);
    toast('App instalada. Abrila desde el ícono en tu pantalla de inicio.', 6000);
  });
  mostrarAviso();
}

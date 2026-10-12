/* =======================================================================
   COMPATIBILIDAD (sobre todo iPhone / Safari viejos)
   Agrega piezas que algunos navegadores no tienen, para que la app no se
   caiga. Se carga antes que todo lo demás.
   ======================================================================= */

// AbortSignal.timeout: Safari lo tiene recién desde la versión 16.
if (typeof AbortSignal !== 'undefined' && !AbortSignal.timeout) {
  AbortSignal.timeout = ms => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('Tiempo agotado', 'TimeoutError')), ms); return c.signal; };
}
// Array.prototype.at: Safari desde 15.4.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', { value(i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; }, configurable: true, writable: true });
}

// ¿Es un iPhone o iPad? (los iPad nuevos se presentan como Mac con pantalla táctil)
export const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// ¿La app está abierta como app instalada (desde el ícono)?
export const enModoApp = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// Marca el <html> para que los estilos puedan ajustarse a iPhone.
if (esIOS) document.documentElement.classList.add('ios');

/* =======================================================================
   VISOR DE MAPA (propio, dibujado sobre un <canvas>, sin librerías)
   Adaptado del GPS TICO original (Android).

   Orden de dibujo (de abajo hacia arriba):
   1. Fondo (satélite o calles). Lo ya visto o descargado queda guardado en
      el celular y se ve sin internet (como en Android).
   2. Capas WMS (imágenes de un servidor).
   3. Capas vectoriales, en el orden del panel de Capas, con su estilo,
      simbología por atributo y etiquetas.
   4. Puntos capturados.
   5. Herramientas (medición, ruta, chincheta), mi posición y su precisión.
   ======================================================================= */
import { S, capaVisible } from './estado.js';
import { D2R, R2D } from './geodesia.js';
import { leer, guardar } from './bd.js';
import { dibujarGrande } from './grandes.js';
import { pasaFiltro } from './filtros.js';

// Fondos disponibles. Son servicios públicos gratuitos (no son míos ni tuyos).
export const FONDOS = {
  sat:    { nom: 'Satélite', url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, cred: 'Esri, Maxar, Earthstar Geographics' },
  calles: { nom: 'Calles', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, cred: '© OpenStreetMap' },
  ninguno:{ nom: 'Sin fondo', url: null, max: 21, cred: '' }
};
export const PALETA = ['#E0A458', '#4FD1C5', '#C75146', '#6FCF6F', '#B07CC6', '#E06AA0', '#8899AA', '#F2C94C', '#2D9CDB'];

let cv, ctx, DPR = 1, W = 0, H = 0;
export const vista = { lat: 9.93, lon: -84.08, zoom: 8 };   // arranca sobre Costa Rica
let ultimaTransf = null;
let alTocar = () => {}, alMover = () => {}, alMantener = () => {};
const sobrecapas = [];               // dibujos extra (medición, ruta, chincheta…)
export function registrarSobrecapa(fn) { sobrecapas.push(fn); }
export let capaResaltada = null;     // capa resaltada en amarillo (tabla lateral abierta)
export function resaltarCapa(id) { capaResaltada = id; pedirDibujo(); }

/* --- Conversión entre lat/lon y píxeles (Web Mercator, como Google/OSM) --- */
export function lon2px(lon, z) { return (lon + 180) / 360 * 256 * 2 ** z; }
export function lat2px(lat, z) {
  const s = Math.sin(lat * D2R);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
}
export function px2lon(x, z) { return x / (256 * 2 ** z) * 360 - 180; }
export function px2lat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (256 * 2 ** z);
  return R2D * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/* --- Teselas (cuadritos de imagen del fondo y de WMS) ---
   1. Si está en memoria, se usa.
   2. Si está guardada en el celular (cajón "teselas"), se usa (sin internet).
   3. Si hay internet, se descarga, se guarda y se usa.
   Si el servidor no permite leer la imagen (CORS), se muestra igual pero
   no se puede guardar ni incluir al exportar el mapa ("sucia"). */
const teselas = new Map();   // clave → {img, sucia} | {fallo: fecha}
const pidiendo = new Set();
export function borrarTeselasMemoria(prefijo) {
  for (const k of [...teselas.keys()]) if (!prefijo || k.startsWith(prefijo)) teselas.delete(k);
}
function tesela(clave, url) {
  const t = teselas.get(clave);
  if (t) {
    if (t.img) return t;
    if (Date.now() - t.fallo < 30000) return null;   // reintenta cada 30 s
    teselas.delete(clave);
  }
  if (!pidiendo.has(clave)) { pidiendo.add(clave); cargarTesela(clave, url).finally(() => pidiendo.delete(clave)); }
  return null;
}
function imagenSinPermiso(url) {
  return new Promise((ok, mal) => { const im = new Image(); im.onload = () => ok(im); im.onerror = mal; im.src = url; });
}
async function cargarTesela(clave, url) {
  try {
    let blob = await leer('teselas', clave).catch(() => null);
    if (!blob) {
      if (!navigator.onLine) { teselas.set(clave, { fallo: Date.now() }); return; }
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        blob = await r.blob();
        if (!/^image\//.test(blob.type) && blob.type) throw new Error('no es imagen');
        guardar('teselas', blob, clave).catch(() => {});
      } catch (e) {
        // Sin permiso CORS: se muestra igual con <img>, pero queda "sucia".
        try { const im = await imagenSinPermiso(url); recortarMemoria(); teselas.set(clave, { img: im, sucia: true }); pedirDibujo(); }
        catch (e2) { teselas.set(clave, { fallo: Date.now() }); }
        return;
      }
    }
    const img = await createImageBitmap(blob);
    recortarMemoria();
    teselas.set(clave, { img, sucia: false });
    pedirDibujo();
  } catch (e) { teselas.set(clave, { fallo: Date.now() }); }
}
function recortarMemoria() {
  if (teselas.size > 500) for (const k of [...teselas.keys()].slice(0, 200)) teselas.delete(k);
}

// Pedido GetMap de WMS para un cuadrito, en Web Mercator (EPSG:3857).
const MERC_MAX = 20037508.342789244;
export function urlWMS(capa, z, x, y) {
  const n = 2 ** z, lado = (MERC_MAX * 2) / n;
  const minx = -MERC_MAX + x * lado, maxx = minx + lado;
  const maxy = MERC_MAX - y * lado, miny = maxy - lado;
  const v = capa.version || '1.3.0';
  const p = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: v, LAYERS: capa.capaServicio || '', STYLES: '',
    FORMAT: 'image/png', TRANSPARENT: 'true', WIDTH: '256', HEIGHT: '256'
  });
  const crs = v === '1.3.0' ? 'CRS=EPSG:3857' : 'SRS=EPSG:3857';
  return `${capa.url.split('?')[0]}?${p}&${crs}&BBOX=${minx},${miny},${maxx},${maxy}`;
}

/* --- Inicio --- */
export function iniciarMapa(canvas, opciones = {}) {
  cv = canvas; ctx = cv.getContext('2d');
  alTocar = opciones.alTocar || alTocar;
  alMover = opciones.alMover || alMover;
  alMantener = opciones.alMantener || alMantener;
  new ResizeObserver(medir).observe(cv.parentElement);
  conectarGestos();
  medir();
}
function medir() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.parentElement.getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  dibujar();
}
let pendiente = false;
export function pedirDibujo() {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => { pendiente = false; dibujar(); });
}
function dibujar() {
  if (!W || !ctx) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ultimaTransf = pintar(ctx, W, H, {});
}

/* --- Estilo de capas (igual que Android) --- */
export function estiloCapa(c) {
  return { color: c.color || '#E0A458', punto: c.punto || 'circulo', grosor: c.grosor || 2, tam: c.tam || 5,
           opacidad: c.opacidad != null ? c.opacidad : 0.2 };
}
// Color de un elemento según la simbología por atributo (o el color de la capa).
export function colorElemento(c, f) {
  const sim = c.simbologia;
  if (sim && sim.campo) {
    const v = f.properties ? f.properties[sim.campo] : undefined;
    return (sim.categorias && sim.categorias[String(v)]) || sim.defecto || c.color || '#E0A458';
  }
  return c.color || '#E0A458';
}
// ¿El elemento está oculto? (por el filtro de la capa o por su categoría en la simbología)
export function elementoOculto(c, f) {
  if (!pasaFiltro(c, f)) return true;
  const sim = c.simbologia;
  if (!sim || !sim.campo || !sim.ocultas) return false;
  return !!sim.ocultas[f.properties ? String(f.properties[sim.campo]) : 'undefined'];
}
export function rgba(hex, a) {
  let h = (hex || '#E0A458').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function simbolo(g, p, est) {
  const r = est.tam, color = est.color;
  g.beginPath();
  if (est.punto === 'cuadro') g.rect(p.x - r, p.y - r, 2 * r, 2 * r);
  else if (est.punto === 'triangulo') { g.moveTo(p.x, p.y - r); g.lineTo(p.x + r, p.y + r); g.lineTo(p.x - r, p.y + r); g.closePath(); }
  else if (est.punto === 'rombo') { g.moveTo(p.x, p.y - r); g.lineTo(p.x + r, p.y); g.lineTo(p.x, p.y + r); g.lineTo(p.x - r, p.y); g.closePath(); }
  else if (est.punto === 'cruz' || est.punto === 'aspa') {
    if (est.punto === 'cruz') { g.moveTo(p.x - r, p.y); g.lineTo(p.x + r, p.y); g.moveTo(p.x, p.y - r); g.lineTo(p.x, p.y + r); }
    else { g.moveTo(p.x - r, p.y - r); g.lineTo(p.x + r, p.y + r); g.moveTo(p.x + r, p.y - r); g.lineTo(p.x - r, p.y + r); }
    g.strokeStyle = color; g.lineWidth = est.grosor + 1; g.stroke(); return;
  } else g.arc(p.x, p.y, r, 0, 7);
  g.fillStyle = color; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#0A1214'; g.stroke();
}
function dibujarGeom(g, geom, aPant, est) {
  const linea = (coords, cerrar) => {
    g.beginPath();
    let lx = 0, ly = 0;
    for (let i = 0; i < coords.length; i++) {
      const p = aPant(coords[i][1], coords[i][0]);
      if (i === 0) { g.moveTo(p.x, p.y); lx = p.x; ly = p.y; }
      else if (i === coords.length - 1 || Math.abs(p.x - lx) + Math.abs(p.y - ly) >= 0.8) { g.lineTo(p.x, p.y); lx = p.x; ly = p.y; }
    }
    if (cerrar) { g.closePath(); if (est.opacidad > 0) { g.fillStyle = rgba(est.color, est.opacidad); g.fill(); } }
    g.strokeStyle = est.color; g.lineWidth = est.grosor; g.stroke();
  };
  const punto = c => simbolo(g, aPant(c[1], c[0]), est);
  switch (geom.type) {
    case 'Point': punto(geom.coordinates); break;
    case 'MultiPoint': geom.coordinates.forEach(punto); break;
    case 'LineString': linea(geom.coordinates, false); break;
    case 'MultiLineString': geom.coordinates.forEach(l => linea(l, false)); break;
    case 'Polygon': geom.coordinates.forEach(r => linea(r, true)); break;
    case 'MultiPolygon': geom.coordinates.forEach(pol => pol.forEach(r => linea(r, true))); break;
    case 'GeometryCollection': (geom.geometries || []).forEach(gg => dibujarGeom(g, gg, aPant, est)); break;
  }
}
// Punto donde colgar la etiqueta de una geometría.
function centroAnillo(r) { if (!r || !r.length) return null; let x = 0, y = 0; for (const c of r) { x += c[0]; y += c[1]; } return [x / r.length, y / r.length]; }
function ancla(g) {
  switch (g && g.type) {
    case 'Point': return g.coordinates;
    case 'MultiPoint': return g.coordinates[0];
    case 'LineString': return g.coordinates[Math.floor(g.coordinates.length / 2)];
    case 'MultiLineString': { const l = g.coordinates[0]; return l && l[Math.floor(l.length / 2)]; }
    case 'Polygon': return centroAnillo(g.coordinates[0]);
    case 'MultiPolygon': return centroAnillo(g.coordinates[0] && g.coordinates[0][0]);
    case 'GeometryCollection': for (const gg of g.geometries || []) { const a = ancla(gg); if (a) return a; } return null;
  }
  return null;
}
function etiqueta(g, x, y, txt) {
  g.font = '600 11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const tw = g.measureText(txt).width;
  g.fillStyle = 'rgba(10,18,20,.72)'; g.fillRect(x - tw / 2 - 3, y - 7, tw + 6, 14);
  g.lineWidth = 3; g.strokeStyle = 'rgba(10,18,20,.92)'; g.strokeText(txt, x, y);
  g.fillStyle = '#DCE6E4'; g.fillText(txt, x, y);
}

// Cajas envolventes calculadas, guardadas aparte para no ensuciar los datos.
const cajas = new WeakMap();
export function cajaGeom(g) {
  const a = [Infinity, Infinity, -Infinity, -Infinity];
  const ext = c => { if (c[0] < a[0]) a[0] = c[0]; if (c[1] < a[1]) a[1] = c[1]; if (c[0] > a[2]) a[2] = c[0]; if (c[1] > a[3]) a[3] = c[1]; };
  const rec = co => { if (!co || !co.length) return; if (typeof co[0] === 'number') ext(co); else for (const c of co) rec(c); };
  if (g.type === 'GeometryCollection') for (const gg of g.geometries || []) { const b = cajaGeom(gg); ext([b[0], b[1]]); ext([b[2], b[3]]); }
  else rec(g.coordinates);
  return a;
}
export function cajaDe(f) { let b = cajas.get(f); if (!b) { b = cajaGeom(f.geometry); cajas.set(f, b); } return b; }
export function olvidarCajas(fc) { for (const f of fc.features || []) cajas.delete(f); }

/* --- Pintar el mapa en cualquier lienzo (pantalla o exportación) ---
   opciones.sinSucias: no dibujar imágenes sin permiso (para exportar).
   Devuelve la transformación usada. */
export function pintar(g, ancho, alto, opciones) {
  g.fillStyle = '#16211F'; g.fillRect(0, 0, ancho, alto);
  const fondo = FONDOS[S.ajustes.fondo] || FONDOS.sat;
  const zi = Math.max(2, Math.min(fondo.max, Math.round(vista.zoom)));
  const esc = 2 ** (vista.zoom - zi);
  const ts = 256 * esc;
  const x0 = lon2px(vista.lon, zi) - (ancho / 2) / esc, y0 = lat2px(vista.lat, zi) - (alto / 2) / esc;
  const tx0 = Math.floor(x0 / 256), ty0 = Math.floor(y0 / 256);
  const tx1 = Math.floor((x0 + ancho / esc) / 256), ty1 = Math.floor((y0 + alto / esc) / 256);
  const n = 2 ** zi;
  let omitidas = 0;
  const pintarTeselas = (prefijo, urlDe) => {
    let faltan = false;
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        const xx = ((tx % n) + n) % n;
        const t = tesela(`${prefijo}/${zi}/${xx}/${ty}`, urlDe(zi, xx, ty));
        if (!t) { faltan = true; continue; }
        if (t.sucia && opciones.sinSucias) { omitidas++; continue; }
        g.drawImage(t.img, Math.round((tx * 256 - x0) * esc), Math.round((ty * 256 - y0) * esc), Math.ceil(ts) + 1, Math.ceil(ts) + 1);
      }
    }
    return faltan;
  };
  // 1. Fondo
  const faltaFondo = fondo.url ? pintarTeselas(S.ajustes.fondo, fondo.url) : false;
  // 2. WMS
  for (const c of S.capas) if (c.tipo === 'wms' && capaVisible(c.id)) pintarTeselas('wms_' + c.id, (z, x, y) => urlWMS(c, z, x, y));

  const aPant = (lat, lon) => ({ x: (lon2px(lon, zi) - x0) * esc, y: (lat2px(lat, zi) - y0) * esc });
  const oLon = px2lon(x0, zi), eLon = px2lon(x0 + ancho / esc, zi);
  const nLat = px2lat(y0, zi), sLat = px2lat(y0 + alto / esc, zi);
  const mLon = (eLon - oLon) * 0.1, mLat = (nLat - sLat) * 0.1;
  const caja = { oLon: oLon - mLon, eLon: eLon + mLon, nLat: nLat + mLat, sLat: sLat - mLat };
  const transf = { zi, x0, y0, esc, aPant, oLon, eLon, nLat, sLat, ancho, alto };

  // 3. Capas vectoriales y grandes
  g.lineJoin = g.lineCap = 'round';
  for (const c of S.capas) {
    if (!capaVisible(c.id)) continue;
    const est = estiloCapa(c);
    if (c.tipo === 'grande' && c.grande) { try { dibujarGrande(g, c.grande, aPant, caja, est, (p, e) => simbolo(g, p, e), rgba); } catch (e) { /* sigue */ } continue; }
    if (c.tipo !== 'vector' || !c.geojson) continue;
    const resaltada = capaResaltada === c.id;
    const rotulos = [];
    for (const f of c.geojson.features || []) {
      if (!f || !f.geometry || elementoOculto(c, f)) continue;
      const b = cajaDe(f);
      if (b[2] < caja.oLon || b[0] > caja.eLon || b[3] < caja.sLat || b[1] > caja.nLat) continue;
      dibujarGeom(g, f.geometry, aPant, { ...est, color: colorElemento(c, f) });
      if (resaltada) dibujarGeom(g, f.geometry, aPant, { ...est, color: '#F2C94C', grosor: est.grosor + 3, tam: est.tam + 3, opacidad: 0 });
      if (c.etiqueta && f.properties) {
        const v = f.properties[c.etiqueta];
        if (v != null && v !== '') {
          const a = ancla(f.geometry);
          if (a) { const s = aPant(a[1], a[0]); if (s.x > -40 && s.x < ancho + 40 && s.y > -20 && s.y < alto + 20) rotulos.push([s.x, s.y, String(v), /Point/.test(f.geometry.type), est.tam]); }
        }
      }
    }
    // Etiquetas al costado del símbolo, sin encimarse (igual que Android).
    const puestas = [];
    const choca = (a, b, c2, d) => puestas.some(o => !(c2 < o[0] || a > o[2] || d < o[1] || b > o[3]));
    g.font = '600 11px system-ui';
    for (const [ax, ay, t, esPunto, tam] of rotulos) {
      const txt = t.length > 28 ? t.slice(0, 27) + '…' : t;
      const tw = g.measureText(txt).width, th = 14, off = (esPunto ? tam + 6 : 4) + 6;
      const cand = [[ax + tw / 2 + off, ay], [ax - tw / 2 - off, ay], [ax, ay + th / 2 + off], [ax, ay - th / 2 - off],
        [ax + tw / 2 + off, ay + th / 2 + off], [ax + tw / 2 + off, ay - th / 2 - off], [ax - tw / 2 - off, ay + th / 2 + off], [ax - tw / 2 - off, ay - th / 2 - off]];
      let [ex, ey] = cand[0];
      for (const [cx, cy] of cand) if (!choca(cx - tw / 2 - 2, cy - th / 2 - 2, cx + tw / 2 + 2, cy + th / 2 + 2)) { ex = cx; ey = cy; break; }
      puestas.push([ex - tw / 2 - 2, ey - th / 2 - 2, ex + tw / 2 + 2, ey + th / 2 + 2]);
      etiqueta(g, ex, ey, txt);
    }
  }

  // 4. Puntos capturados (promediados con doble anillo, como Android)
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  for (const p of S.puntos) {
    if (p.visible === false) continue;
    const s = aPant(p.lat, p.lon);
    if (s.x < -40 || s.x > ancho + 40 || s.y < -40 || s.y > alto + 40) continue;
    const esDest = S.destino && S.destino.id === p.id;
    if (p.promediado) {
      g.beginPath(); g.arc(s.x, s.y, 8, 0, 7); g.lineWidth = 2; g.strokeStyle = '#4FD1C5'; g.stroke();
      g.beginPath(); g.arc(s.x, s.y, 5, 0, 7); g.fillStyle = '#4FD1C5'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#0A1214'; g.stroke();
    } else {
      g.beginPath(); g.arc(s.x, s.y, esDest ? 8 : 6, 0, 7);
      g.fillStyle = esDest ? '#4FD1C5' : '#F4F7F6'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0A1214'; g.stroke();
    }
    g.font = '600 12px system-ui'; g.lineWidth = 3; g.strokeStyle = 'rgba(10,18,20,.9)';
    g.strokeText(p.nombre, s.x, s.y - 12); g.fillStyle = '#F4F7F6'; g.fillText(p.nombre, s.x, s.y - 12);
  }

  // 5. Herramientas, navegación y mi posición
  for (const fn of sobrecapas) { try { fn(g, aPant, transf); } catch (e) { /* sigue */ } }
  if (S.fix && S.destino) {
    const a = aPant(S.fix.lat, S.fix.lon), b = aPant(S.destino.lat, S.destino.lon);
    g.setLineDash([8, 6]); g.strokeStyle = '#E0A458'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
  }
  if (S.destino && !S.puntos.some(p => p.id === S.destino.id)) {
    const b = aPant(S.destino.lat, S.destino.lon);
    g.beginPath(); g.arc(b.x, b.y, 7, 0, 7); g.fillStyle = '#E0A458'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0A1214'; g.stroke();
  }
  if (S.fix && !opciones.sinPosicion) {
    const s = aPant(S.fix.lat, S.fix.lon);
    const mPorPx = 156543.03392 * Math.cos(S.fix.lat * D2R) / 2 ** vista.zoom;
    const rad = (S.fix.precision || 0) / mPorPx;
    if (rad > 3 && rad < 4000) {
      g.beginPath(); g.arc(s.x, s.y, rad, 0, 7);
      g.fillStyle = 'rgba(79,209,197,.12)'; g.fill(); g.strokeStyle = 'rgba(79,209,197,.6)'; g.lineWidth = 1; g.stroke();
    }
    g.beginPath(); g.arc(s.x, s.y, 8, 0, 7);
    g.fillStyle = '#4FD1C5'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#0A1214'; g.stroke();
  }
  if (opciones.sinEscala) return { ...transf, omitidas };

  // Barra de escala, créditos y aviso sin conexión
  const mPx = 156543.03392 * Math.cos(vista.lat * D2R) / 2 ** vista.zoom;
  const obj = 90 * mPx, p10 = 10 ** Math.floor(Math.log10(obj));
  const metros = p10 * ([1, 2, 5, 10].find(m => p10 * m >= obj) || 10), anchoB = metros / mPx;
  g.strokeStyle = '#F4F7F6'; g.lineWidth = 2; g.beginPath();
  g.moveTo(12, alto - 18); g.lineTo(12, alto - 12); g.lineTo(12 + anchoB, alto - 12); g.lineTo(12 + anchoB, alto - 18); g.stroke();
  const et = metros >= 1000 ? (metros / 1000) + ' km' : metros + ' m';
  g.font = '600 11px ui-monospace, monospace'; g.textAlign = 'left';
  g.lineWidth = 3; g.strokeStyle = 'rgba(10,18,20,.9)'; g.strokeText(et, 12, alto - 22);
  g.fillStyle = '#F4F7F6'; g.fillText(et, 12, alto - 22);
  g.font = '10px system-ui'; g.textAlign = 'right';
  if (fondo.cred) { g.strokeText(fondo.cred, ancho - 8, alto - 8); g.fillStyle = 'rgba(244,247,246,.75)'; g.fillText(fondo.cred, ancho - 8, alto - 8); }
  if (faltaFondo && !navigator.onLine) {
    g.textAlign = 'center'; g.font = '600 12px system-ui';
    const msg = 'Sin conexión: esta zona del fondo no está guardada.';
    g.lineWidth = 4; g.strokeText(msg, ancho / 2, alto - 44); g.fillStyle = '#E0A458'; g.fillText(msg, ancho / 2, alto - 44);
  }
  return { ...transf, omitidas };
}

/* --- Movimiento del mapa --- */
export function irA(lat, lon, zoom) {
  vista.lat = lat; vista.lon = lon;
  if (zoom != null) vista.zoom = Math.max(2, Math.min(20, zoom));
  pedirDibujo(); alMover();
}
export function cambiarZoom(d) { vista.zoom = Math.max(2, Math.min(20, vista.zoom + d)); pedirDibujo(); alMover(); }
// Encuadra una caja [oeste, sur, este, norte].
export function encuadrar(b) {
  if (!b || !isFinite(b[0])) return;
  S.seguir = false;
  const lat = (b[1] + b[3]) / 2, lon = (b[0] + b[2]) / 2;
  // Tamaño de la caja en píxeles al zoom 0; cada nivel de zoom lo duplica.
  const anchoPx = lon2px(b[2], 0) - lon2px(b[0], 0);
  const altoPx = lat2px(b[1], 0) - lat2px(b[3], 0);
  const z = Math.log2(Math.min((W * 0.8) / anchoPx, (H * 0.8) / altoPx));
  irA(lat, lon, Math.min(17, isFinite(z) ? z : 17));   // un solo punto: zoom 17
}
function mover(dx, dy) {
  const z = vista.zoom;
  vista.lon = px2lon(lon2px(vista.lon, z) + dx, z);
  vista.lat = Math.max(-85, Math.min(85, px2lat(lat2px(vista.lat, z) + dy, z)));
  pedirDibujo();
}
// Toque en pantalla → lat/lon, y al revés.
export function pantallaALatLon(px, py) {
  const t = ultimaTransf; if (!t) return null;
  return { lat: px2lat(t.y0 + py / t.esc, t.zi), lon: px2lon(t.x0 + px / t.esc, t.zi) };
}
export function aPantalla(lat, lon) { return ultimaTransf ? ultimaTransf.aPant(lat, lon) : null; }
export function vistaActual() { return ultimaTransf ? { ...ultimaTransf, ancho: W, alto: H } : null; }
export function tamanoMapa() { return { W, H }; }

/* --- Gestos: arrastrar, pellizcar, rueda, tocar y mantener presionado --- */
function conectarGestos() {
  const toques = new Map();
  let distAnt = 0, inicio = null, temporizador = null;
  const cancelarMantener = () => { if (temporizador) { clearTimeout(temporizador); temporizador = null; } };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    inicio = toques.size === 1 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
    if (toques.size === 2) { const [a, b] = [...toques.values()]; distAnt = Math.hypot(a.x - b.x, a.y - b.y); }
    cancelarMantener();
    if (toques.size === 1) {
      const cx = e.clientX, cy = e.clientY;
      // Mantener presionado 600 ms = menú Consultar / Chincheta (como Android).
      temporizador = setTimeout(() => {
        temporizador = null; inicio = null;
        const r = cv.getBoundingClientRect();
        alMantener(cx, cy, cx - r.left, cy - r.top);
      }, 600);
    }
  });
  cv.addEventListener('pointermove', e => {
    if (!toques.has(e.pointerId)) return;
    const ant = toques.get(e.pointerId);
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (toques.size === 1) {
      const dx = e.clientX - ant.x, dy = e.clientY - ant.y;
      if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 10) cancelarMantener();
      if (Math.abs(dx) + Math.abs(dy) > 1) S.seguir = false;
      mover(-dx, -dy);
    } else if (toques.size === 2) {
      cancelarMantener();
      const [a, b] = [...toques.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (distAnt > 0) vista.zoom = Math.max(2, Math.min(20, vista.zoom + Math.log2(d / distAnt)));
      distAnt = d; S.seguir = false; pedirDibujo();
    }
  });
  const soltar = e => {
    cancelarMantener();
    if (e.type === 'pointerup' && inicio && toques.size === 1) {
      const mov = Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y);
      if (mov < 20 && Date.now() - inicio.t < 600) {
        const r = cv.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const ll = pantallaALatLon(px, py);
        if (ll) alTocar(ll.lat, ll.lon, px, py);
      }
    }
    toques.delete(e.pointerId); distAnt = 0;
    if (toques.size === 0) { inicio = null; alMover(); }
  };
  cv.addEventListener('pointerup', soltar);
  cv.addEventListener('pointercancel', soltar);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    vista.zoom = Math.max(2, Math.min(20, vista.zoom - Math.sign(e.deltaY) * 0.5));
    S.seguir = false; pedirDibujo(); alMover();
  }, { passive: false });
}

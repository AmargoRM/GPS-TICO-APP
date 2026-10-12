/* =======================================================================
   VISOR DE MAPA (propio, dibujado sobre un <canvas>, sin librerías)
   Adaptado del GPS TICO original.

   Orden de dibujo (de abajo hacia arriba):
   1. Fondo (satélite o calles). NECESITA INTERNET; si no hay, se ve liso.
   2. Capas WMS (imágenes de un servidor; también necesitan internet).
   3. Capas vectoriales (archivo o URL).
   4. Puntos capturados.
   5. Línea de navegación, mi posición y su círculo de precisión.
   Las capas de archivo y los puntos están guardados en el celular, así que
   se ven aunque el fondo no cargue.
   ======================================================================= */
import { S, capaVisible } from './estado.js';
import { D2R, R2D } from './geodesia.js';

// Fondos disponibles. Son servicios públicos gratuitos (no son míos ni tuyos).
export const FONDOS = {
  sat:    { nom: 'Satélite', url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, cred: 'Esri, Maxar, Earthstar Geographics' },
  calles: { nom: 'Calles', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, cred: '© OpenStreetMap' },
  ninguno:{ nom: 'Sin fondo', url: null, max: 21, cred: '' }
};

let cv, ctx, DPR = 1, W = 0, H = 0;
export const vista = { lat: 9.93, lon: -84.08, zoom: 8 };   // arranca sobre Costa Rica
let ultimaTransf = null;                                      // para convertir toques a lat/lon
let alTocar = () => {}, alMover = () => {};

/* --- Conversión entre lat/lon y píxeles (Web Mercator, como Google/OSM) --- */
function lon2px(lon, z) { return (lon + 180) / 360 * 256 * 2 ** z; }
function lat2px(lat, z) {
  const s = Math.sin(lat * D2R);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
}
function px2lon(x, z) { return x / (256 * 2 ** z) * 360 - 180; }
function px2lat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (256 * 2 ** z);
  return R2D * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/* --- Teselas (cuadritos de imagen del fondo y de WMS) --- */
// Se usan <img> comunes: así no hace falta permiso CORS del servidor para VERLAS.
const teselas = new Map();   // clave → {img, ok, fallo}
function tesela(clave, url) {
  let t = teselas.get(clave);
  if (t) {
    if (t.fallo && Date.now() - t.fallo > 30000) { teselas.delete(clave); t = null; }   // reintenta cada 30 s
    else return t.ok ? t.img : null;
  }
  if (!navigator.onLine) return null;
  t = { img: new Image(), ok: false, fallo: 0 };
  t.img.onload = () => { t.ok = true; pedirDibujo(); };
  t.img.onerror = () => { t.fallo = Date.now(); };
  t.img.src = url;
  teselas.set(clave, t);
  if (teselas.size > 500) {   // limpiar memoria
    for (const k of Array.from(teselas.keys()).slice(0, 200)) teselas.delete(k);
  }
  return null;
}

// Arma el pedido GetMap de WMS para un cuadrito, en Web Mercator (EPSG:3857).
const MERC_MAX = 20037508.342789244;
export function urlWMS(capa, z, x, y) {
  const n = 2 ** z, lado = (MERC_MAX * 2) / n;
  const minx = -MERC_MAX + x * lado, maxx = minx + lado;
  const maxy = MERC_MAX - y * lado, miny = maxy - lado;
  const v = capa.version || '1.3.0';
  const base = capa.url.split('?')[0];
  const p = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: v, LAYERS: capa.capaServicio || '', STYLES: '',
    FORMAT: 'image/png', TRANSPARENT: 'true', WIDTH: '256', HEIGHT: '256'
  });
  const crs = v === '1.3.0' ? 'CRS=EPSG:3857' : 'SRS=EPSG:3857';
  return `${base}?${p}&${crs}&BBOX=${minx},${miny},${maxx},${maxy}`;
}

/* --- Inicio --- */
export function iniciarMapa(canvas, opciones = {}) {
  cv = canvas; ctx = cv.getContext('2d');
  alTocar = opciones.alTocar || alTocar;
  alMover = opciones.alMover || alMover;
  new ResizeObserver(medir).observe(cv.parentElement);
  conectarGestos();
  medir();
}
function medir() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.parentElement.getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  dibujar();
}

let pendiente = false;
export function pedirDibujo() {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => { pendiente = false; dibujar(); });
}

/* --- Dibujo --- */
function dibujar() {
  if (!W || !ctx) return;
  ctx.fillStyle = '#16211F'; ctx.fillRect(0, 0, W, H);

  const fondo = FONDOS[S.ajustes.fondo] || FONDOS.sat;
  const zi = Math.max(2, Math.min(fondo.max, Math.round(vista.zoom)));
  const esc = 2 ** (vista.zoom - zi);
  const ts = 256 * esc;
  const x0 = lon2px(vista.lon, zi) - (W / 2) / esc, y0 = lat2px(vista.lat, zi) - (H / 2) / esc;
  const tx0 = Math.floor(x0 / 256), ty0 = Math.floor(y0 / 256);
  const tx1 = Math.floor((x0 + W / esc) / 256), ty1 = Math.floor((y0 + H / esc) / 256);
  const n = 2 ** zi;

  // 1. Fondo
  let faltanTeselas = false;
  if (fondo.url) {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        const xx = ((tx % n) + n) % n;
        const img = tesela(`${S.ajustes.fondo}/${zi}/${xx}/${ty}`, fondo.url(zi, xx, ty));
        if (img) ctx.drawImage(img, Math.round((tx * 256 - x0) * esc), Math.round((ty * 256 - y0) * esc), Math.ceil(ts) + 1, Math.ceil(ts) + 1);
        else faltanTeselas = true;
      }
    }
  }
  // 2. Capas WMS
  for (const capa of S.capas) {
    if (capa.tipo !== 'wms' || !capaVisible(capa.id)) continue;
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        const xx = ((tx % n) + n) % n;
        const img = tesela(`wms_${capa.id}/${zi}/${xx}/${ty}`, urlWMS(capa, zi, xx, ty));
        if (img) ctx.drawImage(img, Math.round((tx * 256 - x0) * esc), Math.round((ty * 256 - y0) * esc), Math.ceil(ts) + 1, Math.ceil(ts) + 1);
      }
    }
  }

  const aPant = (lat, lon) => ({ x: (lon2px(lon, zi) - x0) * esc, y: (lat2px(lat, zi) - y0) * esc });
  ultimaTransf = { zi, x0, y0, esc, aPant };

  // Área visible (con margen) para no dibujar lo que no se ve.
  const oLon = px2lon(x0, zi), eLon = px2lon(x0 + W / esc, zi);
  const nLat = px2lat(y0, zi), sLat = px2lat(y0 + H / esc, zi);
  const mLon = (eLon - oLon) * 0.1, mLat = (nLat - sLat) * 0.1;
  const caja = { oLon: oLon - mLon, eLon: eLon + mLon, nLat: nLat + mLat, sLat: sLat - mLat };

  // 3. Capas vectoriales
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const capa of S.capas) {
    if (capa.tipo === 'wms' || !capaVisible(capa.id)) continue;
    const fc = capa.origen === 'archivo' ? capa.geojson : S.datosURL.get(capa.id);
    if (!fc) continue;
    for (const f of fc.features || []) {
      if (!f || !f.geometry) continue;
      let b = cajas.get(f);
      if (!b) { b = cajaGeom(f.geometry); cajas.set(f, b); }
      if (b[2] < caja.oLon || b[0] > caja.eLon || b[3] < caja.sLat || b[1] > caja.nLat) continue;
      dibujarGeom(f.geometry, aPant, capa.color || '#E0A458');
    }
  }

  // 4. Puntos capturados
  ctx.font = '600 12px system-ui'; ctx.textAlign = 'center';
  for (const p of S.puntos) {
    const s = aPant(p.lat, p.lon);
    if (s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) continue;
    const esDest = S.destino && S.destino.id === p.id;
    ctx.beginPath(); ctx.arc(s.x, s.y, esDest ? 8 : 6, 0, 7);
    ctx.fillStyle = esDest ? '#4FD1C5' : '#F4F7F6'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#0A1214'; ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,18,20,.9)';
    ctx.strokeText(p.nombre, s.x, s.y - 12); ctx.fillStyle = '#F4F7F6'; ctx.fillText(p.nombre, s.x, s.y - 12);
  }

  // 5. Navegación y mi posición
  if (S.fix && S.destino) {
    const a = aPant(S.fix.lat, S.fix.lon), b = aPant(S.destino.lat, S.destino.lon);
    ctx.setLineDash([8, 6]); ctx.strokeStyle = '#4FD1C5'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.fix) {
    const s = aPant(S.fix.lat, S.fix.lon);
    const mPorPx = 156543.03392 * Math.cos(S.fix.lat * D2R) / 2 ** vista.zoom;
    const rad = (S.fix.precision || 0) / mPorPx;
    if (rad > 3 && rad < 4000) {
      ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, 7);
      ctx.fillStyle = 'rgba(79,209,197,.12)'; ctx.fill();
      ctx.strokeStyle = 'rgba(79,209,197,.6)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, 7);
    ctx.fillStyle = '#4FD1C5'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#0A1214'; ctx.stroke();
  }

  // Barra de escala
  const mPx = 156543.03392 * Math.cos(vista.lat * D2R) / 2 ** vista.zoom;
  const obj = 90 * mPx, p10 = 10 ** Math.floor(Math.log10(obj));
  const metros = p10 * ([1, 2, 5, 10].find(m => p10 * m >= obj) || 10), ancho = metros / mPx;
  ctx.strokeStyle = '#F4F7F6'; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(12, H - 18); ctx.lineTo(12, H - 12); ctx.lineTo(12 + ancho, H - 12); ctx.lineTo(12 + ancho, H - 18); ctx.stroke();
  const et = metros >= 1000 ? (metros / 1000) + ' km' : metros + ' m';
  ctx.font = '600 11px ui-monospace, monospace'; ctx.textAlign = 'left';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,18,20,.9)'; ctx.strokeText(et, 12, H - 22);
  ctx.fillStyle = '#F4F7F6'; ctx.fillText(et, 12, H - 22);
  // Créditos del fondo y aviso si no carga
  ctx.font = '10px system-ui'; ctx.textAlign = 'right';
  if (fondo.cred) { ctx.strokeText(fondo.cred, W - 8, H - 8); ctx.fillStyle = 'rgba(244,247,246,.75)'; ctx.fillText(fondo.cred, W - 8, H - 8); }
  if (fondo.url && faltanTeselas && !navigator.onLine) {
    ctx.textAlign = 'center'; ctx.font = '600 12px system-ui';
    const msg = 'Sin conexión: el fondo no carga. Tus capas y puntos sí se ven.';
    ctx.lineWidth = 4; ctx.strokeText(msg, W / 2, H - 44); ctx.fillStyle = '#E0A458'; ctx.fillText(msg, W / 2, H - 44);
  }
}

// Cajas calculadas, guardadas aparte (WeakMap) para no ensuciar los datos.
const cajas = new WeakMap();
// Caja envolvente [oeste, sur, este, norte] de una geometría.
export function cajaGeom(g) {
  const a = [Infinity, Infinity, -Infinity, -Infinity];
  const ext = c => { if (c[0] < a[0]) a[0] = c[0]; if (c[1] < a[1]) a[1] = c[1]; if (c[0] > a[2]) a[2] = c[0]; if (c[1] > a[3]) a[3] = c[1]; };
  const rec = co => { if (!co || !co.length) return; if (typeof co[0] === 'number') ext(co); else for (const c of co) rec(c); };
  if (g.type === 'GeometryCollection') for (const gg of g.geometries || []) { const b = cajaGeom(gg); ext([b[0], b[1]]); ext([b[2], b[3]]); }
  else rec(g.coordinates);
  return a;
}
function rgba(hex, al) {
  const n = parseInt((hex || '#E0A458').replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${al})`;
}
function dibujarGeom(g, aPant, color) {
  const linea = (coords, cerrar) => {
    ctx.beginPath();
    let lx = 0, ly = 0;
    for (let i = 0; i < coords.length; i++) {
      const p = aPant(coords[i][1], coords[i][0]);
      if (i === 0) { ctx.moveTo(p.x, p.y); lx = p.x; ly = p.y; }
      else if (i === coords.length - 1 || Math.abs(p.x - lx) + Math.abs(p.y - ly) >= 0.8) { ctx.lineTo(p.x, p.y); lx = p.x; ly = p.y; }
    }
    if (cerrar) { ctx.closePath(); ctx.fillStyle = rgba(color, 0.18); ctx.fill(); }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  };
  const punto = c => {
    const p = aPant(c[1], c[0]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7);
    ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#0A1214'; ctx.stroke();
  };
  switch (g.type) {
    case 'Point': punto(g.coordinates); break;
    case 'MultiPoint': g.coordinates.forEach(punto); break;
    case 'LineString': linea(g.coordinates, false); break;
    case 'MultiLineString': g.coordinates.forEach(l => linea(l, false)); break;
    case 'Polygon': g.coordinates.forEach(r => linea(r, true)); break;
    case 'MultiPolygon': g.coordinates.forEach(pol => pol.forEach(r => linea(r, true))); break;
    case 'GeometryCollection': (g.geometries || []).forEach(gg => dibujarGeom(gg, aPant, color)); break;
  }
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
// Convierte un toque en pantalla a lat/lon.
function pantallaALatLon(px, py) {
  const t = ultimaTransf; if (!t) return null;
  return { lat: px2lat(t.y0 + py / t.esc, t.zi), lon: px2lon(t.x0 + px / t.esc, t.zi) };
}
// Posición en pantalla de un lat/lon (para buscar qué se tocó).
export function aPantalla(lat, lon) { return ultimaTransf ? ultimaTransf.aPant(lat, lon) : null; }

/* --- Gestos: arrastrar, pellizcar, rueda del mouse, toque --- */
function conectarGestos() {
  const toques = new Map();
  let distAnt = 0, inicio = null;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    inicio = toques.size === 1 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
    if (toques.size === 2) { const [a, b] = [...toques.values()]; distAnt = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  cv.addEventListener('pointermove', e => {
    if (!toques.has(e.pointerId)) return;
    const ant = toques.get(e.pointerId);
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (toques.size === 1) {
      const dx = e.clientX - ant.x, dy = e.clientY - ant.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) S.seguir = false;
      mover(-dx, -dy);
    } else if (toques.size === 2) {
      const [a, b] = [...toques.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (distAnt > 0) vista.zoom = Math.max(2, Math.min(20, vista.zoom + Math.log2(d / distAnt)));
      distAnt = d; S.seguir = false; pedirDibujo();
    }
  });
  const soltar = e => {
    if (e.type === 'pointerup' && inicio && toques.size === 1) {
      const mov = Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y);
      if (mov < 12 && Date.now() - inicio.t < 600) {
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
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    vista.zoom = Math.max(2, Math.min(20, vista.zoom - Math.sign(e.deltaY) * 0.5));
    S.seguir = false; pedirDibujo(); alMover();
  }, { passive: false });
}

/* --- ¿Qué hay donde toqué? --- */
// Devuelve {tipo:'punto', punto} o {tipo:'elemento', capa, feature} o null.
export function buscarEn(px, py, lat, lon) {
  // Primero, puntos capturados (radio de 24 px).
  let mejor = null, dMejor = 24;
  for (const p of S.puntos) {
    const s = aPantalla(p.lat, p.lon); if (!s) continue;
    const d = Math.hypot(s.x - px, s.y - py);
    if (d < dMejor) { dMejor = d; mejor = p; }
  }
  if (mejor) return { tipo: 'punto', punto: mejor };
  // Después, elementos de capas vectoriales (de arriba hacia abajo).
  for (let i = S.capas.length - 1; i >= 0; i--) {
    const capa = S.capas[i];
    if (capa.tipo === 'wms' || !capaVisible(capa.id)) continue;
    const fc = capa.origen === 'archivo' ? capa.geojson : S.datosURL.get(capa.id);
    if (!fc) continue;
    let fMejor = null, dm = 16;
    for (const f of fc.features || []) {
      if (!f || !f.geometry) continue;
      const d = distGeom(f.geometry, px, py, lat, lon);
      if (d < dm) { dm = d; fMejor = f; }
    }
    if (fMejor) return { tipo: 'elemento', capa, feature: fMejor };
  }
  return null;
}
// Distancia en píxeles del toque a una geometría (0 si cae dentro de un polígono).
function distGeom(g, px, py, lat, lon) {
  const P = c => aPantalla(c[1], c[0]);
  const dPunto = c => { const s = P(c); return Math.hypot(s.x - px, s.y - py); };
  const dLinea = l => {
    let m = Infinity;
    for (let i = 1; i < l.length; i++) {
      const a = P(l[i - 1]), b = P(l[i]);
      const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
      const t = L ? Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / L)) : 0;
      m = Math.min(m, Math.hypot(a.x + t * vx - px, a.y + t * vy - py));
    }
    return m;
  };
  const dentro = anillo => {   // ¿lat/lon dentro del anillo? (rayo)
    let c = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const dPoligono = pol => (pol[0] && dentro(pol[0]) && !pol.slice(1).some(dentro)) ? 0 : Math.min(...pol.map(dLinea));
  switch (g.type) {
    case 'Point': return dPunto(g.coordinates);
    case 'MultiPoint': return Math.min(...g.coordinates.map(dPunto));
    case 'LineString': return dLinea(g.coordinates);
    case 'MultiLineString': return Math.min(...g.coordinates.map(dLinea));
    case 'Polygon': return dPoligono(g.coordinates);
    case 'MultiPolygon': return Math.min(...g.coordinates.map(dPoligono));
    case 'GeometryCollection': return Math.min(Infinity, ...(g.geometries || []).map(gg => distGeom(gg, px, py, lat, lon)));
  }
  return Infinity;
}

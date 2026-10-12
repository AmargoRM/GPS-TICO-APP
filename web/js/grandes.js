/* =======================================================================
   CAPAS GRANDES (GeoJSON de más de 8 MB) — copiado del GPS TICO original
   - Lectura por partes: no se carga todo el archivo en memoria.
   - Geometría en arreglos compactos (≈5 veces menos memoria).
   - Índice por grilla: dibuja y consulta solo lo visible.
   - Atributos guardados aparte (cajón "bigprops") en bloques de 1000;
     se leen solo al tocar un elemento.
   En capas grandes no hay etiquetas ni tabla completa; sí color, estilo y
   consulta al tocar (igual que en Android).
   ======================================================================= */
import { haciaWgs, dentroCR } from './geodesia.js';
import { guardar, leer } from './bd.js';

export const GRANDE_UMBRAL = 8 * 1048576;     // GeoJSON de archivo de más de 8 MB usa este motor
export const GRANDE_MAX = 400 * 1048576;      // tope razonable
export const BLOQUE_PROPS = 1000;             // atributos por bloque

// Busca el final de un objeto JSON respetando comillas y escapes.
function finObjeto(buf, ini) {
  let prof = 0, enTexto = false, escape = false;
  for (let i = ini; i < buf.length; i++) {
    const ch = buf[i];
    if (enTexto) { if (escape) escape = false; else if (ch === '\\') escape = true; else if (ch === '"') enTexto = false; }
    else if (ch === '"') enTexto = true; else if (ch === '{') prof++; else if (ch === '}') { if (--prof === 0) return i + 1; }
  }
  return -1;
}
// Entrega los elementos de un FeatureCollection de a uno, leyendo el archivo por partes.
async function* elementosPorPartes(flujoBytes) {
  const lector = flujoBytes.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '', fin = false;
  const llenar = async () => { if (fin) return false; const r = await lector.read(); if (r.done) { fin = true; return false; } buf += r.value; return true; };
  while (true) {   // ubicar  "features": [
    const k = buf.indexOf('"features"');
    if (k >= 0) { const b = buf.indexOf('[', k); if (b >= 0) { buf = buf.slice(b + 1); break; } }
    if (buf.length > (1 << 20)) buf = buf.slice(-16);
    if (!await llenar()) return;
  }
  let p = 0;
  while (true) {
    while (p < buf.length && ' \n\r\t,'.includes(buf[p])) p++;
    if (p >= buf.length) { buf = buf.slice(p); p = 0; if (!await llenar()) return; continue; }
    const ch = buf[p];
    if (ch === ']') return;
    if (ch === '{') {
      let f = finObjeto(buf, p);
      while (f < 0) { buf = buf.slice(p); p = 0; if (!await llenar()) return; f = finObjeto(buf, p); }
      let el = null; try { el = JSON.parse(buf.slice(p, f)); } catch (e) { /* elemento dañado: se salta */ }
      if (el) yield el;
      p = f;
      if (p > (1 << 20)) { buf = buf.slice(p); p = 0; }
    } else p++;
  }
}
function primeraCoord(g) {
  if (!g) return null;
  let hit = null; const rec = a => { if (hit || !Array.isArray(a)) return; if (typeof a[0] === 'number') hit = a; else for (const x of a) { rec(x); if (hit) return; } };
  if (g.type === 'GeometryCollection') (g.geometries || []).forEach(gg => rec(gg && gg.coordinates)); else rec(g.coordinates);
  return hit;
}
/* --- Constructor de geometría compacta --- */
function nuevo(ox, oy) {
  return { ox, oy, conv: null, coords: new Float32Array(4096), cn: 0, partStart: [], featPartStart: [], featType: [], featBBox: [], bb: [Infinity, Infinity, -Infinity, -Infinity] };
}
function meterCoord(B, lon, lat) {
  if (B.cn + 2 > B.coords.length) { const n = new Float32Array(B.coords.length * 2); n.set(B.coords); B.coords = n; }
  B.coords[B.cn++] = lon - B.ox; B.coords[B.cn++] = lat - B.oy;
}
function meterParte(B, verts, caja) {
  B.partStart.push(B.cn >> 1);
  for (const c of verts) {
    let lon = c[0], lat = c[1]; if (B.conv) { const w = B.conv(lon, lat); lon = w[0]; lat = w[1]; }
    meterCoord(B, lon, lat);
    if (lon < caja[0]) caja[0] = lon; if (lat < caja[1]) caja[1] = lat; if (lon > caja[2]) caja[2] = lon; if (lat > caja[3]) caja[3] = lat;
  }
}
function meterGeom(B, g, caja) {
  let tipo = 0;
  switch (g && g.type) {
    case 'Point': tipo = 1; meterParte(B, [g.coordinates], caja); break;
    case 'MultiPoint': tipo = 1; meterParte(B, g.coordinates, caja); break;
    case 'LineString': tipo = 2; meterParte(B, g.coordinates, caja); break;
    case 'MultiLineString': tipo = 2; for (const l of g.coordinates) meterParte(B, l, caja); break;
    case 'Polygon': tipo = 3; for (const r of g.coordinates) meterParte(B, r, caja); break;
    case 'MultiPolygon': tipo = 3; for (const pol of g.coordinates) for (const r of pol) meterParte(B, r, caja); break;
    case 'GeometryCollection': for (const gg of g.geometries || []) { const t = meterGeom(B, gg, caja); if (!tipo) tipo = t; } break;
  }
  return tipo;
}
function meterElemento(B, el) {
  const g = el && el.geometry; if (!g || (!g.coordinates && g.type !== 'GeometryCollection')) return false;
  const mp = B.partStart.length, mc = B.cn;
  B.featPartStart.push(B.partStart.length);
  const caja = [Infinity, Infinity, -Infinity, -Infinity];
  const tipo = meterGeom(B, g, caja);
  if (!tipo || !isFinite(caja[0])) { B.featPartStart.pop(); B.partStart.length = mp; B.cn = mc; return false; }
  B.featType.push(tipo);
  B.featBBox.push(caja[0], caja[1], caja[2], caja[3]);
  B.bb[0] = Math.min(B.bb[0], caja[0]); B.bb[1] = Math.min(B.bb[1], caja[1]); B.bb[2] = Math.max(B.bb[2], caja[2]); B.bb[3] = Math.max(B.bb[3], caja[3]);
  return true;
}
function grilla(featBBox, n, bb) {
  const cols = Math.max(1, Math.min(256, Math.round(Math.sqrt(n || 1)))), filas = cols;
  const w = Math.max(1e-9, bb[2] - bb[0]), h = Math.max(1e-9, bb[3] - bb[1]);
  const cw = w / cols, ch = h / filas;
  const tmp = Array.from({ length: cols * filas }, () => []);
  for (let fi = 0; fi < n; fi++) {
    const b = fi * 4;
    const c0 = Math.max(0, Math.min(cols - 1, Math.floor((featBBox[b] - bb[0]) / cw))), c1 = Math.max(0, Math.min(cols - 1, Math.floor((featBBox[b + 2] - bb[0]) / cw)));
    const r0 = Math.max(0, Math.min(filas - 1, Math.floor((featBBox[b + 1] - bb[1]) / ch))), r1 = Math.max(0, Math.min(filas - 1, Math.floor((featBBox[b + 3] - bb[1]) / ch)));
    for (let ry = r0; ry <= r1; ry++) for (let cx = c0; cx <= c1; cx++) tmp[ry * cols + cx].push(fi);
  }
  return { cols, rows: filas, gx0: bb[0], gy0: bb[1], cellW: cw, cellH: ch, cells: tmp.map(a => a.length ? Int32Array.from(a) : null) };
}

// Importa un GeoJSON grande desde un flujo de bytes. Devuelve los datos de la capa
// (sin guardar la capa; los atributos sí quedan guardados en "bigprops").
export async function importarGrande(id, flujoBytes, alProgreso) {
  let B = null, proyFuente = 'geo', reconocida = true, n = 0, props = [], bloque = 0;
  const vaciarBloque = async () => { if (props.length) { await guardar('bigprops', props, id + ':' + bloque); bloque++; props = []; } };
  for await (const el of elementosPorPartes(flujoBytes)) {
    const g = el && el.geometry; if (!g) continue;
    const c = primeraCoord(g); if (!c) continue;
    if (!B) {
      let conv = null; const x = c[0], y = c[1];
      if (Math.abs(x) > 180 || Math.abs(y) > 90) {   // viene en metros: CRTM05 o Lambert
        let m = 'crtm05'; reconocida = false;
        for (const mm of ['crtm05', 'ln', 'ls']) { try { const w = haciaWgs(x, y, mm); if (dentroCR(w.lat, w.lon)) { m = mm; reconocida = true; break; } } catch (e) { /* sigue */ } }
        proyFuente = m; conv = (a, b) => { const w = haciaWgs(a, b, m); return [w.lon, w.lat]; };
      }
      const o = conv ? conv(x, y) : [x, y];
      B = nuevo(o[0], o[1]); B.conv = conv;
    }
    if (meterElemento(B, el)) {
      props.push(el.properties || {}); n++;
      if (props.length >= BLOQUE_PROPS) await vaciarBloque();
      if ((n & 8191) === 0 && alProgreso) alProgreso(n);
    }
  }
  await vaciarBloque();
  if (!B || !n) throw new Error('No se encontraron elementos en el GeoJSON.');
  const nParts = B.partStart.length;
  const partStart = new Int32Array(nParts + 1); partStart.set(B.partStart); partStart[nParts] = B.cn >> 1;
  const fps = new Int32Array(B.featPartStart.length + 1); fps.set(B.featPartStart); fps[B.featPartStart.length] = nParts;
  const featBBox = Float32Array.from(B.featBBox);
  const bb = [...B.bb];
  return { proyFuente, reconocida, grande: { nFeats: n, ox: B.ox, oy: B.oy, coords: B.coords.slice(0, B.cn), partStart, featPartStart: fps,
    featType: Uint8Array.from(B.featType), featBBox, bb, grid: grilla(featBBox, n, bb) } };
}

/* --- Dibujo --- */
function candidatos(G, fb, v) {
  const out = new Set();
  const c0 = Math.max(0, Math.floor((v.oLon - G.gx0) / G.cellW)), c1 = Math.min(G.cols - 1, Math.floor((v.eLon - G.gx0) / G.cellW));
  const r0 = Math.max(0, Math.floor((v.sLat - G.gy0) / G.cellH)), r1 = Math.min(G.rows - 1, Math.floor((v.nLat - G.gy0) / G.cellH));
  for (let ry = r0; ry <= r1; ry++) for (let cx = c0; cx <= c1; cx++) {
    const celda = G.cells[ry * G.cols + cx]; if (!celda) continue;
    for (let k = 0; k < celda.length; k++) {
      const fi = celda[k], b = fi * 4;
      if (fb[b + 2] < v.oLon || fb[b] > v.eLon || fb[b + 3] < v.sLat || fb[b + 1] > v.nLat) continue;
      out.add(fi);
    }
  }
  return out;
}
// dibujarSimbolo(x, y) lo pone el mapa (para usar el mismo símbolo que las demás capas).
export function dibujarGrande(ctx, gr, aPant, caja, est, dibujarSimbolo, rgba) {
  const co = gr.coords, ox = gr.ox, oy = gr.oy, ps = gr.partStart, fps = gr.featPartStart, ft = gr.featType;
  const trazar = (v0, v1, cerrar, camino) => {
    let primero = true, lx = 0, ly = 0;
    for (let v = v0; v < v1; v++) {
      const s = aPant(co[v * 2 + 1] + oy, co[v * 2] + ox);
      if (primero) { camino.moveTo(s.x, s.y); lx = s.x; ly = s.y; primero = false; }
      else if (v === v1 - 1 || Math.abs(s.x - lx) + Math.abs(s.y - ly) >= 0.8) { camino.lineTo(s.x, s.y); lx = s.x; ly = s.y; }
    }
    if (cerrar) camino.closePath();
  };
  ctx.lineWidth = est.grosor; ctx.strokeStyle = est.color;
  for (const fi of candidatos(gr.grid, gr.featBBox, caja)) {
    const tipo = ft[fi], pa = fps[fi], pb = fps[fi + 1];
    if (tipo === 1) {
      for (let pp = pa; pp < pb; pp++) for (let v = ps[pp]; v < ps[pp + 1]; v++) dibujarSimbolo(aPant(co[v * 2 + 1] + oy, co[v * 2] + ox), est);
    } else {
      const camino = new Path2D();
      for (let pp = pa; pp < pb; pp++) trazar(ps[pp], ps[pp + 1], tipo === 3, camino);
      if (tipo === 3 && est.opacidad > 0) { ctx.fillStyle = rgba(est.color, est.opacidad); ctx.fill(camino, 'evenodd'); }
      ctx.lineWidth = est.grosor; ctx.strokeStyle = est.color; ctx.stroke(camino);
    }
  }
}

/* --- Consulta al tocar --- */
function enPoligono(gr, fi, lon, lat) {
  const co = gr.coords, ox = gr.ox, oy = gr.oy, ps = gr.partStart, fps = gr.featPartStart;
  let dentro = false;
  for (let pp = fps[fi]; pp < fps[fi + 1]; pp++) {
    const v0 = ps[pp], v1 = ps[pp + 1];
    for (let a = v0, b = v1 - 1; a < v1; b = a++) {
      const xi = co[a * 2] + ox, yi = co[a * 2 + 1] + oy, xj = co[b * 2] + ox, yj = co[b * 2 + 1] + oy;
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dentro = !dentro;
    }
  }
  return dentro;
}
function distPx(gr, fi, px, py, aPant) {
  const co = gr.coords, ox = gr.ox, oy = gr.oy, ps = gr.partStart, fps = gr.featPartStart, esPt = gr.featType[fi] === 1;
  let m = Infinity;
  for (let pp = fps[fi]; pp < fps[fi + 1]; pp++) {
    let ant = null;
    for (let v = ps[pp]; v < ps[pp + 1]; v++) {
      const s = aPant(co[v * 2 + 1] + oy, co[v * 2] + ox);
      if (esPt) m = Math.min(m, Math.hypot(px - s.x, py - s.y));
      else {
        if (ant) {
          const dx = s.x - ant.x, dy = s.y - ant.y, l2 = dx * dx + dy * dy;
          const t = l2 ? Math.max(0, Math.min(1, ((px - ant.x) * dx + (py - ant.y) * dy) / l2)) : 0;
          m = Math.min(m, Math.hypot(px - (ant.x + t * dx), py - (ant.y + t * dy)));
        }
        ant = s;
      }
    }
  }
  return m;
}
// Devuelve el índice del elemento tocado o -1.
export function tocarGrande(gr, px, py, lat, lon, tol, aPant) {
  const b = gr.bb; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return -1;
  const G = gr.grid, cx = Math.floor((lon - G.gx0) / G.cellW), ry = Math.floor((lat - G.gy0) / G.cellH);
  let mejor = -1, dm = tol;
  for (let y = ry - 1; y <= ry + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (x < 0 || y < 0 || x >= G.cols || y >= G.rows) continue;
    const celda = G.cells[y * G.cols + x]; if (!celda) continue;
    for (const fi of celda) {
      if (gr.featType[fi] === 3 && enPoligono(gr, fi, lon, lat)) return fi;
      const d = distPx(gr, fi, px, py, aPant);
      if (d < dm) { dm = d; mejor = fi; }
    }
  }
  return mejor;
}
export async function atributosGrande(idCapa, fi) {
  try { const b = await leer('bigprops', idCapa + ':' + Math.floor(fi / BLOQUE_PROPS)); return (b && b[fi % BLOQUE_PROPS]) || {}; }
  catch (e) { return {}; }
}
export const TIPO_GEOM_GRANDE = { 1: 'Point', 2: 'LineString', 3: 'Polygon' };

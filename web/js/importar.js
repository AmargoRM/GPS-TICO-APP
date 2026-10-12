/* =======================================================================
   IMPORTAR ARCHIVOS → GeoJSON en WGS84 (lat/lon)
   Formatos: GeoJSON, KML, KMZ, GPX, CSV con X/Y, DXF (CAD), shapefile
   dentro de ZIP y .shp suelto.
   Todo se lee en el celular, sin internet y sin librerías.
   KML, ZIP y shapefile copiados del GPS TICO original; CSV es nuevo.

   Internamente todas las capas se guardan en latitud/longitud WGS84.
   Si el archivo viene en CRTM05 o Lambert, se convierte al cargarlo.
   ======================================================================= */
import { haciaWgs, dentroCR, PROY } from './geodesia.js';

export const TAMANO_AVISO = 50 * 1024 * 1024;   // 50 MB: avisar antes de cargar

// Punto de entrada: recibe un File y el sistema elegido ('auto' o uno fijo).
// Devuelve { fc, nombre, aviso, proyFuente } (proyFuente = sistema en que venía).
export async function leerArchivo(archivo, sistema = 'auto') {
  const nombre = archivo.name.replace(/\.[^.]+$/, '');
  const ext = extension(archivo.name);
  let r;
  if (ext === 'dwg') throw new Error('DWG es un formato cerrado de AutoCAD y no se puede leer. Guardalo como DXF (AutoCAD, QGIS o ODA File Converter) y cargá el .dxf.');
  if (ext === 'zip' || ext === 'kmz') r = await zipAGeoJSON(await archivo.arrayBuffer());
  else if (ext === 'shp') r = shpAGeoJSON(await archivo.arrayBuffer(), null, null);
  else {
    const texto = await archivo.text();
    const ini = texto.slice(0, 4000);
    if (ext === 'kml' || /<kml[\s>]/i.test(ini)) r = { fc: kmlAGeoJSON(texto), aviso: '', modo: 'geo' };
    else if (ext === 'gpx' || /<gpx[\s>]/i.test(ini)) r = { fc: gpxAGeoJSON(texto), aviso: '', modo: 'geo' };
    else if (ext === 'dxf' || /\bENTITIES\b|AutoCAD|LWPOLYLINE/.test(ini)) {
      const fc = dxfAGeoJSON(texto);
      r = { fc, ...ajustarProyeccion(fc, sistema, null) };
    } else if (ext === 'csv' || ext === 'txt') r = csvAGeoJSON(texto, sistema);
    else {
      let obj;
      try { obj = JSON.parse(texto); }
      catch (e) { throw new Error('No se reconoce el formato. Usá GeoJSON, KML, KMZ, GPX, CSV, DXF, SHP o ZIP.'); }
      const fc = normalizarGeoJSON(obj);
      r = { fc, ...ajustarProyeccion(fc, sistema, sistemaDeCRS(obj)) };
    }
  }
  if (!r.fc.features.length) throw new Error('El archivo no tiene elementos con coordenadas.');
  return { fc: r.fc, nombre, aviso: r.aviso, proyFuente: r.modo || 'geo' };
}
export const extension = n => ((n || '').match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';

/* --- GeoJSON --- */
// Acepta FeatureCollection, Feature o geometría suelta y devuelve FeatureCollection.
export function normalizarGeoJSON(obj) {
  if (!obj || typeof obj !== 'object' || !obj.type) throw new Error('El contenido no es GeoJSON (falta "type").');
  let feats;
  if (obj.type === 'FeatureCollection') feats = Array.isArray(obj.features) ? obj.features : [];
  else if (obj.type === 'Feature') feats = [obj];
  else if (obj.coordinates || obj.geometries) feats = [{ type: 'Feature', geometry: obj, properties: {} }];
  else throw new Error('Tipo de GeoJSON no reconocido: ' + obj.type);
  feats = feats.filter(f => f && f.geometry && (f.geometry.coordinates || f.geometry.geometries))
    .map(f => ({ type: 'Feature', geometry: f.geometry, properties: f.properties || {} }));
  return { type: 'FeatureCollection', features: feats };
}
// Algunos GeoJSON viejos traen "crs" con el sistema. Lo usamos si está.
function sistemaDeCRS(obj) {
  const n = JSON.stringify(obj.crs || '').toUpperCase();
  if (!n || n === '""') return null;
  if (n.includes('5367') || n.includes('CRTM')) return 'crtm05';
  if (n.includes('5456')) return 'ln';
  if (n.includes('5457')) return 'ls';
  if (n.includes('4326') || n.includes('CRS84')) return 'geo';
  return null;
}

// Primera coordenada que aparezca, para adivinar el sistema.
function primeraCoord(fc) {
  for (const f of fc.features) {
    let hit = null;
    const rec = a => { if (hit || !Array.isArray(a)) return; if (typeof a[0] === 'number') hit = a; else for (const x of a) { rec(x); if (hit) return; } };
    const g = f.geometry;
    if (g.type === 'GeometryCollection') (g.geometries || []).forEach(gg => rec(gg.coordinates)); else rec(g.coordinates);
    if (hit) return hit;
  }
  return null;
}
// Adivina el sistema de unas coordenadas X/Y: si parecen lat/lon → 'geo';
// si no, prueba CRTM05, Lambert Norte y Lambert Sur y elige la que cae en Costa Rica.
export function adivinarSistema(x, y) {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return { modo: 'geo', seguro: true };
  for (const m of ['crtm05', 'ln', 'ls']) {
    try { const w = haciaWgs(x, y, m); if (dentroCR(w.lat, w.lon)) return { modo: m, seguro: true }; } catch (e) { /* sigue */ }
  }
  return { modo: 'crtm05', seguro: false };
}
// Convierte EN EL MISMO OBJETO todas las coordenadas desde 'modo' a lat/lon.
export function reproyectar(fc, modo) {
  if (modo === 'geo') return;
  const rec = c => {
    if (typeof c[0] === 'number') { const w = haciaWgs(c[0], c[1], modo); c[0] = w.lon; c[1] = w.lat; c.length = 2; }
    else for (const x of c) rec(x);
  };
  for (const f of fc.features) {
    const g = f.geometry;
    if (g.type === 'GeometryCollection') (g.geometries || []).forEach(gg => gg.coordinates && rec(gg.coordinates));
    else if (g.coordinates) rec(g.coordinates);
  }
}
// Decide el sistema (elegido, del archivo o adivinado), convierte y devuelve
// { aviso, modo } (modo = sistema en que venían las coordenadas).
export function ajustarProyeccion(fc, sistema, delArchivo) {
  let modo = sistema !== 'auto' ? sistema : delArchivo;
  let aviso = '';
  if (!modo) {
    const c = primeraCoord(fc);
    if (!c) return { aviso: '', modo: 'geo' };
    const r = adivinarSistema(c[0], c[1]);
    modo = r.modo;
    if (modo !== 'geo') aviso = r.seguro
      ? `Detecté coordenadas en ${PROY[modo].nom}; las convertí.`
      : 'No reconocí el sistema de coordenadas; asumí CRTM05. Si la capa aparece fuera de lugar, borrala y cargala eligiendo el sistema a mano.';
  }
  reproyectar(fc, modo);
  return { aviso, modo };
}

/* --- KML (copiado del original) --- */
function _localName(el, local) {
  let r = [...el.getElementsByTagNameNS('*', local)];
  if (!r.length) r = [...el.getElementsByTagName(local)];
  return r;
}
function _txtHijo(el, local) { const n = _localName(el, local)[0]; return n ? n.textContent.trim() : ''; }
function _kmlCoords(txt) {
  return (txt || '').trim().split(/\s+/).filter(Boolean).map(tp => {
    const a = tp.split(',').map(Number);
    return [a[0], a[1]];   // lon, lat (se ignora la altura)
  }).filter(c => isFinite(c[0]) && isFinite(c[1]));
}
export function kmlAGeoJSON(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El KML está dañado o mal formado.');
  const feats = [];
  for (const pm of _localName(doc.documentElement, 'Placemark')) {
    const geoms = [];
    for (const g of _localName(pm, 'Point')) { const c = _kmlCoords(_txtHijo(g, 'coordinates'))[0]; if (c) geoms.push({ type: 'Point', coordinates: c }); }
    for (const g of _localName(pm, 'LineString')) { const l = _kmlCoords(_txtHijo(g, 'coordinates')); if (l.length > 1) geoms.push({ type: 'LineString', coordinates: l }); }
    for (const g of _localName(pm, 'Polygon')) {
      const anillos = [];
      const ext = _localName(g, 'outerBoundaryIs')[0];
      if (ext) { const r = _kmlCoords(_txtHijo(ext, 'coordinates')); if (r.length > 2) anillos.push(r); }
      for (const int of _localName(g, 'innerBoundaryIs')) { const r = _kmlCoords(_txtHijo(int, 'coordinates')); if (r.length > 2) anillos.push(r); }
      if (anillos.length) geoms.push({ type: 'Polygon', coordinates: anillos });
    }
    for (const g of _localName(pm, 'Track')) {   // gx:Track
      const cs = _localName(g, 'coord').map(c => { const a = c.textContent.trim().split(/\s+/).map(Number); return [a[0], a[1]]; }).filter(c => isFinite(c[0]));
      if (cs.length > 1) geoms.push({ type: 'LineString', coordinates: cs });
    }
    if (!geoms.length) continue;
    const props = { nombre: _txtHijo(pm, 'name') || '', descripcion: _txtHijo(pm, 'description') || '' };
    for (const d of _localName(pm, 'Data')) { const k = d.getAttribute('name'); if (k) props[k] = _txtHijo(d, 'value'); }
    for (const sd of _localName(pm, 'SimpleData')) { const k = sd.getAttribute('name'); if (k) props[k] = sd.textContent.trim(); }
    const geometry = geoms.length === 1 ? geoms[0] : { type: 'GeometryCollection', geometries: geoms };
    feats.push({ type: 'Feature', geometry, properties: props });
  }
  if (!feats.length) throw new Error('El KML no tiene elementos con coordenadas.');
  return { type: 'FeatureCollection', features: feats };
}

/* --- GPX: waypoints como puntos, tracks y rutas como líneas --- */
export function gpxAGeoJSON(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El GPX está dañado o mal formado.');
  const num = (el, a) => parseFloat(el.getAttribute(a));
  const txt = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ''; };
  const feats = [];
  for (const w of doc.getElementsByTagName('wpt')) {
    const lat = num(w, 'lat'), lon = num(w, 'lon');
    if (!isFinite(lat) || !isFinite(lon)) continue;
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { nombre: txt(w, 'name'), descripcion: txt(w, 'desc'), elevacion: txt(w, 'ele') } });
  }
  const linea = (nodo, etiqueta, nombre) => {
    const pts = [...nodo.getElementsByTagName(etiqueta)].map(p => [num(p, 'lon'), num(p, 'lat')]).filter(c => isFinite(c[0]) && isFinite(c[1]));
    if (pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: { nombre } });
  };
  for (const t of doc.getElementsByTagName('trk')) for (const seg of t.getElementsByTagName('trkseg')) linea(seg, 'trkpt', txt(t, 'name'));
  for (const r of doc.getElementsByTagName('rte')) linea(r, 'rtept', txt(r, 'name'));
  if (!feats.length) throw new Error('El GPX no tiene puntos, tracks ni rutas.');
  return { type: 'FeatureCollection', features: feats };
}

/* --- CSV con columnas X/Y (o latitud/longitud) --- */
// Separa una línea CSV respetando comillas.
function partirLinea(linea, sep) {
  const out = []; let cur = '', comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (comillas) {
      if (ch === '"' && linea[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') comillas = false;
      else cur += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
const sinTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const NOMBRES_X = ['x', 'este', 'e', 'easting', 'coord_x', 'coordx', 'x_crtm05', 'este_m'];
const NOMBRES_Y = ['y', 'norte', 'n', 'northing', 'coord_y', 'coordy', 'y_crtm05', 'norte_m'];
const NOMBRES_LON = ['lon', 'long', 'lng', 'longitud', 'longitude'];
const NOMBRES_LAT = ['lat', 'latitud', 'latitude'];

export function csvAGeoJSON(texto, sistema = 'auto') {
  const lineas = texto.replace(/^﻿/, '').split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
  if (lineas.length < 2) throw new Error('El CSV está vacío o solo tiene encabezado.');
  // Separador: el que más aparece en el encabezado (coma, punto y coma o tabulador).
  const cab = lineas[0];
  const sep = [';', '\t', ','].map(s => [s, cab.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const enc = partirLinea(cab, sep);
  const encN = enc.map(sinTildes);
  const buscar = lista => encN.findIndex(h => lista.includes(h));

  let ix = buscar(NOMBRES_X), iy = buscar(NOMBRES_Y), sistemaCols = null;
  if (ix < 0 || iy < 0) {
    ix = buscar(NOMBRES_LON); iy = buscar(NOMBRES_LAT); sistemaCols = 'geo';
  }
  if (ix < 0 || iy < 0) {
    throw new Error('No encontré las columnas de coordenadas. El encabezado debe tener X y Y (o Este y Norte, o Latitud y Longitud). Encontré: ' + enc.join(', '));
  }
  const num = s => { const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : NaN; };
  const feats = []; let malas = 0;
  for (let i = 1; i < lineas.length; i++) {
    const c = partirLinea(lineas[i], sep);
    const x = num(c[ix]), y = num(c[iy]);
    if (!isFinite(x) || !isFinite(y)) { malas++; continue; }
    const props = {};
    enc.forEach((h, k) => { if (k !== ix && k !== iy) props[h || ('col' + k)] = c[k] ?? ''; });
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: props });
  }
  if (!feats.length) throw new Error('Ninguna fila del CSV tiene números válidos en las columnas de coordenadas.');
  const fc = { type: 'FeatureCollection', features: feats };
  const r = ajustarProyeccion(fc, sistema, sistemaCols);
  let aviso = r.aviso;
  if (malas) aviso = (aviso ? aviso + ' ' : '') + `${malas} fila(s) sin coordenadas válidas se saltaron.`;
  return { fc, aviso, modo: r.modo };
}

/* --- ZIP (copiado del original; usa el descompresor del navegador) --- */
function _bufDe(u8) { return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); }
async function _inflar(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede abrir ZIP. Actualizá el navegador o descomprimí el archivo antes.');
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function leerZip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 22 - 65536; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('El archivo no es un ZIP válido.');
  const cdOff = dv.getUint32(eocd + 16, true), cdCount = dv.getUint16(eocd + 10, true);
  const out = new Map();
  let p = cdOff;
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const tamComp = dv.getUint32(p + 20, true);
    const largoNom = dv.getUint16(p + 28, true), largoExtra = dv.getUint16(p + 30, true), largoCom = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + largoNom));
    const ini = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const comp = u8.subarray(ini, ini + tamComp);
    if (metodo === 0) out.set(nombre, comp.slice());
    else if (metodo === 8) out.set(nombre, await _inflar(comp));
    p += 46 + largoNom + largoExtra + largoCom;
  }
  return out;
}

/* --- Shapefile (copiado del original) --- */
// Lee el .prj para saber el sistema de coordenadas.
function modoDePrj(prj) {
  if (!prj) return null;
  const s = prj.toUpperCase();
  if (s.includes('PROJCS')) {
    if (s.includes('LAMBERT')) {
      const m = s.match(/LATITUDE_OF_ORIGIN[",\s]+(-?\d+(?:\.\d+)?)/);
      const lat0 = m ? parseFloat(m[1]) : 0;
      return lat0 > 10 ? 'ln' : 'ls';   // Lambert Norte (~10,47°) o Sur (9°)
    }
    return 'crtm05';   // TM / CRTM u otro proyectado: CRTM05 es lo más común en CR
  }
  return 'geo';
}
function _areaAnillo(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; }
function shpAGeoJSON(shpBuf, filasDbf, prj) {
  const dv = new DataView(shpBuf), largo = shpBuf.byteLength;
  const xmin = dv.getFloat64(36, true), ymin = dv.getFloat64(44, true);
  let modo = modoDePrj(prj), aviso = '';
  if (!modo) {
    const r = adivinarSistema(xmin, ymin);
    modo = r.modo;
    aviso = 'El ZIP no trae archivo .prj; ' + (r.seguro ? `detecté ${PROY[modo].nom}.` : 'asumí CRTM05.');
  } else if (modo !== 'geo') aviso = `Sistema del shapefile: ${PROY[modo].nom}; convertido.`;
  const conv = modo === 'geo' ? (x, y) => [x, y] : (x, y) => { const w = haciaWgs(x, y, modo); return [w.lon, w.lat]; };
  const feats = [];
  let off = 100, idx = 0;
  const BASE = { 11: 1, 21: 1, 3: 3, 13: 3, 23: 3, 5: 5, 15: 5, 25: 5, 8: 8, 18: 8, 28: 8 };
  while (off + 8 <= largo) {
    const largoCont = dv.getInt32(off + 4, false);
    const rec = off + 8;
    const tipo = dv.getInt32(rec, true);
    const base = BASE[tipo] || tipo;
    let geom = null;
    if (base === 1) geom = { type: 'Point', coordinates: conv(dv.getFloat64(rec + 4, true), dv.getFloat64(rec + 12, true)) };
    else if (base === 8) {
      const nPts = dv.getInt32(rec + 36, true); let pp = rec + 40; const pts = [];
      for (let i = 0; i < nPts; i++) { pts.push(conv(dv.getFloat64(pp, true), dv.getFloat64(pp + 8, true))); pp += 16; }
      geom = { type: 'MultiPoint', coordinates: pts };
    } else if (base === 3 || base === 5) {
      const nPartes = dv.getInt32(rec + 36, true), nPts = dv.getInt32(rec + 40, true);
      let pp = rec + 44; const partes = [];
      for (let i = 0; i < nPartes; i++) { partes.push(dv.getInt32(pp, true)); pp += 4; }
      const todos = []; for (let i = 0; i < nPts; i++) { todos.push(conv(dv.getFloat64(pp, true), dv.getFloat64(pp + 8, true))); pp += 16; }
      const anillos = []; for (let i = 0; i < nPartes; i++) anillos.push(todos.slice(partes[i], i + 1 < nPartes ? partes[i + 1] : nPts));
      if (base === 3) geom = anillos.length === 1 ? { type: 'LineString', coordinates: anillos[0] } : { type: 'MultiLineString', coordinates: anillos };
      else {
        // Anillos en sentido horario = exteriores; antihorario = huecos.
        const pols = [];
        for (const r of anillos) { if (_areaAnillo(r) < 0 || !pols.length) pols.push([r]); else pols[pols.length - 1].push(r); }
        geom = pols.length === 1 ? { type: 'Polygon', coordinates: pols[0] } : { type: 'MultiPolygon', coordinates: pols };
      }
    }
    off = rec + largoCont * 2;
    if (geom && tipo !== 0) feats.push({ type: 'Feature', geometry: geom, properties: (filasDbf && filasDbf[idx]) || {} });
    idx++;
  }
  return { fc: { type: 'FeatureCollection', features: feats }, aviso, modo };
}
// Tabla de atributos (.dbf).
function dbfLeer(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const nReg = dv.getUint32(4, true), tamCab = dv.getUint16(8, true), tamReg = dv.getUint16(10, true);
  const campos = []; let p = 32;
  while (p < tamCab && u8[p] !== 0x0D) {
    let nom = ''; for (let i = 0; i < 11 && u8[p + i] !== 0; i++) nom += String.fromCharCode(u8[p + i]);
    campos.push({ nom, tipo: String.fromCharCode(u8[p + 11]), largo: u8[p + 16] });
    p += 32;
  }
  const dec = new TextDecoder('latin1');
  const filas = []; let rp = tamCab;
  for (let r = 0; r < nReg; r++) {
    let cp = rp + 1; const fila = {};
    for (const c of campos) {
      const crudo = dec.decode(u8.subarray(cp, cp + c.largo)).replace(/\u0000/g, '').trim(); cp += c.largo;
      if (c.tipo === 'N' || c.tipo === 'F') fila[c.nom] = crudo === '' ? null : Number(crudo);
      else if (c.tipo === 'L') fila[c.nom] = /^[YyTt]$/.test(crudo);
      else fila[c.nom] = crudo;
    }
    rp += tamReg;
    filas.push(fila);
  }
  return filas;
}
// ZIP con shapefile, o KMZ (ZIP con KML), o ZIP con GeoJSON.
async function zipAGeoJSON(buf) {
  const zip = await leerZip(buf);
  const claves = [...zip.keys()].filter(k => !k.startsWith('__MACOSX'));
  const shp = claves.find(k => /\.shp$/i.test(k));
  if (!shp) {
    const kml = claves.find(k => /\.kml$/i.test(k));
    if (kml) return { fc: kmlAGeoJSON(new TextDecoder().decode(zip.get(kml))), aviso: '', modo: 'geo' };
    const gj = claves.find(k => /\.(geo)?json$/i.test(k));
    if (gj) {
      const fc = normalizarGeoJSON(JSON.parse(new TextDecoder().decode(zip.get(gj))));
      return { fc, ...ajustarProyeccion(fc, 'auto', null) };
    }
    throw new Error('El ZIP no trae un shapefile (.shp), ni KML, ni GeoJSON.');
  }
  const base = shp.replace(/\.[^.]+$/, '');
  const buscar = ext => zip.get(base + '.' + ext) || zip.get(base + '.' + ext.toUpperCase());
  const dbf = buscar('dbf'), prj = buscar('prj');
  return shpAGeoJSON(_bufDe(zip.get(shp)), dbf ? dbfLeer(_bufDe(dbf)) : null, prj ? new TextDecoder().decode(prj) : null);
}

/* --- DXF de CAD (copiado del original) --- */
// Entidades: LINE, LWPOLYLINE, POLYLINE/VERTEX, POINT, CIRCLE, ARC, TEXT/MTEXT.
// Coordenadas en metros (después se convierten con la detección de CRTM05/Lambert).
export function dxfAGeoJSON(texto) {
  const crudo = texto.split(/\r\n|\r|\n/);
  const P = []; for (let i = 0; i + 1 < crudo.length; i += 2) { const c = parseInt((crudo[i] || '').trim(), 10); if (!isNaN(c)) P.push([c, crudo[i + 1]]); }
  let i = 0; for (; i < P.length; i++) { if (P[i][0] === 2 && (P[i][1] || '').trim() === 'ENTITIES') { i++; break; } }
  if (i >= P.length) i = 0;   // algunos DXF mínimos no marcan la sección
  const feats = [];
  const meter = (geom, capa, extra) => { if (geom) feats.push({ type: 'Feature', geometry: geom, properties: Object.assign({ capa_cad: (capa || '0') }, extra || {}) }); };
  const circulo = (cx, cy, r) => { const a = []; for (let k = 0; k <= 48; k++) { const t = k / 48 * 2 * Math.PI; a.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return a; };
  const arco = (cx, cy, r, a0, a1) => { const s = a0 * Math.PI / 180; let e = a1 * Math.PI / 180; if (e <= s) e += 2 * Math.PI; const pasos = Math.max(2, Math.ceil((e - s) / (Math.PI / 24))); const a = []; for (let k = 0; k <= pasos; k++) { const t = s + (e - s) * k / pasos; a.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return a; };
  while (i < P.length) {
    if (P[i][0] !== 0) { i++; continue; }
    const et = (P[i][1] || '').trim(); i++;
    if (et === 'ENDSEC' || et === 'EOF') break;
    const E = { capa: '0', verts: [] }; let bandera = 0;
    while (i < P.length && P[i][0] !== 0) {
      const c = P[i][0], v = P[i][1], nv = parseFloat((v || '').trim());
      if (c === 8) E.capa = (v || '').trim();
      else if (c === 10) { if (et === 'LWPOLYLINE') E.verts.push([nv, 0]); else E.x = nv; }
      else if (c === 20) { if (et === 'LWPOLYLINE') { const a = E.verts[E.verts.length - 1]; if (a) a[1] = nv; } else E.y = nv; }
      else if (c === 11) E.x1 = nv; else if (c === 21) E.y1 = nv;
      else if (c === 40) E.r = nv; else if (c === 50) E.a0 = nv; else if (c === 51) E.a1 = nv;
      else if (c === 70) bandera = nv | 0; else if (c === 1) E.texto = v;
      i++;
    }
    if (et === 'LINE') { if (E.x != null && E.x1 != null) meter({ type: 'LineString', coordinates: [[E.x, E.y], [E.x1, E.y1]] }, E.capa); }
    else if (et === 'POINT') { if (E.x != null) meter({ type: 'Point', coordinates: [E.x, E.y] }, E.capa); }
    else if (et === 'TEXT' || et === 'MTEXT') { if (E.x != null) meter({ type: 'Point', coordinates: [E.x, E.y] }, E.capa, { texto: (E.texto || '').trim() }); }
    else if (et === 'CIRCLE') { if (E.x != null && E.r != null) meter({ type: 'Polygon', coordinates: [circulo(E.x, E.y, E.r)] }, E.capa); }
    else if (et === 'ARC') { if (E.x != null && E.r != null) meter({ type: 'LineString', coordinates: arco(E.x, E.y, E.r, E.a0 || 0, E.a1 || 0) }, E.capa); }
    else if (et === 'LWPOLYLINE') {
      const vs = E.verts.filter(a => isFinite(a[0]) && isFinite(a[1]));
      if (vs.length >= 2) { if ((bandera & 1) && vs.length >= 3) meter({ type: 'Polygon', coordinates: [[...vs, vs[0]]] }, E.capa); else meter({ type: 'LineString', coordinates: vs }, E.capa); }
    } else if (et === 'POLYLINE') {
      const cerrada = (bandera & 1) === 1, capa = E.capa, vs = [];
      while (i < P.length) {
        if (P[i][0] === 0) {
          const t = (P[i][1] || '').trim();
          if (t === 'VERTEX') { i++; let vx = null, vy = null; while (i < P.length && P[i][0] !== 0) { const c = P[i][0]; const nv = parseFloat((P[i][1] || '').trim()); if (c === 10) vx = nv; else if (c === 20) vy = nv; i++; } if (vx != null && vy != null) vs.push([vx, vy]); }
          else if (t === 'SEQEND') { i++; while (i < P.length && P[i][0] !== 0) i++; break; }
          else break;
        } else i++;
      }
      if (vs.length >= 2) { if (cerrada && vs.length >= 3) meter({ type: 'Polygon', coordinates: [[...vs, vs[0]]] }, capa); else meter({ type: 'LineString', coordinates: vs }, capa); }
    }
  }
  if (!feats.length) throw new Error('El DXF no trae entidades reconocibles (LINE, POLYLINE, POINT, CIRCLE, ARC, TEXT).');
  return { type: 'FeatureCollection', features: feats };
}

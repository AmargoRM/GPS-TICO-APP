/* =======================================================================
   COPIA DE SEGURIDAD: descargar y restaurar
   Archivo JSON con capas, puntos (con fotos) y ajustes (incluye plantillas):
     { app: "gps-tico-web", version: 2, fecha, capas: [...], puntos: [...], ajustes: {...} }
   No incluye: capas GRANDES (más de 8 MB) ni el mapa de fondo guardado;
   la app lo avisa al descargar.
   Se pueden restaurar copias de la versión 1.

   Restaurar es en dos pasos:
   1. REVISAR el archivo completo sin tocar nada. Si algo no cuadra, se
      rechaza y los datos actuales quedan intactos.
   2. REEMPLAZAR todo en una sola operación "todo o nada".
   ======================================================================= */
import { AJUSTES_DEFECTO } from './estado.js';

export const APP = 'gps-tico-web';
export const VERSION_COPIA = 2;
const PROYECCIONES = ['crtm05', 'ln', 'ls', 'geo'];
const FONDOS = ['sat', 'calles', 'ninguno'];
const TIPOS_GEOM = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];

/* --- Fotos: Blob <-> texto (data URL) para que entren en un JSON --- */
function blobATexto(blob) {
  return new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(r.error); r.readAsDataURL(blob); });
}
function textoABlob(dataUrl) {
  const [cab, datos] = dataUrl.split(',');
  const tipo = (cab.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(datos);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: tipo });
}

/* --- Crear la copia --- */
// Devuelve { copia, omitidas } (omitidas = capas grandes que no se incluyen).
export async function crearCopia(capas, puntos, ajustes) {
  const pts = [];
  for (const p of puntos) {
    const fotos = [];
    for (const f of p.fotos || []) fotos.push(await blobATexto(f));
    pts.push({ ...p, fotos });
  }
  const aj = {};
  for (const k of Object.keys(AJUSTES_DEFECTO)) if (ajustes[k] !== undefined) aj[k] = ajustes[k];
  const incluidas = capas.filter(c => c.tipo !== 'grande');
  return { copia: { app: APP, version: VERSION_COPIA, fecha: new Date().toISOString(), capas: incluidas, puntos: pts, ajustes: aj },
    omitidas: capas.filter(c => c.tipo === 'grande').map(c => c.nombre) };
}

/* --- Revisar la copia (no toca nada) --- */
const esTexto = v => typeof v === 'string';
const esNum = v => typeof v === 'number' && isFinite(v);
const esFecha = v => esTexto(v) && !isNaN(Date.parse(v));
const esFoto = v => esTexto(v) && /^data:image\/[\w.+-]+;base64,/.test(v);
const esURL = v => esTexto(v) && /^https?:\/\//i.test(v);

function coordsValidas(c, prof = 0) {
  if (!Array.isArray(c) || prof > 6) return false;
  if (typeof c[0] === 'number') return c.length >= 2 && esNum(c[0]) && esNum(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
  return c.every(x => coordsValidas(x, prof + 1));
}
function geomValida(g) {
  if (!g || !TIPOS_GEOM.includes(g.type)) return false;
  if (g.type === 'GeometryCollection') return Array.isArray(g.geometries) && g.geometries.every(geomValida);
  return coordsValidas(g.coordinates);
}
function fcValida(g) {
  if (!g || g.type !== 'FeatureCollection' || !Array.isArray(g.features)) return 'el contenido de la capa está dañado';
  const mala = g.features.findIndex(f => !f || f.type !== 'Feature' || !geomValida(f.geometry));
  return mala >= 0 ? `el elemento ${mala + 1} tiene coordenadas dañadas` : null;
}

// Pasa una copia de la versión 1 al formato actual (sin tocar el original).
function deVersion1(obj) {
  const o = JSON.parse(JSON.stringify(obj));
  o.capas = (o.capas || []).map(c => {
    if (c && c.origen === 'archivo') return { ...c, tipo: 'vector' };
    if (c && c.origen === 'url' && (c.tipo === 'geojson' || c.tipo === 'wfs')) {
      const { url, capaServicio, ...resto } = c;
      return { ...resto, tipo: 'vector', fuente: { tipo: c.tipo, url, capaServicio: capaServicio || null }, geojson: null };
    }
    return c;
  });
  o.puntos = (o.puntos || []).map(p => { if (!p || typeof p !== 'object') return p; const { foto, ...resto } = p; return { ...resto, fotos: foto ? [foto] : [] }; });
  o.version = VERSION_COPIA;
  return o;
}

// Devuelve { ok, errores: [...], resumen, normalizada }. Nunca modifica nada.
export function validarCopia(obj) {
  const errores = [];
  const err = m => { if (errores.length < 50) errores.push(m); };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errores: ['El archivo no contiene una copia (no es un objeto JSON).'] };
  if (obj.app !== APP) err(`El archivo no es una copia de GPS TICO Web (dice app: "${String(obj.app ?? '(nada)').slice(0, 40)}").`);
  if (obj.version !== 1 && obj.version !== VERSION_COPIA) err(`Versión de copia no soportada: ${String(obj.version ?? '(nada)').slice(0, 20)} (esta app lee las versiones 1 y ${VERSION_COPIA}).`);
  if (!esFecha(obj.fecha)) err('Falta la fecha de la copia o no es válida.');
  if (!Array.isArray(obj.capas)) err('Falta la lista de capas.');
  if (!Array.isArray(obj.puntos)) err('Falta la lista de puntos.');
  if (!obj.ajustes || typeof obj.ajustes !== 'object' || Array.isArray(obj.ajustes)) err('Faltan los ajustes.');
  if (errores.length) return { ok: false, errores };
  const o = obj.version === 1 ? deVersion1(obj) : obj;

  // Capas
  const ids = new Set();
  o.capas.forEach((c, i) => {
    const q = `Capa ${i + 1}${c && esTexto(c.nombre) ? ` ("${c.nombre.slice(0, 30)}")` : ''}`;
    if (!c || typeof c !== 'object') { err(`${q}: no es válida.`); return; }
    if (!esTexto(c.id) || !c.id) err(`${q}: falta el identificador.`);
    else if (ids.has(c.id)) err(`${q}: identificador repetido.`); else ids.add(c.id);
    if (!esTexto(c.nombre)) err(`${q}: falta el nombre.`);
    if (c.tipo === 'vector') {
      if (c.fuente != null && !(esURL(c.fuente.url) && ['geojson', 'wfs'].includes(c.fuente.tipo))) err(`${q}: la dirección de origen no es válida.`);
      if (c.geojson != null) { const m = fcValida(c.geojson); if (m) err(`${q}: ${m}.`); }
      else if (!c.fuente) err(`${q}: no tiene contenido.`);
    } else if (c.tipo === 'wms') {
      if (!esURL(c.url)) err(`${q}: la dirección no es válida.`);
      if (!esTexto(c.capaServicio) || !c.capaServicio) err(`${q}: falta el nombre de la capa del servicio.`);
    } else err(`${q}: tipo de capa desconocido.`);
    if (c.color != null && !esTexto(c.color)) err(`${q}: color inválido.`);
  });

  // Puntos
  const idsP = new Set();
  o.puntos.forEach((p, i) => {
    const q = `Punto ${i + 1}${p && esTexto(p.nombre) ? ` ("${p.nombre.slice(0, 30)}")` : ''}`;
    if (!p || typeof p !== 'object') { err(`${q}: no es válido.`); return; }
    if (!esTexto(p.id) || !p.id) err(`${q}: falta el identificador.`);
    else if (idsP.has(p.id)) err(`${q}: identificador repetido.`); else idsP.add(p.id);
    if (!esTexto(p.nombre)) err(`${q}: falta el nombre.`);
    if (p.nota != null && !esTexto(p.nota)) err(`${q}: la nota no es texto.`);
    if (!esFecha(p.fecha)) err(`${q}: fecha inválida.`);
    if (!esNum(p.lat) || Math.abs(p.lat) > 90) err(`${q}: latitud inválida.`);
    if (!esNum(p.lon) || Math.abs(p.lon) > 180) err(`${q}: longitud inválida.`);
    if (!esNum(p.x) || !esNum(p.y)) err(`${q}: X/Y CRTM05 inválidos.`);
    if (p.precision != null && (!esNum(p.precision) || p.precision < 0)) err(`${q}: precisión inválida.`);
    if (!Array.isArray(p.fotos) || !p.fotos.every(esFoto)) err(`${q}: alguna foto está dañada.`);
    if (p.datos != null && (typeof p.datos !== 'object' || Array.isArray(p.datos))) err(`${q}: datos de formulario inválidos.`);
  });

  // Ajustes
  const a = o.ajustes;
  for (const k of Object.keys(a)) if (!(k in AJUSTES_DEFECTO)) err(`Ajuste desconocido: "${k.slice(0, 30)}".`);
  if (a.proyeccion != null && !PROYECCIONES.includes(a.proyeccion)) err('Ajuste "proyección" inválido.');
  if (a.fondo != null && !FONDOS.includes(a.fondo)) err('Ajuste "fondo" inválido.');
  if (a.capasVisibles != null && !(Array.isArray(a.capasVisibles) && a.capasVisibles.every(esTexto))) err('Ajuste "capas visibles" inválido.');
  if (a.ultimaCopia != null && !esFecha(a.ultimaCopia)) err('Ajuste "última copia" inválido.');
  if (a.vista != null && !(esNum(a.vista.lat) && esNum(a.vista.lon) && esNum(a.vista.zoom))) err('Ajuste "vista del mapa" inválido.');
  if (a.plantillas != null && !(Array.isArray(a.plantillas) && a.plantillas.every(t => t && esTexto(t.id) && esTexto(t.nombre) && Array.isArray(t.campos)))) err('Ajuste "plantillas" inválido.');
  if (a.radioConsulta != null && !(esNum(a.radioConsulta) && a.radioConsulta > 0)) err('Ajuste "radio de consulta" inválido.');

  return { ok: errores.length === 0, errores, normalizada: o,
    resumen: { fecha: o.fecha, capas: o.capas.length, puntos: o.puntos.length, fotos: o.puntos.reduce((s, p) => s + ((p && p.fotos) || []).length, 0) } };
}

// Prepara los datos ya revisados para guardarlos (fotos de texto a imagen).
export function prepararRestauracion(o) {
  const ajustes = { ...o.ajustes };
  // La copia que se está restaurando cuenta como "copia descargada" en su fecha.
  if (!ajustes.ultimaCopia || Date.parse(o.fecha) > Date.parse(ajustes.ultimaCopia)) ajustes.ultimaCopia = o.fecha;
  return {
    capas: o.capas,
    puntos: o.puntos.map(p => ({ ...p, nota: p.nota ?? '', fotos: (p.fotos || []).map(textoABlob) })),
    ajustes
  };
}

/* =======================================================================
   COPIA DE SEGURIDAD: descargar y restaurar
   Archivo JSON con TODO: capas, puntos (con fotos) y ajustes.
     { app: "gps-tico-web", version: 1, fecha, capas: [...], puntos: [...], ajustes: {...} }

   Restaurar es en dos pasos:
   1. REVISAR el archivo completo sin tocar nada. Si algo no cuadra, se
      rechaza y los datos actuales quedan intactos.
   2. REEMPLAZAR todo en una sola operación "todo o nada".
   ======================================================================= */
import { AJUSTES_DEFECTO } from './estado.js';

export const APP = 'gps-tico-web';
export const VERSION_COPIA = 1;
const PROYECCIONES = ['crtm05', 'ln', 'ls', 'geo'];
const FONDOS = ['sat', 'calles', 'ninguno'];
const TIPOS_URL = ['geojson', 'wfs', 'wms'];
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
export async function crearCopia(capas, puntos, ajustes) {
  const pts = [];
  for (const p of puntos) pts.push({ ...p, foto: p.foto ? await blobATexto(p.foto) : null });
  const aj = {};
  for (const k of Object.keys(AJUSTES_DEFECTO)) if (ajustes[k] !== undefined) aj[k] = ajustes[k];
  return { app: APP, version: VERSION_COPIA, fecha: new Date().toISOString(), capas, puntos: pts, ajustes: aj };
}

/* --- Revisar la copia (no toca nada) --- */
const esTexto = v => typeof v === 'string';
const esNum = v => typeof v === 'number' && isFinite(v);
const esFecha = v => esTexto(v) && !isNaN(Date.parse(v));

// Revisa que todas las coordenadas sean números válidos de lat/lon.
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

// Devuelve { ok, errores: [...], resumen }. Nunca modifica nada.
export function validarCopia(obj) {
  const errores = [];
  const err = m => { if (errores.length < 50) errores.push(m); };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errores: ['El archivo no contiene una copia (no es un objeto JSON).'] };
  if (obj.app !== APP) err(`El archivo no es una copia de GPS TICO Web (dice app: "${String(obj.app ?? '(nada)').slice(0, 40)}").`);
  if (obj.version !== VERSION_COPIA) err(`Versión de copia no soportada: ${String(obj.version ?? '(nada)').slice(0, 20)} (esta app lee la versión ${VERSION_COPIA}).`);
  if (!esFecha(obj.fecha)) err('Falta la fecha de la copia o no es válida.');
  if (!Array.isArray(obj.capas)) err('Falta la lista de capas.');
  if (!Array.isArray(obj.puntos)) err('Falta la lista de puntos.');
  if (!obj.ajustes || typeof obj.ajustes !== 'object' || Array.isArray(obj.ajustes)) err('Faltan los ajustes.');
  if (errores.length) return { ok: false, errores };

  // Capas
  const ids = new Set();
  obj.capas.forEach((c, i) => {
    const q = `Capa ${i + 1}${c && esTexto(c.nombre) ? ` ("${c.nombre.slice(0, 30)}")` : ''}`;
    if (!c || typeof c !== 'object') { err(`${q}: no es válida.`); return; }
    if (!esTexto(c.id) || !c.id) err(`${q}: falta el identificador.`);
    else if (ids.has(c.id)) err(`${q}: identificador repetido.`); else ids.add(c.id);
    if (!esTexto(c.nombre)) err(`${q}: falta el nombre.`);
    if (c.origen === 'archivo') {
      const g = c.geojson;
      if (!g || g.type !== 'FeatureCollection' || !Array.isArray(g.features)) err(`${q}: el contenido de la capa está dañado.`);
      else {
        const mala = g.features.findIndex(f => !f || f.type !== 'Feature' || !geomValida(f.geometry));
        if (mala >= 0) err(`${q}: el elemento ${mala + 1} tiene coordenadas dañadas.`);
      }
    } else if (c.origen === 'url') {
      if (!TIPOS_URL.includes(c.tipo)) err(`${q}: tipo de servicio desconocido.`);
      if (!esTexto(c.url) || !/^https?:\/\//i.test(c.url)) err(`${q}: la dirección no es válida.`);
      if ((c.tipo === 'wfs' || c.tipo === 'wms') && (!esTexto(c.capaServicio) || !c.capaServicio)) err(`${q}: falta el nombre de la capa del servicio.`);
    } else err(`${q}: no dice si es de archivo o de URL.`);
  });

  // Puntos
  const idsP = new Set();
  obj.puntos.forEach((p, i) => {
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
    if (p.foto != null && !(esTexto(p.foto) && /^data:image\/[\w.+-]+;base64,/.test(p.foto))) err(`${q}: la foto está dañada.`);
  });

  // Ajustes
  const a = obj.ajustes;
  for (const k of Object.keys(a)) if (!(k in AJUSTES_DEFECTO)) err(`Ajuste desconocido: "${k.slice(0, 30)}".`);
  if (a.proyeccion != null && !PROYECCIONES.includes(a.proyeccion)) err('Ajuste "proyección" inválido.');
  if (a.fondo != null && !FONDOS.includes(a.fondo)) err('Ajuste "fondo" inválido.');
  if (a.capasVisibles != null && !(Array.isArray(a.capasVisibles) && a.capasVisibles.every(esTexto))) err('Ajuste "capas visibles" inválido.');
  if (a.ultimaCopia != null && !esFecha(a.ultimaCopia)) err('Ajuste "última copia" inválido.');
  if (a.vista != null && !(esNum(a.vista.lat) && esNum(a.vista.lon) && esNum(a.vista.zoom))) err('Ajuste "vista del mapa" inválido.');

  return { ok: errores.length === 0, errores,
    resumen: { fecha: obj.fecha, capas: obj.capas.length, puntos: obj.puntos.length, fotos: obj.puntos.filter(p => p && p.foto).length } };
}

// Prepara los datos ya revisados para guardarlos (fotos de texto a imagen).
export function prepararRestauracion(obj) {
  const ajustes = { ...obj.ajustes };
  // La copia que se está restaurando cuenta como "copia descargada" en su fecha.
  if (!ajustes.ultimaCopia || Date.parse(obj.fecha) > Date.parse(ajustes.ultimaCopia)) ajustes.ultimaCopia = obj.fecha;
  return {
    capas: obj.capas,
    puntos: obj.puntos.map(p => ({ ...p, nota: p.nota ?? '', foto: p.foto ? textoABlob(p.foto) : null })),
    ajustes
  };
}

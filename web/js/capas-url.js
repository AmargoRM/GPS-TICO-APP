/* =======================================================================
   CAPAS DESDE URL: GeoJSON, WFS y WMS
   Igual que en la app Android: GeoJSON y WFS se DESCARGAN y quedan
   guardados en el celular (se ven sin internet). Se recuerda la dirección
   de origen para actualizarlos con el botón 🔄. WMS son imágenes que se
   piden al servidor a medida que se mueve el mapa (necesita internet;
   lo ya visto queda guardado).

   Problema común: CORS. Es una regla del SERVIDOR que decide si otras
   páginas web pueden leer sus datos. Si el servidor no lo permite, el
   navegador bloquea la descarga y no hay nada que la app pueda hacer.
   En ese caso se muestra un mensaje claro y la app sigue funcionando.
   ======================================================================= */
import { normalizarGeoJSON, ajustarProyeccion } from './importar.js';

// Error con mensaje ya traducido para mostrar al usuario.
export class ErrorURL extends Error {}

// Descarga una dirección y devuelve el texto. Si falla, lanza ErrorURL
// con una explicación en español de QUÉ pasó.
export async function pedirTexto(url) {
  let u;
  try { u = new URL(url); } catch (e) { throw new ErrorURL('La dirección no es válida. Debe empezar con https://'); }
  if (u.protocol === 'http:' && location.protocol === 'https:') {
    throw new ErrorURL('La dirección empieza con http:// (sin candado). Como esta app usa https://, el navegador bloquea direcciones sin candado. Probá la misma dirección con https://, o descargá el archivo y cargalo desde "Archivo".');
  }
  if (!navigator.onLine) throw new ErrorURL('No hay conexión a internet. Las capas desde URL necesitan internet.');
  let resp;
  try {
    resp = await fetch(u.href, { signal: AbortSignal.timeout(25000) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new ErrorURL('El servidor tardó demasiado en responder (más de 25 segundos). Probá más tarde.');
    }
    // fetch lanza TypeError sin detalles cuando el servidor bloquea por CORS
    // o cuando no se puede conectar. El navegador no deja distinguirlos.
    throw new ErrorURL('El servidor no permitió la descarga. Lo más probable es que no autorice a otras páginas web a leer sus datos (permiso CORS). No es un error de la app ni de tus datos. Alternativa: descargá el archivo en tu computadora o celular y cargalo desde "Archivo".');
  }
  if (!resp.ok) {
    const que = resp.status === 404 ? 'no existe (404)' : resp.status === 403 || resp.status === 401 ? 'pide permiso o usuario (' + resp.status + ')'
      : resp.status >= 500 ? 'tuvo un error interno (' + resp.status + ')' : 'respondió con error ' + resp.status;
    throw new ErrorURL('El servidor ' + que + '. Revisá la dirección.');
  }
  return await resp.text();
}

// Interpreta texto como GeoJSON y lo pasa a lat/lon si viene en CRTM05/Lambert.
// Devuelve { fc, proyFuente }.
function textoAGeoJSON(texto) {
  let obj;
  try { obj = JSON.parse(texto); }
  catch (e) {
    if (/ExceptionReport|ServiceException/i.test(texto)) {
      const m = texto.match(/<(?:\w+:)?ExceptionText>([\s\S]*?)<\/|<ServiceException[^>]*>([\s\S]*?)<\//i);
      throw new ErrorURL('El servidor respondió con un error: ' + ((m && (m[1] || m[2])) || 'sin detalle').trim().slice(0, 200));
    }
    throw new ErrorURL('La dirección no devolvió GeoJSON (devolvió otro tipo de contenido).');
  }
  let fc;
  try { fc = normalizarGeoJSON(obj); } catch (e) { throw new ErrorURL(e.message); }
  const r = ajustarProyeccion(fc, 'auto', null);
  return { fc, proyFuente: r.modo };
}

/* --- GetCapabilities: lista de capas que ofrece un servidor WFS o WMS --- */
const sinConsulta = u => (u || '').trim().split('?')[0];
function leerCapabilities(xml, etiqueta) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ErrorURL('El servidor no devolvió una lista de capas válida. ¿Es realmente un servicio ' + (etiqueta === 'Layer' ? 'WMS' : 'WFS') + '?');
  const out = [];
  for (const el of doc.getElementsByTagName('*')) {
    if (el.localName !== etiqueta) continue;
    let name = null, title = null;
    for (const h of el.children) {
      if (h.localName === 'Name' && !name) name = h.textContent.trim();
      else if (h.localName === 'Title' && !title) title = h.textContent.trim();
    }
    if (name) out.push({ name, title: title || name });
  }
  const raiz = doc.documentElement;
  return { capas: out, version: raiz.getAttribute('version') || '' };
}
export async function escanearWFS(url) {
  const xml = await pedirTexto(`${sinConsulta(url)}?SERVICE=WFS&REQUEST=GetCapabilities`);
  return leerCapabilities(xml, 'FeatureType');
}
export async function escanearWMS(url) {
  const xml = await pedirTexto(`${sinConsulta(url)}?SERVICE=WMS&REQUEST=GetCapabilities`);
  const r = leerCapabilities(xml, 'Layer');
  return { capas: r.capas, version: r.version === '1.1.1' ? '1.1.1' : '1.3.0' };
}
function urlWfsGeoJSON(base, typeName, formato) {
  const p = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeNames: typeName, outputFormat: formato, srsName: 'EPSG:4326', count: '10000' });
  return `${sinConsulta(base)}?${p}`;
}

// Descarga una fuente {tipo:'geojson'|'wfs', url, capaServicio}. Devuelve { fc, proyFuente }.
export async function descargarFuente(fuente) {
  if (fuente.tipo === 'geojson') return textoAGeoJSON(await pedirTexto(fuente.url));
  try { return textoAGeoJSON(await pedirTexto(urlWfsGeoJSON(fuente.url, fuente.capaServicio, 'application/json'))); }
  catch (e) {
    // Algunos servidores usan otro nombre para el formato GeoJSON.
    if (e instanceof ErrorURL && /no devolvió GeoJSON|respondió con un error/.test(e.message)) {
      return textoAGeoJSON(await pedirTexto(urlWfsGeoJSON(fuente.url, fuente.capaServicio, 'json')));
    }
    throw e;
  }
}

/* --- Consulta de una capa WMS en un punto (GetFeatureInfo) --- */
const MERC = 20037508.342789244;
const lon2merc = lon => lon * MERC / 180;
const lat2merc = lat => Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * MERC / 180;
// vista = {oLon, eLon, nLat, sLat, ancho, alto}; px/py = toque en pantalla.
// Devuelve { elementos } (GeoJSON) o { texto } o null.
export async function consultarWMS(capa, vista, px, py) {
  const v = capa.version || '1.3.0';
  const p = new URLSearchParams({
    SERVICE: 'WMS', VERSION: v, REQUEST: 'GetFeatureInfo', LAYERS: capa.capaServicio || '', QUERY_LAYERS: capa.capaServicio || '',
    STYLES: '', FORMAT: 'image/png', INFO_FORMAT: 'application/json', FEATURE_COUNT: '5',
    WIDTH: String(Math.round(vista.ancho)), HEIGHT: String(Math.round(vista.alto))
  });
  const crs = v === '1.3.0' ? 'CRS=EPSG:3857' : 'SRS=EPSG:3857';
  const ij = v === '1.3.0' ? `I=${Math.round(px)}&J=${Math.round(py)}` : `X=${Math.round(px)}&Y=${Math.round(py)}`;
  const bbox = `${lon2merc(vista.oLon)},${lat2merc(vista.sLat)},${lon2merc(vista.eLon)},${lat2merc(vista.nLat)}`;
  const texto = await pedirTexto(`${sinConsulta(capa.url)}?${p}&${crs}&BBOX=${bbox}&${ij}`);
  try { const j = JSON.parse(texto); if (j && j.features && j.features.length) return { elementos: j.features }; } catch (e) { /* no es JSON */ }
  const limpio = texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (limpio.length > 2 && !/ServiceException|error/i.test(limpio.slice(0, 80))) return { texto: limpio.slice(0, 1500) };
  return null;
}

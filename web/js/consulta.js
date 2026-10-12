/* =======================================================================
   CONSULTA DE CAPAS AL TOCAR EL MAPA (igual que la app Android)
   - Tocar: muestra los atributos del elemento más cercano (puntos con más
     tolerancia que líneas y polígonos, porque el dedo es grande).
   - Mantener presionado → "Consultar aquí": lista TODOS los elementos en un
     radio (30 m por defecto) en una tabla al costado; la capa con más
     resultados se resalta en amarillo.
   - Capas grandes: se leen sus atributos al tocar.
   - WMS: se le pregunta al servidor qué hay en ese punto.
   ======================================================================= */
import { S, capaVisible } from './estado.js';
import { aPantalla, pantallaALatLon, cajaDe, elementoOculto, resaltarCapa, vistaActual } from './mapa.js';
import { tocarGrande, atributosGrande, TIPO_GEOM_GRANDE } from './grandes.js';
import { pasaFiltro, filtroActivo } from './filtros.js';
import { consultarWMS, ErrorURL } from './capas-url.js';
import { abrirPanel, cerrarPanel, toast, esc, cargando } from './ui.js';
import { desdeWgs } from './geodesia.js';
import { panelPunto, navegarA } from './puntos.js';

const TOL = 44, TOL_PT = 80;   // píxeles de tolerancia: líneas/polígonos y puntos

/* --- Geometría en pantalla --- */
function distSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
function distLinea(px, py, coords) {
  const pts = coords.map(c => aPantalla(c[1], c[0]));
  if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y);
  let m = Infinity; for (let i = 1; i < pts.length; i++) m = Math.min(m, distSeg(px, py, pts[i - 1], pts[i]));
  return m;
}
function enAnillo(lon, lat, r) {
  let d = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) d = !d;
  }
  return d;
}
const enPoligono = (lon, lat, anillos) => anillos.reduce((d, r) => enAnillo(lon, lat, r) ? !d : d, false);
// Distancia en píxeles del toque a una geometría (0 si cae dentro de un polígono).
export function distGeomPx(g, px, py, ll) {
  const dp = c => { const p = aPantalla(c[1], c[0]); return Math.hypot(px - p.x, py - p.y); };
  switch (g && g.type) {
    case 'Point': return dp(g.coordinates);
    case 'MultiPoint': return Math.min(...g.coordinates.map(dp));
    case 'LineString': return distLinea(px, py, g.coordinates);
    case 'MultiLineString': return Math.min(...g.coordinates.map(l => distLinea(px, py, l)));
    case 'Polygon': return enPoligono(ll.lon, ll.lat, g.coordinates) ? 0 : Math.min(...g.coordinates.map(r => distLinea(px, py, r)));
    case 'MultiPolygon': return g.coordinates.some(p => enPoligono(ll.lon, ll.lat, p)) ? 0 : Math.min(...g.coordinates.map(p => Math.min(...p.map(r => distLinea(px, py, r)))));
    case 'GeometryCollection': return Math.min(Infinity, ...(g.geometries || []).map(gg => distGeomPx(gg, px, py, ll)));
  }
  return Infinity;
}
const esPoligono = g => g && (g.type === 'Polygon' || g.type === 'MultiPolygon' || (g.type === 'GeometryCollection' && (g.geometries || []).some(esPoligono)));
// Capas vectoriales que se pueden consultar, de arriba hacia abajo.
const capasConsultables = () => S.capas.filter(c => capaVisible(c.id) && c.consultable !== false && c.tipo === 'vector' && c.geojson).reverse();

/* --- Tocar el mapa --- */
// Devuelve true si mostró algo.
export async function consultarEnPantalla(px, py) {
  const ll = pantallaALatLon(px, py); if (!ll) return false;
  // 1) Puntos capturados (prioridad: son tuyos).
  let mp = null, md = 30;
  for (const p of S.puntos) { if (p.visible === false) continue; const s = aPantalla(p.lat, p.lon); const d = Math.hypot(px - s.x, py - s.y); if (d < md) { md = d; mp = p; } }
  if (mp) { panelPunto(mp); return true; }
  // 2) Elemento vectorial más cercano (con margen previo por caja).
  const filtro = pantallaALatLon(px - 240, py - 240), filtro2 = pantallaALatLon(px + 240, py + 240);
  const mLon = Math.abs(filtro2.lon - filtro.lon) / 2, mLat = Math.abs(filtro.lat - filtro2.lat) / 2;
  let mejor = null, mejorD = Infinity, cerca = null, cercaD = Infinity, respaldo = null, respaldoA = Infinity;
  for (const c of capasConsultables()) {
    for (const f of c.geojson.features || []) {
      if (!f || !f.geometry || elementoOculto(c, f)) continue;
      const b = cajaDe(f);
      if (b[2] < ll.lon - mLon || b[0] > ll.lon + mLon || b[3] < ll.lat - mLat || b[1] > ll.lat + mLat) continue;
      if (esPoligono(f.geometry) && ll.lon >= b[0] && ll.lon <= b[2] && ll.lat >= b[1] && ll.lat <= b[3]) {
        const a = Math.max(1e-12, (b[2] - b[0]) * (b[3] - b[1])); if (a < respaldoA) { respaldoA = a; respaldo = { c, f }; }
      }
      let d = Infinity; try { d = distGeomPx(f.geometry, px, py, ll); } catch (e) { /* sigue */ }
      if (d < cercaD) { cercaD = d; cerca = { c, f }; }
      const tol = /Point/.test(f.geometry.type) ? TOL_PT : TOL;
      if (d <= tol && d < mejorD) { mejorD = d; mejor = { c, f }; }
    }
    if (mejor && mejorD === 0) break;
  }
  if (mejor) { mostrarAtributos(mejor.c, [mejor.f]); return true; }
  // Si tocaste cerca pero no encima, se toma el más cercano hasta 140 px (como Android).
  if (cerca && cercaD < 140) { mostrarAtributos(cerca.c, [cerca.f]); return true; }
  // 3) Capas grandes.
  const t = vistaActual();
  for (const c of [...S.capas].reverse()) {
    if (c.tipo !== 'grande' || !c.grande || !capaVisible(c.id) || c.consultable === false) continue;
    const fi = tocarGrande(c.grande, px, py, ll.lat, ll.lon, TOL, t.aPant);
    if (fi >= 0) {
      const props = await atributosGrande(c.id, fi);
      mostrarAtributos(c, [{ properties: props, geometry: { type: TIPO_GEOM_GRANDE[c.grande.featType[fi]] } }], true);
      return true;
    }
  }
  if (respaldo) { mostrarAtributos(respaldo.c, [respaldo.f]); return true; }
  // 4) WMS: preguntar al servidor.
  const wms = [...S.capas].reverse().find(c => c.tipo === 'wms' && capaVisible(c.id) && c.consultable !== false);
  if (wms) { await consultarCapaWMS(wms, px, py); return true; }
  // 5) Nada: avisar en vez de quedarse mudo.
  const hay = S.capas.some(c => capaVisible(c.id));
  if (hay && !S.capas.some(c => capaVisible(c.id) && c.consultable !== false)) toast('Activá la lupa 🔍 en la capa para poder consultarla.');
  return false;
}
async function consultarCapaWMS(c, px, py) {
  const t = vistaActual();
  cargando('Consultando ' + c.nombre + '…');
  try {
    const r = await consultarWMS(c, t, px, py);
    if (r && r.elementos) mostrarAtributos(c, r.elementos);
    else if (r && r.texto) abrirPanel('Info · ' + c.nombre, `<div class="nota">${esc(r.texto)}</div>`);
    else toast('Sin datos en ese punto (o el servidor no permite consultar).');
  } catch (e) {
    toast(e instanceof ErrorURL ? e.message : 'No se pudo consultar la capa.', 7000);
  } finally { cargando(null); }
}

/* --- Consultar por radio (mantener presionado → Consultar) --- */
function metrosAPx(lat, metros) {
  const a = aPantalla(lat, 0), b = aPantalla(lat + metros / 111320, 0);
  return a && b ? Math.abs(b.y - a.y) : 30;
}
export function consultarPorRadio(px, py, radioM) {
  const ll = pantallaALatLon(px, py); if (!ll) return;
  const rPx = Math.max(30, metrosAPx(ll.lat, radioM));
  const p1 = pantallaALatLon(px - rPx, py - rPx), p2 = pantallaALatLon(px + rPx, py + rPx);
  const mLon = Math.abs(p2.lon - p1.lon), mLat = Math.abs(p1.lat - p2.lat);
  const encontrados = [];
  for (const c of capasConsultables()) {
    for (const f of c.geojson.features || []) {
      if (!f || !f.geometry || elementoOculto(c, f)) continue;
      const b = cajaDe(f);
      if (b[2] < ll.lon - mLon || b[0] > ll.lon + mLon || b[3] < ll.lat - mLat || b[1] > ll.lat + mLat) continue;
      let d = Infinity; try { d = distGeomPx(f.geometry, px, py, ll); } catch (e) { /* sigue */ }
      if (d <= rPx) encontrados.push({ c, f, d });
    }
  }
  encontrados.sort((a, b) => a.d - b.d);
  if (!encontrados.length) {
    const wms = [...S.capas].reverse().find(c => c.tipo === 'wms' && capaVisible(c.id) && c.consultable !== false);
    if (wms) { consultarCapaWMS(wms, px, py); return; }
    toast(`No hay elementos consultables en un radio de ${radioM} m.`);
    return;
  }
  if (encontrados.length === 1) { mostrarAtributos(encontrados[0].c, [encontrados[0].f]); return; }
  tablaLateral(encontrados);
}
function tablaLateral(lista) {
  const conteo = {};
  lista.forEach(x => { conteo[x.c.id] = (conteo[x.c.id] || 0) + 1; });
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];
  resaltarCapa(top ? top[0] : null);
  const nombres = Object.keys(conteo).map(id => S.capas.find(c => c.id === id)?.nombre).filter(Boolean).join(' + ');
  const preferidos = ['nombre', 'name', 'id', 'tipo', 'clase', 'categoria', 'codigo'];
  const filas = lista.slice(0, 200).map((x, i) => {
    const p = x.f.properties || {}, k = Object.keys(p);
    const orden = [...preferidos.filter(z => k.includes(z)), ...k.filter(z => !preferidos.includes(z))];
    const tit = orden[0] ? esc(String(p[orden[0]]).slice(0, 50)) : 'Elemento ' + (i + 1);
    const sub = orden[1] ? `${esc(orden[1])}: ${esc(String(p[orden[1]]).slice(0, 60))}` : esc(x.c.nombre);
    return `<div class="tabFila" data-i="${i}"><div class="t">${tit}</div><div class="s">${sub}</div></div>`;
  }).join('');
  const el = document.getElementById('tablaLat');
  el.querySelector('h3').textContent = `${lista.length} elementos · ${nombres}`;
  el.querySelector('.cuerpo').innerHTML = `<div class="nota aviso">La capa con más resultados se resalta en amarillo en el mapa.</div>${filas}` +
    (lista.length > 200 ? '<div class="nota">Mostrando los 200 primeros.</div>' : '');
  el.hidden = false;
  el.querySelectorAll('[data-i]').forEach(f => f.onclick = () => { const x = lista[+f.dataset.i]; mostrarAtributos(x.c, [x.f]); });
}
export function cerrarTablaLateral() { document.getElementById('tablaLat').hidden = true; resaltarCapa(null); }

/* --- Panel de atributos --- */
const valorTexto = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
function filasCoords(lat, lon) {
  const c = desdeWgs(lat, lon, 'crtm05'), n = desdeWgs(lat, lon, 'ln'), s = desdeWgs(lat, lon, 'ls');
  return `<tr><td>CRTM05 X / Y</td><td>${c.e.toFixed(2)}<br>${c.n.toFixed(2)}</td></tr>
    <tr><td>Lambert Norte X / Y</td><td>${n.e.toFixed(2)}<br>${n.n.toFixed(2)}</td></tr>
    <tr><td>Lambert Sur X / Y</td><td>${s.e.toFixed(2)}<br>${s.n.toFixed(2)}</td></tr>
    <tr><td>Latitud / Longitud</td><td>${lat.toFixed(7)}<br>${lon.toFixed(7)}</td></tr>`;
}
export function mostrarAtributos(capa, feats, esGrande) {
  const f = feats.find(x => x && x.properties && Object.keys(x.properties).length) || feats[0];
  const props = (f && f.properties) || {};
  const claves = Object.keys(props);
  const g = f && f.geometry;
  const esPunto = g && g.type === 'Point' && g.coordinates;
  const conTabla = capa.tipo === 'vector';
  const cuerpo = abrirPanel('Atributos · ' + capa.nombre, `
    ${feats.length > 1 ? `<div class="nota">${feats.length} elementos aquí; se muestra uno.</div>` : ''}
    ${claves.length ? `<table class="coords">${claves.map(k => `<tr><td>${esc(k)}</td><td class="texto">${esc(valorTexto(props[k]))}</td></tr>`).join('')}</table>`
      : '<div class="nota">Este elemento no trae atributos.</div>'}
    <table class="coords"><tr><td>Geometría</td><td class="texto">${esc(g ? g.type : '—')}</td></tr></table>
    ${esPunto ? `<h4>Coordenadas</h4><table class="coords">${filasCoords(g.coordinates[1], g.coordinates[0])}</table>
      <button class="ancho" id="atNav">➤ Navegar hacia aquí</button>` : ''}
    ${conTabla ? '<button class="ancho borde" id="atTabla">Ver tabla completa de la capa</button>' : ''}
    ${esGrande ? '<div class="nota">Capa grande: se muestran los atributos; no hay tabla completa ni etiquetas.</div>' : ''}`);
  if (esPunto) cuerpo.querySelector('#atNav').onclick = () => {
    const nom = props.nombre || props.name || props.Name || 'Elemento de ' + capa.nombre;
    cerrarPanel(); navegarA({ id: 'elemento', nombre: String(nom), lat: g.coordinates[1], lon: g.coordinates[0] });
  };
  if (conTabla) cuerpo.querySelector('#atTabla').onclick = () => tablaAtributos(capa);
}
// Tabla completa de atributos de una capa (hasta 500 filas, como Android).
export function tablaAtributos(capa) {
  if (!capa.geojson) { toast('Esta capa no tiene datos.'); return; }
  const todos = capa.geojson.features || [];
  const feats = todos.filter(f => pasaFiltro(capa, f));   // con filtro: solo los que cumplen
  const claves = [];
  for (const f of feats) { for (const k of Object.keys(f.properties || {})) if (!claves.includes(k)) claves.push(k); if (claves.length >= 12) break; }
  const filas = feats.slice(0, 500).map((f, i) => `<tr data-i="${i}"><td>${i + 1}</td>${claves.map(k => `<td>${esc(valorTexto((f.properties || {})[k]))}</td>`).join('')}</tr>`).join('');
  const cuerpo = abrirPanel('Tabla · ' + capa.nombre, `
    <div class="tablaScroll"><table class="atbl"><thead><tr><th>#</th>${claves.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div>
    <div class="nota">${feats.length} elementos${filtroActivo(capa) ? ` (filtro activo: ${feats.length} de ${todos.length})` : ''}${feats.length > 500 ? ' · se muestran 500' : ''}. Tocá una fila para ver el elemento.</div>`);
  cuerpo.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => mostrarAtributos(capa, [feats[+tr.dataset.i]]));
}

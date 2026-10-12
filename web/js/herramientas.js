/* =======================================================================
   HERRAMIENTAS DEL MAPA (igual que la app Android)
   - 📏 Medir: tocá el mapa para sumar vértices; distancia, perímetro y área
     (el área se calcula en CRTM05, en metros).
   - 🧭 Navegar: tocá un destino; distancia en línea recta, ruta por calles
     (necesita internet) y abrir en Waze / Google Maps / Apple Mapas.
   - 📍 Chincheta (mantener presionado): punto de referencia con círculo de
     radio (buffer), navegar, abrir en otras apps o guardar como punto.
   - Convertir coordenadas entre Geo, CRTM05 y Lambert.
   ======================================================================= */
import { S } from './estado.js';
import { guardar, nuevoId } from './bd.js';
import { tmFwd, CRTM05, distM, desdeWgs, haciaWgs, textoCoord, textoDist, PROY, D2R, R2D, aCRTM05 } from './geodesia.js';
import { abrirPanel, cerrarPanel, toast, esc, cargando } from './ui.js';
import { pedirDibujo, registrarSobrecapa, pantallaALatLon, irA, vista } from './mapa.js';
import { navegarA, dejarDeNavegar } from './puntos.js';
import { consultarPorRadio } from './consulta.js';
import { esIOS } from './compat.js';

export let modo = 'consulta';            // 'consulta' | 'medir' | 'navegar'
const medicion = { pts: [], unidad: 'm' };
let chincheta = null, radioBuffer = 0;   // {lat, lon} y radio en metros
let ruta = null;                          // { coords:[[lon,lat]…], dist, dur }

/* --- Formatos --- */
function fmtDist(m, unidad) {
  if (unidad === 'km' || (unidad == null && m >= 1000)) return (m / 1000).toFixed(m >= 10000 ? 1 : 2) + ' km';
  return m.toFixed(m < 100 ? 1 : 0) + ' m';
}
// Área de un polígono en m² calculada en CRTM05 (metros), robusta para Costa Rica.
export function areaM2(pts) {
  if (pts.length < 3) return 0;
  const p = pts.map(q => tmFwd(q.lat, q.lon, CRTM05));
  let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].e * p[i].n - p[i].e * p[j].n;
  return Math.abs(a / 2);
}
const fmtArea = m2 => m2 >= 10000 ? `${Math.round(m2).toLocaleString('es-CR')} m² · ${(m2 / 10000).toFixed(4)} ha` : `${m2.toFixed(1)} m²`;

/* --- Modos --- */
export function cambiarModo(m) {
  modo = modo === m ? 'consulta' : m;
  document.getElementById('btnMedir').classList.toggle('activo', modo === 'medir');
  document.getElementById('btnNav').classList.toggle('activo', modo === 'navegar');
  if (modo === 'medir' && !medicion.pts.length) toast('Tocá el mapa para agregar puntos de medición.');
  if (modo === 'navegar' && !S.destino) toast('Tocá un punto de destino en el mapa.');
  actualizarBarra(); pedirDibujo();
}
// Toque en el mapa mientras hay una herramienta activa. Devuelve true si lo usó.
export function tocarConHerramienta(lat, lon) {
  if (modo === 'medir') { medicion.pts.push({ lat, lon }); actualizarBarra(); pedirDibujo(); return true; }
  if (modo === 'navegar') { ruta = null; navegarA({ id: 'mapa', nombre: 'Destino en el mapa', lat, lon }); actualizarBarra(); return true; }
  return false;
}
export function actualizarBarra() {
  const barra = document.getElementById('herramienta');
  const txt = barra.querySelector('.txt'), bots = barra.querySelector('.botones');
  if (modo === 'medir') {
    barra.hidden = false;
    let d = 0; for (let i = 1; i < medicion.pts.length; i++) d += distM(medicion.pts[i - 1].lat, medicion.pts[i - 1].lon, medicion.pts[i].lat, medicion.pts[i].lon);
    let extra = '';
    if (medicion.pts.length >= 3) {
      const a = medicion.pts[0], z = medicion.pts[medicion.pts.length - 1];
      extra = `<br>Perímetro: <b>${fmtDist(d + distM(z.lat, z.lon, a.lat, a.lon), medicion.unidad)}</b><br>Área: <b>${fmtArea(areaM2(medicion.pts))}</b> <span class="s">(CRTM05)</span>`;
    }
    txt.innerHTML = `<b>Medición</b> · ${medicion.pts.length} punto(s)<br>Distancia: <b>${fmtDist(d, medicion.unidad)}</b>${extra}`;
    bots.innerHTML = `<button class="mini borde" id="hU">${medicion.unidad === 'km' ? 'm' : 'km'}</button><button class="mini borde" id="hD">Deshacer</button><button class="mini borde" id="hL">Limpiar</button><button class="mini" id="hS">Salir</button>`;
    bots.querySelector('#hU').onclick = () => { medicion.unidad = medicion.unidad === 'km' ? 'm' : 'km'; actualizarBarra(); };
    bots.querySelector('#hD').onclick = () => { medicion.pts.pop(); actualizarBarra(); pedirDibujo(); };
    bots.querySelector('#hL').onclick = () => { medicion.pts = []; actualizarBarra(); pedirDibujo(); };
    bots.querySelector('#hS').onclick = () => cambiarModo('medir');
  } else if (modo === 'navegar') {
    barra.hidden = false;
    const d = S.destino;
    let info = 'Tocá un punto de destino en el mapa.';
    if (d) {
      info = `<b>Destino</b> ${esc(d.nombre || '')} ${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}<br>` +
        (S.fix ? `En línea recta: <b>${fmtDist(distM(S.fix.lat, S.fix.lon, d.lat, d.lon))}</b>` : 'Esperando posición GPS…');
      if (ruta) info += `<br>Por caminos: <b>${fmtDist(ruta.dist)}</b> · ${Math.round(ruta.dur / 60)} min a pie`;
    }
    txt.innerHTML = info;
    bots.innerHTML = `<button class="mini" id="hR">Ruta por caminos</button><button class="mini borde" id="hW">Waze</button><button class="mini borde" id="hG">Google Maps</button>${esIOS ? '<button class="mini borde" id="hA">Apple Mapas</button>' : ''}<button class="mini borde" id="hQ">Quitar destino</button><button class="mini" id="hS">Salir</button>`;
    bots.querySelector('#hR').onclick = calcularRuta;
    bots.querySelector('#hW').onclick = () => d ? abrirWaze(d.lat, d.lon) : toast('Elegí un destino.');
    bots.querySelector('#hG').onclick = () => d ? abrirGoogle(d.lat, d.lon) : toast('Elegí un destino.');
    if (esIOS) bots.querySelector('#hA').onclick = () => d ? abrirApple(d.lat, d.lon) : toast('Elegí un destino.');
    bots.querySelector('#hQ').onclick = () => { ruta = null; dejarDeNavegar(); actualizarBarra(); };
    bots.querySelector('#hS').onclick = () => cambiarModo('navegar');
  } else barra.hidden = true;
}

/* --- Ruta por caminos (servidor público OSRM, necesita internet) --- */
async function calcularRuta() {
  const d = S.destino;
  if (!d) { toast('Tocá un destino primero.'); return; }
  if (!S.fix) { toast('Todavía no hay posición GPS.'); return; }
  if (!navigator.onLine) { toast('La ruta por caminos necesita internet.'); return; }
  cargando('Calculando ruta…');
  try {
    const url = `https://router.project-osrm.org/route/v1/foot/${S.fix.lon},${S.fix.lat};${d.lon},${d.lat}?overview=full&geometries=geojson`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (j && j.routes && j.routes.length) {
      const rt = j.routes[0];
      ruta = { coords: rt.geometry.coordinates, dist: rt.distance, dur: rt.duration };
      actualizarBarra(); pedirDibujo();
    } else toast('No se encontró ruta por caminos.');
  } catch (e) { toast('No se pudo calcular la ruta (necesita internet y que el servicio responda).'); }
  finally { cargando(null); }
}
// Abrir otras apps de navegación.
const abrir = url => { window.location.href = url; };
export const abrirWaze = (lat, lon) => abrir(`https://waze.com/ul?ll=${lat},${lon}&navigate=yes`);
export const abrirGoogle = (lat, lon) => abrir(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`);
export const abrirApple = (lat, lon) => abrir(`https://maps.apple.com/?daddr=${lat},${lon}`);

/* --- Chincheta --- */
// Círculo geográfico de radio R metros (para el buffer).
function circulo(lat, lon, R, n = 72) {
  const pts = [], dR = R / 6371000, la = lat * D2R, lo = lon * D2R;
  for (let i = 0; i <= n; i++) {
    const b = 2 * Math.PI * i / n;
    const la2 = Math.asin(Math.sin(la) * Math.cos(dR) + Math.cos(la) * Math.sin(dR) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dR) * Math.cos(la), Math.cos(dR) - Math.sin(la) * Math.sin(la2));
    pts.push([lo2 * R2D, la2 * R2D]);
  }
  return pts;
}
export function ponerChincheta(lat, lon) {
  chincheta = { lat, lon };
  if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) { /* sin vibración */ } }
  pedirDibujo(); panelChincheta();
}
export function panelChincheta() {
  if (!chincheta) return;
  const modoP = S.ajustes.proyeccion, t = textoCoord(chincheta.lat, chincheta.lon, modoP);
  const dist = S.fix ? distM(S.fix.lat, S.fix.lon, chincheta.lat, chincheta.lon) : null;
  const cuerpo = abrirPanel('Chincheta', `
    <table class="coords"><tr><td>${PROY[modoP].nom}</td><td>${t.a}<br>${t.b}</td></tr>
    ${dist != null ? `<tr><td>Distancia desde tu GPS</td><td>${fmtDist(dist)}</td></tr>` : ''}</table>
    <label>Buffer (radio en metros)</label><input id="chBuf" type="number" inputmode="decimal" min="0" value="${radioBuffer || ''}" placeholder="ej. 50">
    <div class="fila2"><button class="ancho" id="chBufOk">Dibujar buffer</button><button class="ancho borde" id="chBufNo">Quitar buffer</button></div>
    <button class="ancho" id="chNav">➤ Navegar aquí (en la app)</button>
    <div class="fila2"><button class="ancho borde" id="chWaze">Waze</button><button class="ancho borde" id="chMaps">Google Maps</button>${esIOS ? '<button class="ancho borde" id="chApple">Apple Mapas</button>' : ''}</div>
    <div class="fila2"><button class="ancho borde" id="chGuardar">Guardar como punto</button><button class="ancho borde" id="chQuitar">Quitar chincheta</button></div>`);
  const c = chincheta;
  cuerpo.querySelector('#chBufOk').onclick = () => { radioBuffer = Math.max(0, parseFloat(cuerpo.querySelector('#chBuf').value.replace(',', '.')) || 0); pedirDibujo(); toast(radioBuffer ? 'Buffer de ' + fmtDist(radioBuffer) : 'Sin buffer'); };
  cuerpo.querySelector('#chBufNo').onclick = () => { radioBuffer = 0; cuerpo.querySelector('#chBuf').value = ''; pedirDibujo(); };
  cuerpo.querySelector('#chNav').onclick = () => { cerrarPanel(); ruta = null; navegarA({ id: 'chincheta', nombre: 'Chincheta', lat: c.lat, lon: c.lon }); if (modo !== 'navegar') cambiarModo('navegar'); };
  cuerpo.querySelector('#chWaze').onclick = () => abrirWaze(c.lat, c.lon);
  cuerpo.querySelector('#chMaps').onclick = () => abrirGoogle(c.lat, c.lon);
  if (esIOS) cuerpo.querySelector('#chApple').onclick = () => abrirApple(c.lat, c.lon);
  cuerpo.querySelector('#chGuardar').onclick = async () => {
    let n = 0; for (const p of S.puntos) { const m = /^REF(\d+)$/.exec(p.nombre); if (m) n = Math.max(n, +m[1]); }
    const xy = aCRTM05(c.lat, c.lon);
    const p = { id: nuevoId(), nombre: 'REF' + String(n + 1).padStart(3, '0'), nota: '(chincheta)', fecha: new Date().toISOString(),
      lat: +c.lat.toFixed(8), lon: +c.lon.toFixed(8), x: xy.x, y: xy.y, precision: null, fuente: 'chincheta', fotos: [], datos: null };
    await guardar('puntos', p); S.puntos.push(p);
    document.dispatchEvent(new Event('datos-cambiados'));
    cerrarPanel(); pedirDibujo(); toast('Punto de referencia guardado: ' + p.nombre);
  };
  cuerpo.querySelector('#chQuitar').onclick = () => { chincheta = null; radioBuffer = 0; cerrarPanel(); pedirDibujo(); };
}

/* --- Menú al mantener presionado: Consultar (radio) / Chincheta --- */
export function abrirMenuMantener(cx, cy, px, py) {
  if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) { /* sin vibración */ } }
  const m = document.getElementById('menuMantener');
  const radio = S.ajustes.radioConsulta || 30;
  m.querySelector('#mmConsultar .s').textContent = `(${radio} m)`;
  const op = m.querySelector('.opciones');
  op.style.left = Math.max(110, Math.min(window.innerWidth - 110, cx)) + 'px';
  op.style.top = Math.max(150, cy) + 'px';
  m.hidden = false;
  const cerrar = () => { m.hidden = true; };
  m.querySelector('.fondo').onclick = cerrar;
  m.querySelector('#mmConsultar').onclick = () => { cerrar(); consultarPorRadio(px, py, radio); };
  m.querySelector('#mmChincheta').onclick = () => { cerrar(); const ll = pantallaALatLon(px, py); if (ll) ponerChincheta(ll.lat, ll.lon); };
}

/* --- Dibujo de las herramientas sobre el mapa --- */
registrarSobrecapa((g, aPant) => {
  const pts = medicion.pts;
  if (pts.length) {
    if (pts.length >= 3) {
      g.beginPath(); pts.forEach((p, i) => { const s = aPant(p.lat, p.lon); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
      g.closePath(); g.fillStyle = 'rgba(79,209,197,.14)'; g.fill();
      const a = aPant(pts[0].lat, pts[0].lon), z = aPant(pts[pts.length - 1].lat, pts[pts.length - 1].lon);
      g.setLineDash([6, 5]); g.strokeStyle = 'rgba(79,209,197,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(z.x, z.y); g.lineTo(a.x, a.y); g.stroke(); g.setLineDash([]);
    }
    g.strokeStyle = '#4FD1C5'; g.lineWidth = 3;
    g.beginPath(); pts.forEach((p, i) => { const s = aPant(p.lat, p.lon); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); }); g.stroke();
    for (const p of pts) { const s = aPant(p.lat, p.lon); g.beginPath(); g.arc(s.x, s.y, 5, 0, 7); g.fillStyle = '#4FD1C5'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#0A1214'; g.stroke(); }
  }
  if (ruta && S.destino) {
    g.strokeStyle = '#6FCF6F'; g.lineWidth = 4;
    g.beginPath(); ruta.coords.forEach((c, i) => { const s = aPant(c[1], c[0]); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); }); g.stroke();
  }
  if (chincheta) {
    if (radioBuffer > 0) {
      g.beginPath(); circulo(chincheta.lat, chincheta.lon, radioBuffer).forEach((c, i) => { const s = aPant(c[1], c[0]); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
      g.closePath(); g.fillStyle = 'rgba(199,81,70,.14)'; g.fill(); g.strokeStyle = '#C75146'; g.lineWidth = 2; g.stroke();
    }
    const s = aPant(chincheta.lat, chincheta.lon);
    g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - 6, s.y - 12); g.lineTo(s.x + 6, s.y - 12); g.closePath(); g.fillStyle = '#C75146'; g.fill();
    g.beginPath(); g.arc(s.x, s.y - 16, 8, 0, 7); g.fill(); g.lineWidth = 2; g.strokeStyle = '#0A1214'; g.stroke();
    g.beginPath(); g.arc(s.x, s.y - 16, 3, 0, 7); g.fillStyle = '#0A1214'; g.fill();
  }
});

/* --- Convertir coordenadas --- */
const gms = (v, esLat) => {
  const h = v < 0 ? (esLat ? 'S' : 'O') : (esLat ? 'N' : 'E'); v = Math.abs(v);
  const g = Math.floor(v), m = Math.floor((v - g) * 60), s = ((v - g) * 60 - m) * 60;
  return `${g}° ${String(m).padStart(2, '0')}' ${s.toFixed(2).padStart(5, '0')}" ${h}`;
};
export function panelConvertir() {
  const cuerpo = abrirPanel('Convertir coordenadas', `
    <label>Sistema de entrada</label>
    <select id="cvIn"><option value="geo">Geográficas (grados decimales)</option><option value="crtm05">CRTM05</option><option value="ln">Lambert Norte</option><option value="ls">Lambert Sur</option></select>
    <div class="fila2"><div><label id="cvLA">Latitud</label><input id="cvA" inputmode="decimal" placeholder="9.431800"></div>
    <div><label id="cvLB">Longitud</label><input id="cvB" inputmode="decimal" placeholder="-84.162000"></div></div>
    <button class="ancho" id="cvOk">Convertir</button>
    <button class="ancho borde" id="cvAqui">Usar mi posición actual</button>
    <div id="cvRes"></div>`);
  const sel = cuerpo.querySelector('#cvIn');
  sel.onchange = () => {
    const g = sel.value === 'geo';
    cuerpo.querySelector('#cvLA').textContent = g ? 'Latitud' : 'Este / X (m)';
    cuerpo.querySelector('#cvLB').textContent = g ? 'Longitud' : 'Norte / Y (m)';
    cuerpo.querySelector('#cvA').placeholder = g ? '9.431800' : '486123.45';
    cuerpo.querySelector('#cvB').placeholder = g ? '-84.162000' : '1042876.10';
  };
  const num = id => parseFloat(cuerpo.querySelector(id).value.replace(',', '.'));
  const correr = () => {
    const a = num('#cvA'), b = num('#cvB');
    if (!isFinite(a) || !isFinite(b)) { toast('Faltan números válidos.'); return; }
    const m = sel.value;
    const w = m === 'geo' ? { lat: a, lon: b } : haciaWgs(a, b, m);
    if (!isFinite(w.lat) || Math.abs(w.lat) > 90 || Math.abs(w.lon) > 180) { toast('Esas coordenadas no caen en la Tierra. Revisá el orden X/Y.'); return; }
    const c = desdeWgs(w.lat, w.lon, 'crtm05'), n = desdeWgs(w.lat, w.lon, 'ln'), s = desdeWgs(w.lat, w.lon, 'ls');
    const fuera = w.lat < 5 || w.lat > 12 || w.lon < -88 || w.lon > -81;
    cuerpo.querySelector('#cvRes').innerHTML = `<table class="coords">
      <tr><td>Geográficas · WGS84</td><td>${w.lat.toFixed(7)}, ${w.lon.toFixed(7)}<br>${gms(w.lat, true)}<br>${gms(w.lon, false)}</td></tr>
      <tr><td>CRTM05 · EPSG:5367</td><td>X ${c.e.toFixed(3)}<br>Y ${c.n.toFixed(3)}</td></tr>
      <tr><td>Lambert Norte · EPSG:5456</td><td>X ${n.e.toFixed(3)}<br>Y ${n.n.toFixed(3)}</td></tr>
      <tr><td>Lambert Sur · EPSG:5457</td><td>X ${s.e.toFixed(3)}<br>Y ${s.n.toFixed(3)}</td></tr></table>
      ${fuera ? '<div class="nota aviso">Este punto queda fuera de Costa Rica: los valores se calculan pero no tienen sentido práctico.</div>' : ''}
      <button class="ancho borde" id="cvIr">Ver en el mapa</button>
      <div class="nota">Lambert usa Helmert de 7 parámetros (como el GPS TICO original). El método oficial del IGN puede diferir de 1 a varios metros; para topografía legal, verificá con la herramienta oficial.</div>`;
    cuerpo.querySelector('#cvIr').onclick = () => { cerrarPanel(); S.seguir = false; irA(w.lat, w.lon, Math.max(vista.zoom, 17)); ponerChincheta(w.lat, w.lon); };
  };
  cuerpo.querySelector('#cvOk').onclick = correr;
  cuerpo.querySelector('#cvAqui').onclick = () => {
    if (!S.fix) { toast('Sin posición todavía.'); return; }
    sel.value = 'geo'; sel.onchange();
    cuerpo.querySelector('#cvA').value = S.fix.lat.toFixed(7);
    cuerpo.querySelector('#cvB').value = S.fix.lon.toFixed(7);
    correr();
  };
}
export { textoDist };

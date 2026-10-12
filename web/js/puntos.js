/* =======================================================================
   PUNTOS: lista por día (como Android), detalle, editar, borrar y
   NAVEGAR hacia un punto (distancia y rumbo desde mi posición actual).
   ======================================================================= */
import { S } from './estado.js';
import { guardar, borrar } from './bd.js';
import { desdeWgs, distM, rumbo, cardinal, textoDist } from './geodesia.js';
import { abrirPanel, cerrarPanel, toast, esc, confirmar, dialogo, fechaTexto } from './ui.js';
import { pedirDibujo, irA, vista } from './mapa.js';
import { alCambiarPosicion, textoPrecision } from './gps.js';

const visible = p => p.visible !== false;
const dia = iso => new Date(iso).toLocaleDateString('es-CR');

export function panelPuntos() {
  const lista = [...S.puntos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const grupos = new Map();
  for (const p of lista) { const d = dia(p.fecha); if (!grupos.has(d)) grupos.set(d, []); grupos.get(d).push(p); }
  const nVis = lista.filter(visible).length;
  const modo = S.ajustes.proyeccion;
  const fila = p => {
    const c = desdeWgs(p.lat, p.lon, modo === 'geo' ? 'crtm05' : modo);
    return `<li data-id="${p.id}" class="${visible(p) ? '' : 'apagada'}">
      <button class="mini ${visible(p) ? '' : 'borde'}" data-vis="${p.id}" aria-label="Ver u ocultar">${visible(p) ? '👁' : '⦸'}</button>
      <div class="cuerpo-item" data-abrir="${p.id}"><div class="t">${esc(p.nombre)}${p.promediado ? ' ◎' : ''}${p.fotos?.length ? ' 📷' : ''}</div>
      <div class="s">X ${c.e.toFixed(1)} · Y ${c.n.toFixed(1)} · ${textoPrecision(p.precision)}${p.promediado ? ` · σ±${p.desvStd} m` : ''}${p.nota ? ' · ' + esc(p.nota.slice(0, 40)) : ''}</div></div>
      <button class="mini borde" data-ir="${p.id}">Ir</button></li>`;
  };
  const cuerpo = abrirPanel(`Puntos (${lista.length})`, lista.length ? `
    <div class="filaCab"><div class="cuerpo-item"><div class="t">Visibles: ${nVis} / ${lista.length}</div><div class="s">Apagá por día o uno por uno</div></div>
      <button class="mini" id="pTodos">Ver todo</button><button class="mini borde" id="pNinguno">Ocultar</button></div>
    ${[...grupos].map(([d, ps]) => `<div class="diaCab"><span>${d} · ${ps.length}</span>
      <button class="mini borde" data-dia="${d}" data-on="${ps.some(visible) ? '0' : '1'}">${ps.some(visible) ? 'Ocultar día' : 'Mostrar día'}</button></div>
      <ul class="lista">${ps.map(fila).join('')}</ul>`).join('')}`
    : '<div class="vacio">Todavía no hay puntos. Usá el botón ● Marcar punto.</div>');
  const fijar = async (ps, v) => { for (const p of ps) { p.visible = v; await guardar('puntos', p); } pedirDibujo(); panelPuntos(); };
  cuerpo.querySelectorAll('[data-abrir]').forEach(el => el.onclick = () => panelPunto(S.puntos.find(p => p.id === el.dataset.abrir)));
  cuerpo.querySelectorAll('[data-vis]').forEach(b => b.onclick = () => { const p = S.puntos.find(x => x.id === b.dataset.vis); fijar([p], !visible(p)); });
  cuerpo.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => { const p = S.puntos.find(x => x.id === b.dataset.ir); cerrarPanel(); S.seguir = false; irA(p.lat, p.lon, 18); });
  cuerpo.querySelectorAll('[data-dia]').forEach(b => b.onclick = () => fijar(grupos.get(b.dataset.dia), b.dataset.on === '1'));
  const t = cuerpo.querySelector('#pTodos'); if (t) t.onclick = () => fijar(S.puntos, true);
  const n = cuerpo.querySelector('#pNinguno'); if (n) n.onclick = () => fijar(S.puntos, false);
}

// Filas de tabla con las coordenadas en los 3 sistemas ticos.
function filasCoords(lat, lon) {
  const ln = desdeWgs(lat, lon, 'ln'), ls = desdeWgs(lat, lon, 'ls'), c = desdeWgs(lat, lon, 'crtm05');
  return `<tr><td>CRTM05 X / Y</td><td>${c.e.toFixed(2)}<br>${c.n.toFixed(2)}</td></tr>
    <tr><td>Lambert Norte X / Y</td><td>${ln.e.toFixed(2)}<br>${ln.n.toFixed(2)}</td></tr>
    <tr><td>Lambert Sur X / Y</td><td>${ls.e.toFixed(2)}<br>${ls.n.toFixed(2)}</td></tr>
    <tr><td>Latitud / Longitud</td><td>${lat.toFixed(7)}<br>${lon.toFixed(7)}</td></tr>`;
}

let urlsFotos = [];
const FUENTE = { gps: 'GPS', manual: 'Coordenadas escritas', chincheta: 'Chincheta' };
export function panelPunto(p) {
  if (!p) return;
  urlsFotos.forEach(u => URL.revokeObjectURL(u));
  urlsFotos = (p.fotos || []).map(f => URL.createObjectURL(f));
  const datos = Object.entries(p.datos || {});
  const cuerpo = abrirPanel(p.nombre, `
    <table class="coords">
      ${filasCoords(p.lat, p.lon)}
      <tr><td>Precisión</td><td>${textoPrecision(p.precision)}</td></tr>
      <tr><td>Altura (GPS)</td><td>${p.altitud != null ? p.altitud + ' m' : '—'}</td></tr>
      <tr><td>Tipo</td><td class="texto">${p.promediado ? `Promediado · ${p.muestras} lecturas · σ ±${p.desvStd} m · ${p.duracion} s` : 'Instantáneo'}</td></tr>
      <tr><td>Fuente</td><td class="texto">${FUENTE[p.fuente] || 'GPS'}</td></tr>
      <tr><td>Fecha y hora</td><td class="texto">${fechaTexto(p.fecha)}</td></tr>
    </table>
    ${p.nota ? `<div class="nota">${esc(p.nota).replace(/\n/g, '<br>')}</div>` : ''}
    ${datos.length ? `<h4>📋 ${esc(p.plantilla || 'Formulario')}</h4><table class="coords">${datos.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="texto">${esc(v)}</td></tr>`).join('')}</table>` : ''}
    ${urlsFotos.length ? `<h4>Fotos (${urlsFotos.length})</h4><div class="fotos">${urlsFotos.map((u, i) => `<img src="${u}" data-foto="${i}" alt="Foto ${i + 1}">`).join('')}</div>` : ''}
    <button class="ancho" id="pNav">➤ Navegar hacia este punto</button>
    <div class="fila2"><button class="ancho borde" id="pVer">Ver en el mapa</button><button class="ancho borde" id="pEditar">Editar</button></div>
    <button class="ancho borde rojo" id="pBorrar">Borrar punto</button>
    <button class="ancho borde" id="pVolver">← Lista de puntos</button>`);
  cuerpo.querySelectorAll('[data-foto]').forEach(im => im.onclick = () => verFoto(urlsFotos[+im.dataset.foto]));
  cuerpo.querySelector('#pNav').onclick = () => { cerrarPanel(); navegarA(p); };
  cuerpo.querySelector('#pVer').onclick = () => { cerrarPanel(); S.seguir = false; irA(p.lat, p.lon, Math.max(vista.zoom, 17)); };
  cuerpo.querySelector('#pVolver').onclick = panelPuntos;
  cuerpo.querySelector('#pEditar').onclick = async () => {
    const r = await dialogo({ titulo: 'Cambiar nombre', html: 'Nombre actual: <b>' + esc(p.nombre) + '</b><br><small>Dejalo vacío para no cambiarlo.</small>',
      campo: { placeholder: p.nombre }, botones: [{ texto: 'Cancelar', valor: false, clase: 'borde' }, { texto: 'Siguiente', valor: true }] });
    if (!r.valor) return;
    const r2 = await dialogo({ titulo: 'Cambiar descripción', html: 'Actual: ' + (esc(p.nota) || '<i>(vacía)</i>') + '<br><small>Dejalo vacío para no cambiarla.</small>',
      campo: { placeholder: 'Nueva descripción' }, botones: [{ texto: 'Cancelar', valor: false, clase: 'borde' }, { texto: 'Guardar', valor: true }] });
    if (!r2.valor) return;
    if (r.texto.trim()) p.nombre = r.texto.trim().slice(0, 80);
    if (r2.texto.trim()) p.nota = r2.texto.trim();
    await guardar('puntos', p);
    pedirDibujo(); panelPunto(p); toast('Punto actualizado.');
  };
  cuerpo.querySelector('#pBorrar').onclick = async () => {
    if (!await confirmar('Borrar punto', `¿Borrar el punto <b>${esc(p.nombre)}</b> y sus fotos? No se puede deshacer (salvo que lo tengas en una copia de seguridad).`, 'Borrar', 'Cancelar', true)) return;
    await borrar('puntos', p.id);
    S.puntos = S.puntos.filter(x => x.id !== p.id);
    if (S.destino && S.destino.id === p.id) dejarDeNavegar();
    pedirDibujo(); panelPuntos();
  };
}
// Foto a pantalla completa; tocar para cerrar.
function verFoto(url) {
  const ov = document.createElement('div');
  ov.className = 'visorFoto';
  ov.innerHTML = `<img src="${url}" alt="Foto">`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

/* --- Navegación --- */
let brujula = null;          // hacia dónde apunta el celular (grados), si hay brújula
let quitarOyente = null;

function alOrientar(e) {
  if (e.webkitCompassHeading != null) brujula = e.webkitCompassHeading;           // iPhone
  else if (e.absolute && e.alpha != null) brujula = (360 - e.alpha) % 360;          // Android
  actualizarNav();
}
async function activarBrujula() {
  try {
    // iPhone pide permiso explícito (tiene que ser después de tocar un botón).
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
    }
    window.addEventListener('deviceorientationabsolute', alOrientar);
    window.addEventListener('deviceorientation', alOrientar);
  } catch (e) { /* sin brújula: se usa solo el rumbo respecto al norte */ }
}

export function navegarA(destino) {
  S.destino = destino;
  document.getElementById('navCaja').hidden = false;
  document.getElementById('navNombre').textContent = 'Hacia: ' + destino.nombre;
  activarBrujula();
  if (quitarOyente) quitarOyente();
  quitarOyente = alCambiarPosicion(actualizarNav);
  actualizarNav();
  pedirDibujo();
}
export function dejarDeNavegar() {
  S.destino = null;
  document.getElementById('navCaja').hidden = true;
  window.removeEventListener('deviceorientationabsolute', alOrientar);
  window.removeEventListener('deviceorientation', alOrientar);
  brujula = null;
  if (quitarOyente) { quitarOyente(); quitarOyente = null; }
  pedirDibujo();
}
function actualizarNav() {
  const d = S.destino; if (!d) return;
  const dist = document.getElementById('navDist'), rum = document.getElementById('navRumbo'), fl = document.getElementById('navFlecha');
  if (!S.fix) { dist.textContent = '—'; rum.textContent = 'Esperando GPS…'; return; }
  const m = distM(S.fix.lat, S.fix.lon, d.lat, d.lon);
  const r = rumbo(S.fix.lat, S.fix.lon, d.lat, d.lon);
  dist.textContent = textoDist(m);
  const llegaste = m <= Math.max(5, S.fix.precision || 0);
  rum.textContent = llegaste ? `Llegaste (dentro de la precisión ${textoPrecision(S.fix.precision)})`
    : `Rumbo ${Math.round(r)}° ${cardinal(r)} · ` + (brujula != null ? 'la flecha sigue la brújula' : 'flecha respecto al norte');
  // Con brújula, la flecha apunta hacia el destino desde donde mira el celular.
  fl.style.transform = `rotate(${brujula != null ? r - brujula : r}deg)`;
  fl.textContent = llegaste ? '◎' : '↑';
}

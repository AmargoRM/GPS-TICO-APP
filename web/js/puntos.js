/* =======================================================================
   PUNTOS: lista, detalle, editar, borrar y NAVEGAR hacia un punto
   (distancia y rumbo desde mi posición actual).
   ======================================================================= */
import { S } from './estado.js';
import { guardar, borrar } from './bd.js';
import { desdeWgs, distM, rumbo, cardinal, textoDist } from './geodesia.js';
import { abrirPanel, cerrarPanel, toast, esc, confirmar, dialogo, fechaTexto } from './ui.js';
import { pedirDibujo, irA, vista } from './mapa.js';
import { alCambiarPosicion, textoPrecision } from './gps.js';

export function panelPuntos() {
  const lista = [...S.puntos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const cuerpo = abrirPanel(`Puntos (${lista.length})`, lista.length ? `<ul class="lista">${lista.map(p => `
      <li data-id="${p.id}">
        <div class="cuerpo-item"><div class="t">${esc(p.nombre)} ${p.foto ? '📷' : ''}</div>
        <div class="s">${fechaTexto(p.fecha)} · ${textoPrecision(p.precision)} · X ${p.x.toFixed(1)} Y ${p.y.toFixed(1)}</div></div>
        <button class="mini borde">›</button>
      </li>`).join('')}</ul>` : '<div class="vacio">Todavía no hay puntos. Usá el botón ● Capturar.</div>');
  cuerpo.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => panelPunto(S.puntos.find(p => p.id === li.dataset.id)));
}

// Fila de tabla con las coordenadas de un lat/lon en los 3 sistemas ticos.
function filasCoords(lat, lon) {
  const ln = desdeWgs(lat, lon, 'ln'), ls = desdeWgs(lat, lon, 'ls'), c = desdeWgs(lat, lon, 'crtm05');
  return `<tr><td>CRTM05 X / Y</td><td>${c.e.toFixed(2)}<br>${c.n.toFixed(2)}</td></tr>
    <tr><td>Lambert Norte X / Y</td><td>${ln.e.toFixed(2)}<br>${ln.n.toFixed(2)}</td></tr>
    <tr><td>Lambert Sur X / Y</td><td>${ls.e.toFixed(2)}<br>${ls.n.toFixed(2)}</td></tr>
    <tr><td>Latitud / Longitud</td><td>${lat.toFixed(7)}<br>${lon.toFixed(7)}</td></tr>`;
}

let urlFoto = null;
export function panelPunto(p) {
  if (!p) return;
  if (urlFoto) { URL.revokeObjectURL(urlFoto); urlFoto = null; }
  if (p.foto) urlFoto = URL.createObjectURL(p.foto);
  const cuerpo = abrirPanel(p.nombre, `
    <table class="coords">
      ${filasCoords(p.lat, p.lon)}
      <tr><td>Precisión al capturar</td><td>${textoPrecision(p.precision)}</td></tr>
      <tr><td>Fecha y hora</td><td>${fechaTexto(p.fecha)}</td></tr>
    </table>
    ${p.nota ? `<div class="nota">${esc(p.nota).replace(/\n/g, '<br>')}</div>` : ''}
    ${urlFoto ? `<img class="foto" src="${urlFoto}" alt="Foto del punto">` : ''}
    <button class="ancho" id="pNav">➤ Navegar hacia este punto</button>
    <div class="fila2"><button class="ancho borde" id="pVer">Ver en el mapa</button><button class="ancho borde" id="pEditar">Editar</button></div>
    <button class="ancho borde" id="pBorrar" style="color:var(--mal)">Borrar punto</button>
    <button class="ancho borde" id="pVolver">← Lista de puntos</button>`);
  cuerpo.querySelector('#pNav').onclick = () => { cerrarPanel(); navegarA(p); };
  cuerpo.querySelector('#pVer').onclick = () => { cerrarPanel(); S.seguir = false; irA(p.lat, p.lon, Math.max(vista.zoom, 17)); };
  cuerpo.querySelector('#pVolver').onclick = panelPuntos;
  cuerpo.querySelector('#pEditar').onclick = async () => {
    const r = await dialogo({ titulo: 'Cambiar nombre', html: 'Nombre actual: <b>' + esc(p.nombre) + '</b>',
      campo: { placeholder: p.nombre }, botones: [{ texto: 'Cancelar', valor: false, clase: 'borde' }, { texto: 'Siguiente', valor: true }] });
    if (!r.valor) return;
    const r2 = await dialogo({ titulo: 'Cambiar nota', html: 'Nota actual: ' + (esc(p.nota) || '<i>(vacía)</i>') + '<br><small>Dejá el campo vacío para no cambiarla.</small>',
      campo: { placeholder: 'Nueva nota' }, botones: [{ texto: 'Cancelar', valor: false, clase: 'borde' }, { texto: 'Guardar', valor: true }] });
    if (!r2.valor) return;
    if (r.texto.trim()) p.nombre = r.texto.trim().slice(0, 80);
    if (r2.texto.trim()) p.nota = r2.texto.trim();
    await guardar('puntos', p);
    pedirDibujo(); panelPunto(p); toast('Punto actualizado.');
  };
  cuerpo.querySelector('#pBorrar').onclick = async () => {
    if (!await confirmar('Borrar punto', `¿Borrar el punto <b>${esc(p.nombre)}</b>? No se puede deshacer (salvo que lo tengas en una copia de seguridad).`, 'Borrar', 'Cancelar', true)) return;
    await borrar('puntos', p.id);
    S.puntos = S.puntos.filter(x => x.id !== p.id);
    if (S.destino && S.destino.id === p.id) dejarDeNavegar();
    pedirDibujo(); panelPuntos();
  };
}

// Información de un elemento tocado en una capa.
export function panelElemento(capa, f) {
  const props = Object.entries(f.properties || {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object');
  const esPunto = f.geometry.type === 'Point';
  const [lon, lat] = esPunto ? f.geometry.coordinates : [null, null];
  const cuerpo = abrirPanel(capa.nombre, `
    ${props.length ? `<table class="coords">${props.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : '<div class="vacio">Este elemento no tiene atributos.</div>'}
    ${esPunto ? `<h4>Coordenadas</h4><table class="coords">${filasCoords(lat, lon)}</table>
      <button class="ancho" id="eNav">➤ Navegar hacia aquí</button>` : ''}`);
  if (esPunto) cuerpo.querySelector('#eNav').onclick = () => {
    const nombre = f.properties?.nombre || f.properties?.name || f.properties?.Name || 'Elemento de ' + capa.nombre;
    cerrarPanel(); navegarA({ id: 'elemento', nombre: String(nombre), lat, lon });
  };
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

/* =======================================================================
   CAPAS DEL PROYECTO (igual que la app Android)
   - Grupos plegables (📁), orden ▲▼, ver/ocultar, consultable 🔍/🔒.
   - Capas de URL guardadas en el celular con 🔄 para actualizarlas y
     🔗 para vincular una capa de archivo a una URL de origen.
   - Tabla de atributos, filtro por atributos 🔎, simbología por atributo 🎨, etiquetas 🏷, estilo
     (color, símbolo, grosor, relleno), proyección de origen 🌐, ir ◎.
   - Agregar: archivo del teléfono (GeoJSON, KML, KMZ, GPX, CSV, DXF, SHP,
     ZIP; GeoJSON grande con motor compacto), GeoJSON por enlace, WFS y WMS
     con "Escanear capas".
   ======================================================================= */
import { S, capaVisible, cambiarAjuste } from './estado.js';
import { guardar, borrar, nuevoId, borrarPrefijo } from './bd.js';
import { abrirPanel, cerrarPanel, toast, esc, confirmar, dialogo, cargando } from './ui.js';
import { leerArchivo, extension } from './importar.js';
import { escanearWFS, escanearWMS, descargarFuente, ErrorURL } from './capas-url.js';
import { pedirDibujo, encuadrar, cajaDe, olvidarCajas, borrarTeselasMemoria, PALETA, FONDOS } from './mapa.js';
import { importarGrande, GRANDE_UMBRAL, GRANDE_MAX } from './grandes.js';
import { tablaAtributos } from './consulta.js';
import { desdeWgs, haciaWgs, PROY } from './geodesia.js';
import { panelFiltro, filtroActivo, pasaFiltro } from './filtros.js';

const colorNuevo = () => PALETA[S.capas.length % PALETA.length];
const avisarCambio = () => document.dispatchEvent(new Event('datos-cambiados'));   // revisa el aviso de copia
const grupoPlegado = {};   // estado de los grupos mientras la app está abierta

async function ponerVisible(id, si) {
  const v = new Set(S.ajustes.capasVisibles || []);
  si ? v.add(id) : v.delete(id);
  await cambiarAjuste('capasVisibles', [...v]);
  pedirDibujo();
}
const guardarCapa = async c => { await guardar('capas', c); pedirDibujo(); };
// Agrega una capa nueva al final, visible, y la guarda.
async function sumarCapa(capa) {
  capa.orden = S.capas.length;
  capa.consultable = capa.consultable !== false;
  await guardar('capas', capa);
  S.capas.push(capa);
  await ponerVisible(capa.id, true);
  avisarCambio();
}

// Encuadra el mapa sobre una capa.
export function irACapa(c) {
  if (c.tipo === 'grande') { encuadrar(c.grande.bb); return; }
  const fc = c.geojson;
  if (!fc || !fc.features.length) { toast('Esta capa no tiene datos para ubicarla.'); return; }
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const k = cajaDe(f);
    b[0] = Math.min(b[0], k[0]); b[1] = Math.min(b[1], k[1]); b[2] = Math.max(b[2], k[2]); b[3] = Math.max(b[3], k[3]);
  }
  encuadrar(b);
}

/* --- Panel principal --- */
function filaCapa(c, i, total) {
  const vis = capaVisible(c.id);
  const vector = c.tipo === 'vector';
  const nElem = c.tipo === 'wms' ? 'WMS' : c.tipo === 'grande' ? `Grande · ${c.grande.nFeats} elem.` : `Vector · ${(c.geojson?.features || []).length} elem.`;
  const enLinea = !!c.fuente || c.tipo === 'wms';
  const sub = [nElem, c.consultable === false ? '🔒 solo vista' : '🔍 consultable',
    c.proyFuente && c.proyFuente !== 'geo' ? '🌐 ' + PROY[c.proyFuente].nom : '',
    c.etiqueta ? '🏷 ' + esc(c.etiqueta) : '',
    vector && filtroActivo(c) ? `🔎 filtro: ${c.geojson.features.filter(f => pasaFiltro(c, f)).length} de ${c.geojson.features.length}` : '',
    c.fuenteFecha ? 'desde ' + new Date(c.fuenteFecha).toLocaleDateString('es-CR') : ''].filter(Boolean).join(' · ');
  const b = (acc, txt, titulo, clase = '') => `<button class="mini ${clase}" data-acc="${acc}" title="${titulo}" aria-label="${titulo}">${txt}</button>`;
  return `<div class="filaCapa" data-id="${c.id}">
    <div class="linea1">
      <div class="orden">${b('subir', '▲', 'Subir', i === 0 ? 'off' : 'borde')}${b('bajar', '▼', 'Bajar', i === total - 1 ? 'off' : 'borde')}</div>
      <span class="color" style="background:${c.tipo === 'wms' ? 'linear-gradient(135deg,#5DA9E9,#6FCF6F)' : esc(c.color)}"></span>
      <div class="cuerpo-item"><div class="t">${esc(c.nombre)}${enLinea ? ' <span class="nube">☁</span>' : ''}</div><div class="s">${sub}</div></div>
      ${b('ver', vis ? 'Ver' : 'off', 'Mostrar u ocultar', vis ? '' : 'borde')}
    </div>
    <div class="linea2">
      ${b('consultar', c.consultable === false ? '🔒' : '🔍', 'Consultable al tocar', 'borde')}
      ${c.fuente ? b('actualizar', '🔄', 'Actualizar desde el origen', 'borde') : ''}
      ${vector && !c.fuente ? b('vincular', '🔗', 'Vincular a una URL de origen', 'borde') : ''}
      ${b('grupo', '📁', 'Cambiar grupo', 'borde')}
      ${vector ? b('tabla', 'Tabla', 'Tabla de atributos', 'borde') + b('filtro', '🔎 Filtro', 'Filtrar por atributos', filtroActivo(c) ? '' : 'borde') + b('simbologia', '🎨', 'Simbología por atributo', 'borde') + b('etiqueta', '🏷', 'Etiquetas', c.etiqueta ? '' : 'borde') : ''}
      ${c.tipo !== 'wms' ? b('estilo', 'Estilo', 'Color, símbolo y grosor', 'borde') : ''}
      ${vector ? b('proyeccion', '🌐', 'Proyección de origen', 'borde') : ''}
      ${c.tipo !== 'wms' ? b('ir', '◎', 'Ir a la capa', 'borde') : ''}
      ${b('borrar', '×', 'Borrar capa', 'peligro')}
    </div>
  </div>`;
}

export function panelCapas() {
  // Agrupar respetando el orden.
  const grupos = new Map();
  for (const c of S.capas) { const g = c.grupo || 'Sin grupo'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(c); }
  let html = '';
  if (!S.capas.length) html = '<div class="vacio">Sin capas todavía. Agregá una abajo.<br>Tocá un elemento en el mapa para ver sus atributos.</div>';
  for (const [nom, lista] of grupos) {
    const plegado = !!grupoPlegado[nom];
    html += `<div class="grupo">
      <div class="grupoCab"><span data-plegar="${esc(nom)}">${plegado ? '▸' : '▾'} 📁 ${esc(nom)} <span class="s">· ${lista.length}</span></span>
        ${nom !== 'Sin grupo' ? `<button class="mini borde" data-renombrar="${esc(nom)}" aria-label="Renombrar grupo">✎</button>` : ''}</div>
      ${plegado ? '' : lista.map(c => filaCapa(c, S.capas.indexOf(c), S.capas.length)).join('')}
    </div>`;
  }
  const fondos = Object.entries(FONDOS).map(([k, f]) => `<button class="mini ${S.ajustes.fondo === k ? '' : 'borde'}" data-fondo="${k}">${f.nom}</button>`).join(' ');
  const cuerpo = abrirPanel('Capas del proyecto', `
    <label>Fondo del mapa</label>
    <div class="fila2">${fondos}</div>
    ${html}
    <label>Agregar capa</label>
    <select id="capTipo">
      <option value="archivo">Archivo del teléfono (GeoJSON · KML · KMZ · GPX · CSV · DXF · SHP · ZIP)</option>
      <option value="geojson">GeoJSON (enlace directo)</option>
      <option value="wfs">WFS (servicio) — escanear capas</option>
      <option value="wms">WMS (servicio) — escanear capas</option>
    </select>
    <div id="capForm"></div>
    <div class="nota">Pegá el enlace del <b>servicio</b> WMS/WFS (el mismo que usás en QGIS) y tocá <b>Escanear</b>.
    <b>Shapefile</b>: subí el <b>.zip</b> completo (.shp, .dbf y .prj). <b>Proyección automática</b>: si la capa viene en CRTM05
    o Lambert, la app la detecta y la convierte; si se equivoca, corregila con 🌐. <b>GeoJSON grande</b> (más de 8 MB): se carga
    con un motor compacto (sin etiquetas ni tabla completa). Las capas de enlace o WFS quedan guardadas en el celular: se ven
    sin internet y se actualizan con 🔄. En Android también podés <b>compartir</b> un archivo a esta app desde otra app.</div>`);

  cuerpo.querySelectorAll('[data-fondo]').forEach(b => b.onclick = async () => { await cambiarAjuste('fondo', b.dataset.fondo); pedirDibujo(); panelCapas(); });
  cuerpo.querySelectorAll('[data-plegar]').forEach(el => el.onclick = () => { grupoPlegado[el.dataset.plegar] = !grupoPlegado[el.dataset.plegar]; panelCapas(); });
  cuerpo.querySelectorAll('[data-renombrar]').forEach(b => b.onclick = () => renombrarGrupo(b.dataset.renombrar));
  cuerpo.querySelectorAll('.filaCapa').forEach(fila => {
    const c = S.capas.find(x => x.id === fila.dataset.id);
    fila.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => accion(c, b.dataset.acc));
  });
  const sel = cuerpo.querySelector('#capTipo');
  sel.onchange = () => formularioAgregar(sel.value);
  formularioAgregar(sel.value);
}

async function accion(c, acc) {
  switch (acc) {
    case 'ver': await ponerVisible(c.id, !capaVisible(c.id)); panelCapas(); break;
    case 'consultar': c.consultable = c.consultable === false; await guardarCapa(c); panelCapas(); break;
    case 'subir': case 'bajar': await moverCapa(c, acc === 'subir' ? -1 : 1); break;
    case 'actualizar': await actualizarCapa(c); panelCapas(); break;
    case 'vincular': await vincularCapa(c); break;
    case 'grupo': panelGrupo(c); break;
    case 'tabla': tablaAtributos(c); break;
    case 'simbologia': panelSimbologia(c); break;
    case 'filtro': panelFiltro(c, panelCapas, sumarCapa); break;
    case 'etiqueta': panelEtiqueta(c); break;
    case 'estilo': panelEstilo(c); break;
    case 'proyeccion': panelProyeccion(c); break;
    case 'ir': cerrarPanel(); irACapa(c); break;
    case 'borrar': await borrarCapa(c); break;
  }
}

async function moverCapa(c, dir) {
  const i = S.capas.indexOf(c), j = i + dir;
  if (j < 0 || j >= S.capas.length) return;
  [S.capas[i], S.capas[j]] = [S.capas[j], S.capas[i]];
  S.capas.forEach((x, k) => { x.orden = k; });
  await guardar('capas', S.capas[i]); await guardar('capas', S.capas[j]);
  pedirDibujo(); panelCapas();
}
async function borrarCapa(c) {
  const si = await confirmar('Borrar capa', `¿Borrar la capa <b>${esc(c.nombre)}</b> del celular?` +
    (c.origen === 'archivo' ? '<br>Si no tenés el archivo original o una copia de seguridad, no se puede recuperar.' : ''), 'Borrar', 'Cancelar', true);
  if (!si) return;
  await borrar('capas', c.id);
  if (c.tipo === 'grande') await borrarPrefijo('bigprops', c.id + ':');
  if (c.tipo === 'wms') { await borrarPrefijo('teselas', 'wms_' + c.id + '/'); borrarTeselasMemoria('wms_' + c.id + '/'); }
  S.capas = S.capas.filter(x => x.id !== c.id);
  await ponerVisible(c.id, false);
  panelCapas();
}

/* --- Grupos --- */
function panelGrupo(c) {
  const existentes = [...new Set(S.capas.map(x => x.grupo).filter(Boolean))].sort();
  const cuerpo = abrirPanel(`Grupo de "${c.nombre}"`, `
    <label>Elegí un grupo existente</label>
    <select id="gSel"><option value="">— Sin grupo —</option>
      ${existentes.map(g => `<option value="${esc(g)}" ${g === c.grupo ? 'selected' : ''}>${esc(g)}</option>`).join('')}
      <option value="__nuevo__">➕ Crear nuevo grupo…</option></select>
    <div id="gNuevo" hidden><label>Nombre del nuevo grupo</label><input id="gNom" placeholder="Ej. Fincas, Hidrografía, Casos"></div>
    <button class="ancho" id="gOk">Guardar</button><button class="ancho borde" id="gNo">Cancelar</button>`);
  const sel = cuerpo.querySelector('#gSel');
  sel.onchange = () => { cuerpo.querySelector('#gNuevo').hidden = sel.value !== '__nuevo__'; };
  cuerpo.querySelector('#gNo').onclick = panelCapas;
  cuerpo.querySelector('#gOk').onclick = async () => {
    let g = sel.value;
    if (g === '__nuevo__') { g = cuerpo.querySelector('#gNom').value.trim(); if (!g) { toast('Escribí el nombre del grupo.'); return; } }
    c.grupo = g || null;
    await guardarCapa(c);
    toast(g ? `Movida a "${g}".` : 'Sacada del grupo.');
    panelCapas();
  };
}
async function renombrarGrupo(actual) {
  const r = await dialogo({ titulo: 'Renombrar grupo', html: `Grupo actual: <b>${esc(actual)}</b><br><small>Dejalo vacío para deshacer el grupo (las capas quedan sueltas).</small>`,
    campo: { placeholder: actual }, botones: [{ texto: 'Cancelar', valor: false, clase: 'borde' }, { texto: 'Guardar', valor: true }] });
  if (!r.valor) return;
  const n = r.texto.trim();
  for (const c of S.capas) if ((c.grupo || '') === actual) { c.grupo = n || null; await guardar('capas', c); }
  if (n) grupoPlegado[n] = grupoPlegado[actual];
  delete grupoPlegado[actual];
  panelCapas();
}

/* --- Actualizar y vincular --- */
async function actualizarCapa(c) {
  if (!c.fuente) { toast('Esta capa no tiene origen en internet.'); return; }
  if (!navigator.onLine) { toast('Sin internet. Se usa la copia que ya tenés guardada.'); return; }
  cargando(`Actualizando "${c.nombre}"…`);
  try {
    const r = await descargarFuente(c.fuente);
    if (c.geojson) olvidarCajas(c.geojson);
    c.geojson = r.fc; c.proyFuente = r.proyFuente; c.fuenteFecha = Date.now();
    await guardarCapa(c);
    toast(`"${c.nombre}" actualizada: ${r.fc.features.length} elementos.`);
  } catch (e) {
    toast('No se pudo actualizar: ' + (e instanceof ErrorURL ? e.message : (e.message || e)) + ' Se mantiene la copia guardada.', 8000);
  } finally { cargando(null); }
}
async function vincularCapa(c) {
  const r = await dialogo({ titulo: 'Vincular a una URL', html: 'Dirección del GeoJSON de origen. Después podés actualizar la capa con 🔄.',
    campo: { placeholder: 'https://…/capa.geojson' }, botones: [{ texto: 'Cancelar', valor: false, clase: 'borde' }, { texto: 'Vincular', valor: true }] });
  if (!r.valor) return;
  const url = r.texto.trim();
  if (!/^https?:\/\//i.test(url)) { toast('La dirección debe empezar con https://'); return; }
  c.fuente = { tipo: 'geojson', url, capaServicio: null };
  c.fuenteFecha = c.fuenteFecha || Date.now();
  await guardarCapa(c);
  toast('Capa vinculada. Usá 🔄 para actualizarla.');
  panelCapas();
}

/* --- Estilo (color, símbolo, grosor, relleno) --- */
function panelEstilo(c) {
  const simbolos = [['circulo', '●'], ['cuadro', '■'], ['triangulo', '▲'], ['rombo', '◆'], ['cruz', '＋'], ['aspa', '✕']];
  const muestras = ['#E0A458', '#4FD1C5', '#C75146', '#6FCF6F', '#B07CC6', '#E06AA0', '#F2C94C', '#2D9CDB', '#EB5757', '#27AE60', '#DCE6E4', '#8899AA'];
  const op = c.opacidad != null ? c.opacidad : 0.2;
  const actual = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#E0A458';
  const cuerpo = abrirPanel('Estilo · ' + c.nombre, `
    <label>Color</label>
    <div class="muestras">${muestras.map(h => `<button data-col="${h}" style="background:${h};border-color:${(c.color || '').toLowerCase() === h.toLowerCase() ? '#fff' : 'transparent'}" aria-label="Color ${h}"></button>`).join('')}</div>
    <label>Color personalizado</label><input type="color" id="eCol" value="${actual}">
    <label>Símbolo de punto</label>
    <div class="fila2">${simbolos.map(([k, g]) => `<button class="mini ${(c.punto || 'circulo') === k ? '' : 'borde'}" data-sim="${k}">${g}</button>`).join('')}</div>
    <label>Tamaño de punto: <span id="eTamV">${c.tam || 5}</span> px</label><input type="range" id="eTam" min="3" max="12" value="${c.tam || 5}">
    <label>Grosor de línea/borde: <span id="eGrV">${c.grosor || 2}</span> px</label><input type="range" id="eGr" min="1" max="6" value="${c.grosor || 2}">
    <label>Relleno de polígonos: <span id="eOpV">${Math.round(op * 100)}</span>%</label><input type="range" id="eOp" min="0" max="100" step="5" value="${Math.round(op * 100)}">
    <div class="nota">0% = solo el contorno; 100% = relleno sólido. Si la capa tiene simbología por atributo, el color sale de las categorías.</div>
    <button class="ancho borde" id="eVolver">← Volver a capas</button>`);
  cuerpo.querySelectorAll('[data-col]').forEach(b => b.onclick = async () => { c.color = b.dataset.col; await guardarCapa(c); panelEstilo(c); });
  cuerpo.querySelector('#eCol').onchange = async e => { c.color = e.target.value; await guardarCapa(c); panelEstilo(c); };
  cuerpo.querySelectorAll('[data-sim]').forEach(b => b.onclick = async () => { c.punto = b.dataset.sim; await guardarCapa(c); panelEstilo(c); });
  for (const [id, campo, div] of [['eTam', 'tam', 1], ['eGr', 'grosor', 1], ['eOp', 'opacidad', 100]]) {
    const r = cuerpo.querySelector('#' + id);
    r.oninput = () => { cuerpo.querySelector('#' + id + 'V').textContent = r.value; };
    r.onchange = async () => { c[campo] = +r.value / div; await guardarCapa(c); };
  }
  cuerpo.querySelector('#eVolver').onclick = panelCapas;
}

/* --- Campos, etiquetas y simbología --- */
function camposDe(c) {
  const k = [];
  for (const f of c.geojson?.features || []) { for (const x of Object.keys(f.properties || {})) if (!k.includes(x)) k.push(x); if (k.length >= 40) break; }
  return k;
}
function panelEtiqueta(c) {
  const campos = camposDe(c), muestra = c.geojson.features[0]?.properties || {};
  const cuerpo = abrirPanel('Etiquetar · ' + c.nombre, `
    <div class="nota ok">Elegí un campo y su valor se dibuja como texto junto a cada elemento en el mapa.</div>
    <button class="ancho ${c.etiqueta ? 'borde' : ''}" data-et="">Sin etiqueta</button>
    ${campos.length ? campos.map(k => `<button class="ancho ${c.etiqueta === k ? '' : 'borde'} izq" data-et="${esc(k)}">${esc(k)} <span class="s">· ej: ${esc(String(muestra[k] ?? '—').slice(0, 26))}</span></button>`).join('')
      : '<div class="vacio">Esta capa no tiene atributos para etiquetar.</div>'}`);
  cuerpo.querySelectorAll('[data-et]').forEach(b => b.onclick = async () => {
    c.etiqueta = b.dataset.et || null; await guardarCapa(c);
    toast(c.etiqueta ? 'Etiquetando por: ' + c.etiqueta : 'Etiquetas apagadas.'); panelCapas();
  });
}
function valoresDistintos(c, campo) {
  const v = [];
  for (const f of c.geojson.features) { const x = String((f.properties || {})[campo]); if (!v.includes(x)) v.push(x); if (v.length >= 60) break; }
  return v;
}
function panelSimbologia(c) {
  const campos = camposDe(c);
  const cuerpo = abrirPanel('Simbología · ' + c.nombre, `
    <label>Modo</label>
    <div class="fila2"><button class="mini ${c.simbologia?.campo ? 'borde' : ''}" id="smUnico">Color único</button>
    <button class="mini ${c.simbologia?.campo ? '' : 'borde'}" id="smCat">Por atributo</button></div>
    <div id="smCuerpo"></div>`);
  const categorias = campo => { const o = {}; valoresDistintos(c, campo).forEach((v, i) => { o[v] = PALETA[i % PALETA.length]; }); return o; };
  const pintar = () => {
    const caja = cuerpo.querySelector('#smCuerpo');
    if (!c.simbologia?.campo) {
      caja.innerHTML = `<label>Color de la capa</label><input type="color" id="smColor" value="${/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#E0A458'}"><button class="ancho" id="smGuardar">Guardar</button>`;
      caja.querySelector('#smColor').oninput = e => { c.color = e.target.value; pedirDibujo(); };
      caja.querySelector('#smGuardar').onclick = async () => { delete c.simbologia; await guardarCapa(c); toast('Simbología: color único.'); panelCapas(); };
      return;
    }
    const sm = c.simbologia; sm.ocultas = sm.ocultas || {};
    caja.innerHTML = `<label>Atributo</label>
      <select id="smCampo">${campos.map(k => `<option value="${esc(k)}" ${k === sm.campo ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <div class="fila2" style="margin-top:6px"><button class="mini borde" id="smTodo">Mostrar todo</button><button class="mini borde" id="smNada">Ocultar todo</button></div>
      <div id="smCats"></div>
      <button class="ancho" id="smGuardar">Guardar</button>
      <div class="nota">Tocá 👁 para mostrar u ocultar los elementos de esa categoría. Los ocultos tampoco responden al toque.</div>`;
    const cats = () => {
      const el = caja.querySelector('#smCats');
      el.innerHTML = Object.keys(sm.categorias || {}).map(v => `<div class="catFila ${sm.ocultas[v] ? 'apagada' : ''}">
        <input type="color" value="${sm.categorias[v]}" data-cat="${esc(v)}"><div class="cuerpo-item s">${esc(v)}</div>
        <button class="mini ${sm.ocultas[v] ? 'borde' : ''}" data-vis="${esc(v)}">${sm.ocultas[v] ? '🚫' : '👁'}</button></div>`).join('');
      el.querySelectorAll('[data-cat]').forEach(i => i.oninput = e => { sm.categorias[i.dataset.cat] = e.target.value; pedirDibujo(); });
      el.querySelectorAll('[data-vis]').forEach(b => b.onclick = () => { const v = b.dataset.vis; if (sm.ocultas[v]) delete sm.ocultas[v]; else sm.ocultas[v] = true; cats(); pedirDibujo(); });
    };
    caja.querySelector('#smTodo').onclick = () => { sm.ocultas = {}; cats(); pedirDibujo(); };
    caja.querySelector('#smNada').onclick = () => { sm.ocultas = {}; Object.keys(sm.categorias).forEach(v => { sm.ocultas[v] = true; }); cats(); pedirDibujo(); };
    caja.querySelector('#smCampo').onchange = e => { sm.campo = e.target.value; sm.categorias = categorias(sm.campo); sm.ocultas = {}; cats(); pedirDibujo(); };
    caja.querySelector('#smGuardar').onclick = async () => { await guardarCapa(c); toast(`Simbología por "${sm.campo}" guardada.`); panelCapas(); };
    cats();
  };
  cuerpo.querySelector('#smUnico').onclick = () => { delete c.simbologia; pedirDibujo(); pintar(); };
  cuerpo.querySelector('#smCat').onclick = () => {
    if (!campos.length) { toast('Esta capa no tiene atributos para clasificar.'); return; }
    const campo = c.simbologia?.campo || campos[0];
    c.simbologia = { campo, categorias: categorias(campo), defecto: c.color || '#8899AA', ocultas: {} };
    pedirDibujo(); pintar();
  };
  pintar();
}

/* --- Proyección de origen (🌐): reinterpretar las coordenadas --- */
function panelProyeccion(c) {
  const actual = c.proyFuente || 'geo';
  const ops = [['geo', 'WGS84 · geográficas (lon/lat)'], ['crtm05', 'CRTM05 · EPSG:5367'], ['ln', 'Lambert Norte · EPSG:5456'], ['ls', 'Lambert Sur · EPSG:5457']];
  const cuerpo = abrirPanel('Proyección · ' + c.nombre, `
    <div class="nota ok">Elegí en qué proyección venían las coordenadas originales. La app las convierte y reencuadra el mapa. Por defecto se detecta sola.</div>
    ${ops.map(([k, t]) => `<button class="ancho izq ${actual === k ? '' : 'borde'}" data-pj="${k}">${t}${actual === k ? '  ✓' : ''}</button>`).join('')}`);
  cuerpo.querySelectorAll('[data-pj]').forEach(b => b.onclick = async () => {
    const nuevo = b.dataset.pj;
    if (nuevo === actual) { panelCapas(); return; }
    const rec = co => {
      if (typeof co[0] === 'number') {
        // Recuperar la coordenada cruda desde lat/lon y aplicar la nueva interpretación.
        const crudo = actual === 'geo' ? [co[0], co[1]] : (p => [p.e, p.n])(desdeWgs(co[1], co[0], actual));
        if (nuevo === 'geo') { co[0] = crudo[0]; co[1] = crudo[1]; }
        else { const w = haciaWgs(crudo[0], crudo[1], nuevo); co[0] = w.lon; co[1] = w.lat; }
      } else for (const x of co) rec(x);
    };
    olvidarCajas(c.geojson);
    for (const f of c.geojson.features) {
      const g = f.geometry; if (!g) continue;
      if (g.type === 'GeometryCollection') (g.geometries || []).forEach(gg => gg.coordinates && rec(gg.coordinates)); else rec(g.coordinates);
    }
    c.proyFuente = nuevo;
    await guardarCapa(c);
    cerrarPanel(); irACapa(c);
    toast('Proyección: ' + PROY[nuevo].largo);
  });
}

/* --- Agregar capas --- */
function formularioAgregar(tipo) {
  const caja = document.getElementById('capForm');
  if (tipo === 'archivo') {
    caja.innerHTML = `<label>Sistema de coordenadas del archivo</label>
      <select id="aSis"><option value="auto">Automático (recomendado)</option><option value="crtm05">CRTM05 (EPSG:5367)</option>
      <option value="ln">Lambert Norte (EPSG:5456)</option><option value="ls">Lambert Sur (EPSG:5457)</option><option value="geo">Latitud/Longitud WGS84</option></select>
      <input type="file" id="aArchivo" multiple>
      <div class="nota">En iPhone el archivo se elige desde la app <b>Archivos</b> (iCloud Drive, "En mi iPhone", Drive, correo guardado…).</div>
      <div id="aMsg"></div>`;
    caja.querySelector('#aArchivo').onchange = async e => {
      const archivos = [...e.target.files]; if (!archivos.length) return;
      await importarArchivos(archivos, caja.querySelector('#aSis').value, caja.querySelector('#aMsg'));
    };
    return;
  }
  if (tipo === 'geojson') {
    caja.innerHTML = `<label>Nombre</label><input id="uNom" placeholder="Fincas">
      <label>URL que devuelve GeoJSON</label><input id="uUrl" type="url" inputmode="url" placeholder="https://…/capa.geojson" autocomplete="off" autocapitalize="off">
      <button class="ancho" id="uAdd">Descargar y agregar</button><div id="uMsg"></div>`;
    caja.querySelector('#uAdd').onclick = () => agregarDeURL({ tipo: 'geojson', url: caja.querySelector('#uUrl').value.trim() }, caja.querySelector('#uNom').value.trim());
    return;
  }
  caja.innerHTML = `<label>URL del servicio ${tipo.toUpperCase()}</label><input id="uUrl" type="url" inputmode="url" placeholder="https://…/wms o /ows" autocomplete="off" autocapitalize="off">
    <button class="ancho borde" id="uEscanear">Escanear capas</button><div id="uLista"></div><div id="uMsg"></div>`;
  caja.querySelector('#uEscanear').onclick = () => escanear(tipo, caja);
}
const mensaje = (el, html, clase) => { if (el) el.innerHTML = html ? `<div class="nota ${clase || ''}">${html}</div>` : ''; };

// Importa uno o varios archivos (desde el panel, "Compartir" u "Abrir con").
export async function importarArchivos(archivos, sistema = 'auto', msg = null) {
  let ok = 0, ultima = null;
  for (const f of archivos) {
    const ext = extension(f.name);
    try {
      if ((ext === 'geojson' || ext === 'json') && f.size > GRANDE_UMBRAL) {
        if (f.size > GRANDE_MAX) throw new Error('Archivo enorme (más de 400 MB). Dividilo por zona.');
        if (!f.stream || typeof TextDecoderStream === 'undefined') throw new Error('Este navegador no puede leer archivos tan grandes por partes. Actualizá Safari/Chrome o dividí el archivo.');
        const id = nuevoId();
        cargando('Leyendo capa grande…');
        const r = await importarGrande(id, f.stream(), n => cargando(`Leyendo capa grande… ${n} elementos`));
        ultima = { id, nombre: f.name.replace(/\.[^.]+$/, '').slice(0, 60), tipo: 'grande', origen: 'archivo', formato: ext,
          color: colorNuevo(), fecha: new Date().toISOString(), proyFuente: r.proyFuente, grande: r.grande };
        await sumarCapa(ultima);
        toast(`Capa grande "${ultima.nombre}": ${r.grande.nFeats} elementos` + (r.proyFuente !== 'geo' ? (r.reconocida ? ` · ${PROY[r.proyFuente].nom}` : ' · asumí CRTM05') : ''), 6000);
      } else {
        if (f.size > 45 * 1048576) throw new Error(`Capa demasiado pesada (${Math.round(f.size / 1048576)} MB). Máximo ~45 MB para este formato: simplificala en mapshaper.org o QGIS, o dividila por zona.`);
        cargando('Leyendo ' + f.name + '…');
        const { fc, nombre, aviso, proyFuente } = await leerArchivo(f, sistema);
        ultima = { id: nuevoId(), nombre: nombre.slice(0, 60), tipo: 'vector', origen: 'archivo', formato: ext, color: colorNuevo(),
          fecha: new Date().toISOString(), geojson: fc, proyFuente };
        await sumarCapa(ultima);
        toast(`Capa "${ultima.nombre}": ${fc.features.length} elemento(s). ${aviso || ''}`, aviso ? 7000 : 3500);
      }
      ok++;
    } catch (e) {
      const t = `No se pudo cargar ${esc(f.name)}: ${esc(e.message || e)}`;
      if (msg) mensaje(msg, t, 'mal'); else toast(t.replace(/<[^>]+>/g, ''), 8000);
    } finally { cargando(null); }
  }
  if (ok) { cerrarPanel(); if (ultima) irACapa(ultima); }
  return ok;
}

async function escanear(tipo, caja) {
  const url = caja.querySelector('#uUrl').value.trim();
  const msg = caja.querySelector('#uMsg'), lista = caja.querySelector('#uLista');
  if (!url) { mensaje(msg, 'Pegá la URL del servicio.', 'aviso'); return; }
  cargando('Escaneando ' + tipo.toUpperCase() + '…');
  try {
    const r = tipo === 'wfs' ? await escanearWFS(url) : await escanearWMS(url);
    if (!r.capas.length) mensaje(msg, `No se encontraron capas. ¿La URL es del servicio ${tipo.toUpperCase()}? Podés escribir el nombre de la capa abajo.`, 'aviso');
    else mensaje(msg, `Encontré ${r.capas.length} capa(s).`, 'ok');
    lista.innerHTML = `${r.capas.length ? `<label>Capas disponibles (${r.capas.length})</label>
      <select id="uSel">${r.capas.map(c => `<option value="${esc(c.name)}">${esc(c.title.slice(0, 60))}</option>`).join('')}</select>` : ''}
      <label>o nombre exacto de la capa</label><input id="uManual" autocomplete="off" autocapitalize="off">
      <button class="ancho" id="uAddSel">Agregar capa seleccionada</button>`;
    lista.querySelector('#uAddSel').onclick = () => agregarServicio(tipo, url, lista, r.version);
  } catch (e) {
    mensaje(msg, 'No se pudo escanear: ' + esc(e instanceof ErrorURL ? e.message : (e.message || e)), 'mal');
    lista.innerHTML = `<label>Si sabés el nombre exacto de la capa, escribilo</label><input id="uManual" autocomplete="off" autocapitalize="off"><button class="ancho" id="uAddSel">Agregar</button>`;
    lista.querySelector('#uAddSel').onclick = () => agregarServicio(tipo, url, lista, '1.3.0');
  } finally { cargando(null); }
}
async function agregarServicio(tipo, url, lista, version) {
  const sel = lista.querySelector('#uSel'), manual = lista.querySelector('#uManual').value.trim();
  const capaServicio = manual || (sel ? sel.value : '');
  if (!capaServicio) { toast('Elegí o escribí la capa.'); return; }
  const titulo = manual || (sel ? sel.selectedOptions[0].textContent : capaServicio);
  if (tipo === 'wms') {
    await sumarCapa({ id: nuevoId(), nombre: titulo.slice(0, 60), tipo: 'wms', origen: 'url', url, capaServicio, version: version || '1.3.0',
      color: '#8899AA', fecha: new Date().toISOString() });
    cerrarPanel();
    toast(`Capa WMS "${titulo}" agregada. Si no aparece nada, puede que el servidor no cubra esta zona.`, 6000);
    return;
  }
  await agregarDeURL({ tipo: 'wfs', url, capaServicio }, titulo);
}
async function agregarDeURL(fuente, nombre) {
  if (!fuente.url) { toast('Pegá la URL.'); return; }
  cargando('Descargando capa…');
  try {
    const r = await descargarFuente(fuente);
    const capa = { id: nuevoId(), nombre: (nombre || fuente.capaServicio || 'Capa').slice(0, 60), tipo: 'vector', origen: 'url', fuente,
      fuenteFecha: Date.now(), color: colorNuevo(), fecha: new Date().toISOString(), geojson: r.fc, proyFuente: r.proyFuente };
    await sumarCapa(capa);
    cerrarPanel(); irACapa(capa);
    toast(`Capa "${capa.nombre}": ${r.fc.features.length} elementos. Quedó guardada en el celular.`);
  } catch (e) {
    const t = 'No se agregó. ' + (e instanceof ErrorURL ? e.message : 'Error inesperado: ' + (e.message || e));
    const msg = document.getElementById('uMsg');
    if (msg) mensaje(msg, esc(t), 'mal'); else toast(t, 8000);
  } finally { cargando(null); }
}

// Capas de URL sin contenido guardado (por ejemplo, de copias viejas): se descargan si hay internet.
export async function completarCapasURL() {
  for (const c of S.capas) {
    if (c.tipo !== 'vector' || c.geojson || !c.fuente || !navigator.onLine) continue;
    try { const r = await descargarFuente(c.fuente); c.geojson = r.fc; c.proyFuente = r.proyFuente; c.fuenteFecha = Date.now(); await guardar('capas', c); pedirDibujo(); }
    catch (e) { /* se reintenta la próxima vez */ }
  }
}

/* =======================================================================
   PANEL DE CAPAS
   Lista de capas, mostrar/ocultar, borrar, y agregar desde archivo o URL.
   ======================================================================= */
import { S, capaVisible, cambiarAjuste } from './estado.js';
import { guardar, borrar, nuevoId } from './bd.js';
import { abrirPanel, cerrarPanel, toast, esc, confirmar } from './ui.js';
import { leerArchivo, TAMANO_AVISO } from './importar.js';
import { escanearWFS, escanearWMS, cargarCapaURL, descargarCapaURL, ErrorURL } from './capas-url.js';
import { pedirDibujo, encuadrar, cajaGeom, FONDOS } from './mapa.js';

const COLORES = ['#E0A458', '#4FD1C5', '#E06AA0', '#6FCF6F', '#B07CC6', '#5DA9E9', '#F2C94C', '#C75146'];
const colorNuevo = () => COLORES[S.capas.length % COLORES.length];
const NOMBRE_TIPO = { geojson: 'GeoJSON', wfs: 'WFS', wms: 'WMS' };

async function ponerVisible(id, si) {
  const v = new Set(S.ajustes.capasVisibles || []);
  si ? v.add(id) : v.delete(id);
  await cambiarAjuste('capasVisibles', [...v]);
  pedirDibujo();
}

// Encuadra el mapa sobre una capa vectorial.
function irACapa(capa) {
  const fc = capa.origen === 'archivo' ? capa.geojson : S.datosURL.get(capa.id);
  if (!fc || !fc.features.length) { toast('Esta capa no tiene datos cargados para ubicarla.'); return; }
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of fc.features) {
    const c = cajaGeom(f.geometry);
    b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[2]); b[3] = Math.max(b[3], c[3]);
  }
  encuadrar(b);
}

// Texto debajo del nombre de cada capa.
function detalleCapa(c) {
  if (c.origen === 'archivo') return `Archivo ${esc((c.formato || '').toUpperCase())} · ${c.geojson.features.length} elemento(s) · guardada en el celular`;
  let estado = '';
  if (c.tipo === 'wms') estado = navigator.onLine ? 'imagen del servidor' : 'sin conexión: no se ve';
  else {
    const e = S.estadoURL.get(c.id);
    estado = e === 'ok' ? `${(S.datosURL.get(c.id)?.features.length) ?? 0} elemento(s)`
      : e === 'cargando' ? 'cargando…'
      : !navigator.onLine ? 'sin conexión: no se ve'
      : e ? '<span style="color:var(--mal)">no cargó (tocá ⓘ)</span>' : 'sin cargar';
  }
  return `URL ${NOMBRE_TIPO[c.tipo]} · ${estado}`;
}

export function panelCapas() {
  const filas = S.capas.map(c => `
    <li data-id="${c.id}">
      <input type="checkbox" class="vis" ${capaVisible(c.id) ? 'checked' : ''} aria-label="Mostrar capa">
      <span class="color" style="background:${c.tipo === 'wms' ? 'linear-gradient(135deg,#5DA9E9,#6FCF6F)' : esc(c.color)}"></span>
      <div class="cuerpo-item"><div class="t">${esc(c.nombre)}</div><div class="s">${detalleCapa(c)}</div></div>
      ${c.origen === 'url' && c.tipo !== 'wms' && S.estadoURL.get(c.id) && S.estadoURL.get(c.id) !== 'ok' && S.estadoURL.get(c.id) !== 'cargando' ? '<button class="mini borde info">ⓘ</button>' : ''}
      ${c.tipo !== 'wms' ? '<button class="mini borde ir" aria-label="Ir a la capa">⌖</button>' : ''}
      <button class="mini borde quitar" aria-label="Borrar capa">✕</button>
    </li>`).join('');
  const fondos = Object.entries(FONDOS).map(([k, f]) =>
    `<button class="mini ${S.ajustes.fondo === k ? '' : 'borde'}" data-fondo="${k}">${f.nom}</button>`).join(' ');

  const cuerpo = abrirPanel('Capas', `
    <label>Fondo del mapa (necesita internet)</label>
    <div class="fila2">${fondos}</div>
    <h4>Mis capas</h4>
    ${S.capas.length ? `<ul class="lista">${filas}</ul>` : '<div class="vacio">Todavía no hay capas.</div>'}
    <button class="ancho" id="cArchivo">＋ Agregar desde archivo</button>
    <button class="ancho borde" id="cUrl">＋ Agregar desde URL</button>
    <div class="nota">Las capas de <b>archivo</b> se guardan completas en el celular y se ven sin internet.
    Las de <b>URL</b> solo guardan la dirección: necesitan internet para verse.</div>`);

  cuerpo.querySelectorAll('[data-fondo]').forEach(b => b.onclick = async () => {
    await cambiarAjuste('fondo', b.dataset.fondo); pedirDibujo(); panelCapas();
  });
  cuerpo.querySelectorAll('li[data-id]').forEach(li => {
    const capa = S.capas.find(c => c.id === li.dataset.id);
    li.querySelector('.vis').onchange = e => {
      ponerVisible(capa.id, e.target.checked);
      if (e.target.checked && capa.origen === 'url' && !S.datosURL.has(capa.id)) cargarCapaURL(capa, () => { pedirDibujo(); if (!document.getElementById('panel').hidden) panelCapas(); });
    };
    const ir = li.querySelector('.ir'); if (ir) ir.onclick = () => { cerrarPanel(); irACapa(capa); };
    const info = li.querySelector('.info'); if (info) info.onclick = () => confirmar('Por qué no cargó', esc(S.estadoURL.get(capa.id)) + `<br><br><small>${esc(capa.url)}</small>`, 'Reintentar', 'Cerrar')
      .then(si => si && cargarCapaURL(capa, () => { pedirDibujo(); panelCapas(); }));
    li.querySelector('.quitar').onclick = async () => {
      const si = await confirmar('Borrar capa', `¿Borrar la capa <b>${esc(capa.nombre)}</b> del celular?` +
        (capa.origen === 'archivo' ? '<br>Si no tenés el archivo original o una copia de seguridad, no se puede recuperar.' : ''), 'Borrar', 'Cancelar', true);
      if (!si) return;
      await borrar('capas', capa.id);
      S.capas = S.capas.filter(c => c.id !== capa.id);
      S.datosURL.delete(capa.id); S.estadoURL.delete(capa.id);
      await ponerVisible(capa.id, false);
      panelCapas();
    };
  });
  cuerpo.querySelector('#cArchivo').onclick = panelArchivo;
  cuerpo.querySelector('#cUrl').onclick = panelURL;
}

/* --- Agregar desde archivo --- */
function panelArchivo() {
  const cuerpo = abrirPanel('Capa desde archivo', `
    <div class="nota">Formatos: <b>GeoJSON</b>, <b>KML</b>, <b>KMZ</b>, <b>GPX</b>, <b>CSV</b> con columnas X/Y
    (o Este/Norte, o Latitud/Longitud) y <b>shapefile en ZIP</b> (.shp + .dbf + .prj).</div>
    <label>Sistema de coordenadas del archivo</label>
    <select id="aSis">
      <option value="auto">Automático (recomendado)</option>
      <option value="crtm05">CRTM05 (EPSG:5367)</option>
      <option value="ln">Lambert Norte (EPSG:5456)</option>
      <option value="ls">Lambert Sur (EPSG:5457)</option>
      <option value="geo">Latitud/Longitud WGS84</option>
    </select>
    <div class="nota">Se usa en GeoJSON y CSV. KML y GPX siempre vienen en lat/lon; el shapefile usa su archivo .prj.</div>
    <input type="file" id="aArchivo" accept=".geojson,.json,.kml,.kmz,.gpx,.csv,.txt,.zip">
    <div id="aMsg"></div>
    <button class="ancho borde" id="aVolver">← Volver a capas</button>`);
  cuerpo.querySelector('#aVolver').onclick = panelCapas;
  cuerpo.querySelector('#aArchivo').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const msg = cuerpo.querySelector('#aMsg');
    if (f.size > TAMANO_AVISO && !await confirmar('Archivo grande',
      `El archivo pesa ${(f.size / 1048576).toFixed(0)} MB. Puede tardar, ocupar mucho espacio y volver lento el mapa. ¿Cargarlo igual?`, 'Cargar', 'Cancelar')) return;
    msg.innerHTML = '<div class="nota">Leyendo archivo…</div>';
    try {
      const { fc, nombre, aviso } = await leerArchivo(f, cuerpo.querySelector('#aSis').value);
      const capa = { id: nuevoId(), nombre: nombre.slice(0, 60), origen: 'archivo',
        formato: (f.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '', color: colorNuevo(),
        fecha: new Date().toISOString(), geojson: fc };
      await guardar('capas', capa);
      S.capas.push(capa);
      document.dispatchEvent(new Event('datos-cambiados'));   // revisa el aviso de copia
      await ponerVisible(capa.id, true);
      cerrarPanel(); irACapa(capa);
      toast(`Capa "${capa.nombre}" cargada: ${fc.features.length} elemento(s). ${aviso}`, aviso ? 7000 : 3500);
    } catch (err) {
      msg.innerHTML = `<div class="nota mal">No se pudo cargar: ${esc(err.message || err)}</div>`;
    }
  };
}

/* --- Agregar desde URL --- */
function panelURL() {
  const cuerpo = abrirPanel('Capa desde URL', `
    <label>Tipo de servicio</label>
    <select id="uTipo">
      <option value="geojson">GeoJSON (dirección de un archivo .geojson)</option>
      <option value="wfs">WFS (servicio de elementos)</option>
      <option value="wms">WMS (servicio de imágenes)</option>
    </select>
    <label>Dirección (URL)</label>
    <input id="uUrl" type="url" inputmode="url" placeholder="https://…" autocomplete="off">
    <div id="uServ" hidden>
      <button class="ancho borde" id="uBuscar">Buscar capas del servicio</button>
      <label>Capa del servicio</label>
      <select id="uLista" hidden></select>
      <input id="uManual" placeholder="o escribí el nombre exacto de la capa" autocomplete="off">
    </div>
    <label>Nombre para mostrar</label>
    <input id="uNombre" placeholder="Ej.: Fincas del cantón" autocomplete="off">
    <div id="uMsg"></div>
    <button class="ancho" id="uAgregar">Agregar capa</button>
    <button class="ancho borde" id="uVolver">← Volver a capas</button>
    <div class="nota">Necesita internet. Si el servidor no permite que otras páginas lean sus datos (CORS),
    la app te lo va a decir; en ese caso descargá el archivo y cargalo desde "Archivo".</div>`);
  const $ = s => cuerpo.querySelector(s);
  let version = '1.3.0';
  const msg = (html, clase = '') => { $('#uMsg').innerHTML = html ? `<div class="nota ${clase}">${html}</div>` : ''; };
  $('#uTipo').onchange = () => { $('#uServ').hidden = $('#uTipo').value === 'geojson'; $('#uLista').hidden = true; msg(''); };
  $('#uVolver').onclick = panelCapas;

  $('#uBuscar').onclick = async () => {
    const url = $('#uUrl').value.trim(); if (!url) { msg('Escribí la dirección primero.', 'aviso'); return; }
    msg('Consultando el servicio…');
    try {
      const r = $('#uTipo').value === 'wfs' ? await escanearWFS(url) : await escanearWMS(url);
      if (r.version) version = r.version;
      if (!r.capas.length) { msg('El servicio respondió, pero no encontré capas. Escribí el nombre a mano.', 'aviso'); return; }
      $('#uLista').innerHTML = r.capas.map(c => `<option value="${esc(c.name)}">${esc(c.title)}</option>`).join('');
      $('#uLista').hidden = false;
      $('#uLista').onchange = () => { if (!$('#uNombre').value) $('#uNombre').value = $('#uLista').selectedOptions[0].textContent; };
      $('#uLista').onchange();
      msg(`Encontré ${r.capas.length} capa(s).`, 'ok');
    } catch (e) {
      msg((e instanceof ErrorURL ? esc(e.message) : 'Error inesperado: ' + esc(e.message || e)) +
        '<br>Si sabés el nombre de la capa, podés escribirlo a mano.', 'mal');
    }
  };

  $('#uAgregar').onclick = async () => {
    const tipo = $('#uTipo').value, url = $('#uUrl').value.trim();
    if (!url) { msg('Escribí la dirección.', 'aviso'); return; }
    const capaServicio = tipo === 'geojson' ? null : ($('#uManual').value.trim() || ($('#uLista').hidden ? '' : $('#uLista').value));
    if (tipo !== 'geojson' && !capaServicio) { msg('Elegí o escribí la capa del servicio.', 'aviso'); return; }
    const capa = { id: nuevoId(), nombre: ($('#uNombre').value.trim() || capaServicio || 'Capa URL').slice(0, 60),
      origen: 'url', tipo, url, capaServicio, color: colorNuevo(), fecha: new Date().toISOString() };
    if (tipo === 'wms') capa.version = version;
    $('#uAgregar').disabled = true;
    // GeoJSON y WFS: probar la descarga ANTES de guardar, para no guardar algo que no funciona.
    if (tipo !== 'wms') {
      msg('Descargando para probar…');
      try {
        const fc = await descargarCapaURL(capa);
        S.datosURL.set(capa.id, fc); S.estadoURL.set(capa.id, 'ok');
      } catch (e) {
        $('#uAgregar').disabled = false;
        msg('No se agregó. ' + (e instanceof ErrorURL ? esc(e.message) : 'Error inesperado: ' + esc(e.message || e)), 'mal');
        return;
      }
    }
    await guardar('capas', capa);
    S.capas.push(capa);
    await ponerVisible(capa.id, true);
    cerrarPanel();
    if (tipo !== 'wms') irACapa(capa);
    toast(`Capa "${capa.nombre}" agregada.` + (tipo === 'wms' ? ' Si no aparece nada, puede que el servidor no cubra esta zona o no dibuje en EPSG:3857.' : ''), 6000);
  };
}

// Al abrir la app: descargar las capas de URL visibles (si hay internet).
export function cargarCapasURLVisibles(alTerminar) {
  for (const c of S.capas) if (c.origen === 'url' && c.tipo !== 'wms' && capaVisible(c.id)) cargarCapaURL(c, alTerminar);
}

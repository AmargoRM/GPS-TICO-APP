/* =======================================================================
   PLANTILLAS DE CAPTURA (igual que la app Android)
   Una plantilla es un formulario propio, por ejemplo "Inspección de poste"
   con estado, material y foto. Se crea acá y se elige al marcar un punto,
   en "Formulario de captura".
   Tipos de campo: texto, número, lista de opciones y foto.
   Se guardan en los ajustes (van en la copia de seguridad).
   ======================================================================= */
import { S, cambiarAjuste } from './estado.js';
import { nuevoId } from './bd.js';
import { abrirPanel, toast, esc, confirmar } from './ui.js';

const TIPOS = [['text', 'Texto'], ['number', 'Número'], ['select', 'Lista de opciones'], ['foto', 'Foto']];
const lista = () => S.ajustes.plantillas || [];
const guardarTodas = arr => cambiarAjuste('plantillas', arr);

export function panelPlantillas() {
  const pl = lista();
  const cuerpo = abrirPanel('Plantillas de captura', `
    <div class="nota ok">Una <b>plantilla</b> es un formulario propio (ej. "Inspección de poste" con estado, material y foto).
    Al tocar <b>Marcar punto</b>, la elegís en <b>"Formulario de captura"</b> y llenás sus campos.</div>
    <label>Tus plantillas</label>
    ${pl.length ? `<ul class="lista">${pl.map(t => `<li><div class="cuerpo-item"><div class="t">📋 ${esc(t.nombre)}</div>
      <div class="s">${t.campos.length} campo(s): ${esc(t.campos.map(c => c.clave).slice(0, 4).join(', ')) || 'sin campos'}</div></div>
      <button class="mini borde" data-ed="${t.id}">Editar</button><button class="mini peligro" data-del="${t.id}">×</button></li>`).join('')}</ul>`
      : '<div class="vacio">Todavía no creaste ninguna.<br>Tocá "Crear plantilla nueva" para empezar.</div>'}
    <button class="ancho" id="plNueva">＋ Crear plantilla nueva</button>`);
  cuerpo.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editar(structuredCloneSeguro(pl.find(x => x.id === b.dataset.ed))));
  cuerpo.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const t = pl.find(x => x.id === b.dataset.del);
    if (!await confirmar('Borrar plantilla', `¿Borrar la plantilla <b>${esc(t.nombre)}</b>? Los puntos ya capturados conservan sus datos.`, 'Borrar', 'Cancelar', true)) return;
    await guardarTodas(pl.filter(x => x.id !== t.id));
    if (S.ajustes.plantillaActiva === t.id) await cambiarAjuste('plantillaActiva', null);
    panelPlantillas();
  });
  cuerpo.querySelector('#plNueva').onclick = () => editar({ id: nuevoId(), nombre: '', campos: [{ clave: '', tipo: 'text', req: false }] });
}
const structuredCloneSeguro = o => JSON.parse(JSON.stringify(o));

function editar(t) {
  const cuerpo = abrirPanel('Editar plantilla', `
    <div class="nota">1. Ponele nombre. 2. Agregá los campos que vas a llenar en el campo. 3. Guardar.</div>
    <label>Nombre de la plantilla</label><input id="ptNom" value="${esc(t.nombre)}" placeholder="Ej. Inspección de poste">
    <label>Campos del formulario</label><div id="ptCampos"></div>
    <button class="ancho borde" id="ptAdd">＋ Agregar campo</button>
    <button class="ancho" id="ptGuardar">Guardar plantilla</button>
    <button class="ancho borde" id="ptVolver">← Volver</button>`);
  cuerpo.querySelector('#ptNom').oninput = e => { t.nombre = e.target.value; };
  const pintar = () => {
    cuerpo.querySelector('#ptCampos').innerHTML = t.campos.map((c, i) => `<div class="cajaCampo">
      <input placeholder="Nombre del campo" value="${esc(c.clave)}" data-pc="${i}">
      <div class="fila2"><select data-pt="${i}">${TIPOS.map(([v, n]) => `<option value="${v}" ${c.tipo === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" data-pr="${i}" ${c.req ? 'checked' : ''}> Obligatorio</label></div>
      ${c.tipo === 'select' ? `<input placeholder="Opciones separadas por coma" value="${esc((c.opciones || []).join(', '))}" data-po="${i}">` : ''}
      <button class="mini peligro" data-pq="${i}">Quitar campo</button></div>`).join('');
    cuerpo.querySelectorAll('[data-pc]').forEach(x => x.oninput = e => { t.campos[x.dataset.pc].clave = e.target.value; });
    cuerpo.querySelectorAll('[data-pt]').forEach(x => x.onchange = e => { t.campos[x.dataset.pt].tipo = e.target.value; pintar(); });
    cuerpo.querySelectorAll('[data-pr]').forEach(x => x.onchange = e => { t.campos[x.dataset.pr].req = e.target.checked; });
    cuerpo.querySelectorAll('[data-po]').forEach(x => x.oninput = e => { t.campos[x.dataset.po].opciones = e.target.value.split(',').map(s => s.trim()).filter(Boolean); });
    cuerpo.querySelectorAll('[data-pq]').forEach(x => x.onclick = () => { t.campos.splice(+x.dataset.pq, 1); pintar(); });
  };
  pintar();
  cuerpo.querySelector('#ptAdd').onclick = () => { t.campos.push({ clave: '', tipo: 'text', req: false }); pintar(); };
  cuerpo.querySelector('#ptVolver').onclick = panelPlantillas;
  cuerpo.querySelector('#ptGuardar').onclick = async () => {
    if (!t.nombre.trim()) { toast('Ponele un nombre a la plantilla.'); return; }
    t.nombre = t.nombre.trim();
    t.campos = t.campos.filter(c => (c.clave || '').trim()).map(c => ({ ...c, clave: c.clave.trim() }));
    const pl = lista().filter(x => x.id !== t.id);
    pl.push(t);
    await guardarTodas(pl);
    toast(`Plantilla "${t.nombre}" guardada.`);
    panelPlantillas();
  };
}

/* --- Uso dentro de "Marcar punto" --- */
export function htmlCampos(id) {
  const t = lista().find(x => x.id === id); if (!t || !t.campos.length) return '';
  return `<div class="tituloPlantilla">📋 ${esc(t.nombre)}</div>` + t.campos.map((c, i) => {
    const req = c.req ? ' <span class="req">*</span>' : '';
    if (c.tipo === 'foto') return `<label>${esc(c.clave)}${req}</label><input type="file" accept="image/*" multiple data-pf="${i}">`;
    if (c.tipo === 'select') return `<label>${esc(c.clave)}${req}</label><select data-pd="${i}"><option value="">—</option>${(c.opciones || []).map(o => `<option>${esc(o)}</option>`).join('')}</select>`;
    return `<label>${esc(c.clave)}${req}</label><input type="${c.tipo === 'number' ? 'text' : 'text'}" ${c.tipo === 'number' ? 'inputmode="decimal"' : ''} data-pd="${i}">`;
  }).join('');
}
// Lee los valores. Devuelve { datos, archivosFoto, plantilla } o null si falta un obligatorio.
export function leerCampos(id, raiz) {
  const t = lista().find(x => x.id === id);
  if (!t) return { datos: null, archivosFoto: [], plantilla: null };
  const datos = {}, archivosFoto = [];
  for (let i = 0; i < t.campos.length; i++) {
    const c = t.campos[i];
    if (c.tipo === 'foto') {
      const inp = raiz.querySelector(`[data-pf="${i}"]`);
      const fs = inp ? [...inp.files] : [];
      if (c.req && !fs.length) { toast('Falta la foto obligatoria: ' + c.clave); return null; }
      archivosFoto.push(...fs);
    } else {
      const el = raiz.querySelector(`[data-pd="${i}"]`);
      const v = el ? el.value.trim() : '';
      if (c.req && !v) { toast('Falta el campo obligatorio: ' + c.clave); return null; }
      if (v) datos[c.clave] = c.tipo === 'number' && isFinite(parseFloat(v.replace(',', '.'))) ? parseFloat(v.replace(',', '.')) : v;
    }
  }
  return { datos: Object.keys(datos).length ? datos : null, archivosFoto, plantilla: t.nombre };
}

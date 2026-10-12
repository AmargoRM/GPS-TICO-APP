/* =======================================================================
   FILTROS POR ATRIBUTOS DENTRO DE UNA CAPA
   Muestra solo los elementos que cumplen condiciones sobre sus atributos,
   por ejemplo:  estado = "activo"   Y   area > 500
   - Varias condiciones, unidas con "todas" (Y) o "cualquiera" (O).
   - Operadores: =, ≠, contiene, no contiene, >, <, ≥, ≤, vacío, no vacío.
   - Los elementos que no cumplen no se dibujan ni responden al toque.
   - El resultado se puede guardar como una capa nueva.
   Se combina con la simbología por atributo (colores y categorías ocultas).
   ======================================================================= */
import { S } from './estado.js';
import { guardar, nuevoId } from './bd.js';
import { abrirPanel, toast, esc } from './ui.js';
import { pedirDibujo, PALETA } from './mapa.js';

export const OPERADORES = [
  ['=', 'es igual a'], ['!=', 'es distinto de'], ['contiene', 'contiene'], ['no_contiene', 'no contiene'],
  ['>', 'mayor que'], ['<', 'menor que'], ['>=', 'mayor o igual'], ['<=', 'menor o igual'],
  ['vacio', 'está vacío'], ['no_vacio', 'no está vacío']
];
const SIN_VALOR = ['vacio', 'no_vacio'];
const numero = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) && /^\s*-?[\d.,]+\s*$/.test(String(v)) ? n : NaN; };
const normal = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ¿El valor cumple una condición? (compara como número si ambos lo son; si no, como texto sin tildes ni mayúsculas)
function cumple(v, c) {
  const vacio = v == null || String(v).trim() === '';
  if (c.op === 'vacio') return vacio;
  if (c.op === 'no_vacio') return !vacio;
  const a = numero(v), b = numero(c.valor), sonNum = isFinite(a) && isFinite(b);
  switch (c.op) {
    case '=': return sonNum ? a === b : normal(v) === normal(c.valor);
    case '!=': return sonNum ? a !== b : normal(v) !== normal(c.valor);
    case 'contiene': return normal(v).includes(normal(c.valor));
    case 'no_contiene': return !normal(v).includes(normal(c.valor));
    case '>': return sonNum ? a > b : normal(v) > normal(c.valor);
    case '<': return sonNum ? a < b : normal(v) < normal(c.valor);
    case '>=': return sonNum ? a >= b : normal(v) >= normal(c.valor);
    case '<=': return sonNum ? a <= b : normal(v) <= normal(c.valor);
  }
  return true;
}
// ¿El elemento pasa el filtro de la capa? (resultado guardado aparte para no recalcular en cada dibujo)
const memoria = new WeakMap();   // capa → { firma, resultados: WeakMap(elemento → sí/no) }
export function pasaFiltro(capa, f) {
  const fl = capa.filtro;
  if (!fl || !fl.activo || !fl.condiciones || !fl.condiciones.length) return true;
  const firma = JSON.stringify(fl);
  let m = memoria.get(capa);
  if (!m || m.firma !== firma) { m = { firma, resultados: new WeakMap() }; memoria.set(capa, m); }
  let r = m.resultados.get(f);
  if (r === undefined) {
    const p = f.properties || {};
    const conds = fl.condiciones.filter(c => c.campo);
    r = !conds.length || (fl.modo === 'o' ? conds.some(c => cumple(p[c.campo], c)) : conds.every(c => cumple(p[c.campo], c)));
    m.resultados.set(f, r);
  }
  return r;
}
export const filtroActivo = c => !!(c.filtro && c.filtro.activo && c.filtro.condiciones && c.filtro.condiciones.some(x => x.campo));

function camposDe(c) {
  const k = [];
  for (const f of c.geojson?.features || []) { for (const x of Object.keys(f.properties || {})) if (!k.includes(x)) k.push(x); if (k.length >= 60) break; }
  return k;
}
function valoresDe(c, campo) {
  const v = new Set();
  for (const f of c.geojson.features) { const x = (f.properties || {})[campo]; if (x != null && x !== '') v.add(String(x)); if (v.size >= 200) break; }
  return [...v].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

// Panel del filtro de una capa. alGuardar(capaNueva) se usa para "guardar como capa nueva".
export function panelFiltro(c, volver, sumarCapa) {
  const campos = camposDe(c);
  if (!campos.length) { toast('Esta capa no tiene atributos para filtrar.'); return; }
  // Se trabaja sobre una copia; se guarda al tocar "Aplicar".
  const fl = c.filtro ? JSON.parse(JSON.stringify(c.filtro)) : { activo: true, modo: 'y', condiciones: [{ campo: campos[0], op: '=', valor: '' }] };
  const cuerpo = abrirPanel('Filtro · ' + c.nombre, `
    <div class="nota ok">Mostrá solo los elementos que cumplen las condiciones. Ej.: <b>estado</b> es igual a <b>activo</b> Y <b>area</b> mayor que <b>500</b>.</div>
    <label>Mostrar los elementos que cumplen</label>
    <select id="fModo"><option value="y">TODAS las condiciones (Y)</option><option value="o">CUALQUIERA de las condiciones (O)</option></select>
    <div id="fConds"></div>
    <button class="ancho borde" id="fAdd">＋ Agregar condición</button>
    <div class="nota" id="fCuenta"></div>
    <button class="ancho" id="fAplicar">Aplicar filtro</button>
    <div class="fila2"><button class="ancho borde" id="fQuitar">Quitar filtro</button><button class="ancho borde" id="fNueva">Guardar resultado como capa nueva</button></div>
    <button class="ancho borde" id="fVolver">← Volver a capas</button>
    <div class="nota">Mayúsculas y tildes no importan. Si el campo y el valor son números, se comparan como números. Los elementos filtrados no se dibujan ni responden al toque.</div>`);
  cuerpo.querySelector('#fModo').value = fl.modo || 'y';
  cuerpo.querySelector('#fModo').onchange = e => { fl.modo = e.target.value; contar(); };

  const contar = () => {
    const prueba = { filtro: { ...fl, activo: true } };
    const total = c.geojson.features.length;
    const pasan = c.geojson.features.filter(f => pasaFiltro(prueba, f)).length;
    cuerpo.querySelector('#fCuenta').innerHTML = `Cumplen: <b>${pasan}</b> de ${total} elementos.`;
    return pasan;
  };
  const pintar = () => {
    cuerpo.querySelector('#fConds').innerHTML = fl.condiciones.map((cd, i) => `<div class="cajaCampo">
      <select data-campo="${i}">${campos.map(k => `<option value="${esc(k)}" ${k === cd.campo ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <select data-op="${i}">${OPERADORES.map(([v, t]) => `<option value="${v}" ${v === cd.op ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${SIN_VALOR.includes(cd.op) ? '' : `<input data-valor="${i}" list="fVals${i}" value="${esc(cd.valor ?? '')}" placeholder="Valor (elegí de la lista o escribí)" autocomplete="off" autocapitalize="off">
        <datalist id="fVals${i}">${valoresDe(c, cd.campo).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`}
      ${fl.condiciones.length > 1 ? `<button class="mini peligro" data-quitar="${i}">Quitar condición</button>` : ''}</div>`).join('');
    cuerpo.querySelectorAll('[data-campo]').forEach(s => s.onchange = e => { fl.condiciones[+s.dataset.campo].campo = e.target.value; fl.condiciones[+s.dataset.campo].valor = ''; pintar(); });
    cuerpo.querySelectorAll('[data-op]').forEach(s => s.onchange = e => { fl.condiciones[+s.dataset.op].op = e.target.value; pintar(); });
    cuerpo.querySelectorAll('[data-valor]').forEach(i => i.oninput = e => { fl.condiciones[+i.dataset.valor].valor = e.target.value; contar(); });
    cuerpo.querySelectorAll('[data-quitar]').forEach(b => b.onclick = () => { fl.condiciones.splice(+b.dataset.quitar, 1); pintar(); });
    contar();
  };
  pintar();
  cuerpo.querySelector('#fAdd').onclick = () => { fl.condiciones.push({ campo: campos[0], op: '=', valor: '' }); pintar(); };
  cuerpo.querySelector('#fAplicar').onclick = async () => {
    fl.activo = true; c.filtro = fl;
    await guardar('capas', c); pedirDibujo();
    toast(`Filtro aplicado: se ven ${contar()} elemento(s).`); volver();
  };
  cuerpo.querySelector('#fQuitar').onclick = async () => {
    delete c.filtro; await guardar('capas', c); pedirDibujo();
    toast('Filtro quitado: se ven todos los elementos.'); volver();
  };
  cuerpo.querySelector('#fVolver').onclick = volver;
  cuerpo.querySelector('#fNueva').onclick = async () => {
    const prueba = { filtro: { ...fl, activo: true } };
    const feats = c.geojson.features.filter(f => pasaFiltro(prueba, f));
    if (!feats.length) { toast('Ningún elemento cumple el filtro.'); return; }
    const capa = { id: nuevoId(), nombre: (c.nombre + ' (filtrada)').slice(0, 60), tipo: 'vector', origen: 'archivo', formato: 'filtro',
      color: PALETA[S.capas.length % PALETA.length], fecha: new Date().toISOString(),
      geojson: JSON.parse(JSON.stringify({ type: 'FeatureCollection', features: feats })), proyFuente: c.proyFuente, grupo: c.grupo || null };
    await sumarCapa(capa);
    toast(`Capa nueva "${capa.nombre}" con ${feats.length} elemento(s).`); volver();
  };
}

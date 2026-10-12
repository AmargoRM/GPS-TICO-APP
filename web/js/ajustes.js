/* =======================================================================
   AJUSTES: sistema de coordenadas, almacenamiento, copia de seguridad,
   borrar todo y versión de la app.
   ======================================================================= */
import { S, cambiarAjuste, cargarTodo } from './estado.js';
import { vaciarTodo, reemplazarTodo } from './bd.js';
import { abrirPanel, cerrarPanel, toast, esc, confirmar, alerta, dialogo, descargar, fechaTexto, fechaArchivo, elegirArchivo, avisoFijo } from './ui.js';
import { crearCopia, validarCopia, prepararRestauracion } from './copia.js';
import { PROY } from './geodesia.js';
import { pedirDibujo } from './mapa.js';
import { actualizarBarra } from './gps.js';
import { cargarCapasURLVisibles } from './capas.js';
import { estaInstalada, instalar } from './instalar.js';

const DIAS_AVISO_COPIA = 7;

/* --- Almacenamiento persistente --- */
// Le pide al navegador que NO borre los datos de la app cuando le falte espacio.
export async function pedirPersistencia() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return null; }
}
async function estadoAlmacenamiento() {
  const out = { persistente: null, usado: null, cuota: null };
  try { if (navigator.storage?.persisted) out.persistente = await navigator.storage.persisted(); } catch (e) { /* nada */ }
  try { if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); out.usado = e.usage; out.cuota = e.quota; } } catch (e) { /* nada */ }
  return out;
}
const mb = b => b == null ? '—' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

/* --- Aviso de copia vieja --- */
export function revisarAvisoCopia() {
  const hayDatos = S.puntos.length || S.capas.some(c => c.origen === 'archivo');
  const ult = S.ajustes.ultimaCopia ? Date.parse(S.ajustes.ultimaCopia) : null;
  const dias = ult ? Math.floor((Date.now() - ult) / 86400000) : null;
  if (hayDatos && (dias == null || dias > DIAS_AVISO_COPIA)) {
    avisoFijo('copia', dias == null ? 'Nunca descargaste una copia de seguridad.' : `Hace ${dias} días que no descargás una copia de seguridad.`,
      { texto: 'Descargar', accion: descargarCopia });
  } else avisoFijo('copia', null);
}

/* --- Descargar copia --- */
export async function descargarCopia() {
  try {
    const copia = await crearCopia(S.capas, S.puntos, S.ajustes);
    descargar(`gps-tico-web-copia-${fechaArchivo()}.json`, JSON.stringify(copia), 'application/json');
    await cambiarAjuste('ultimaCopia', new Date().toISOString());
    revisarAvisoCopia();
    toast('Copia descargada. Guardala fuera del celular (correo, nube, computadora).', 6000);
  } catch (e) {
    alerta('No se pudo crear la copia', esc(e.message || e));
  }
}

/* --- Restaurar copia --- */
async function restaurarCopia() {
  const archivo = await elegirArchivo('.json,application/json');
  if (!archivo) return;
  let obj;
  try { obj = JSON.parse(await archivo.text()); }
  catch (e) {
    alerta('Copia rechazada', 'El archivo no se puede leer como JSON. Puede estar dañado o no ser una copia.<br><br><b>No se cambió nada.</b>');
    return;
  }
  const r = validarCopia(obj);
  if (!r.ok) {
    alerta('Copia rechazada', 'El archivo tiene problemas:<ul>' + r.errores.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join('') + '</ul>' +
      (r.errores.length > 8 ? `…y ${r.errores.length - 8} problema(s) más.<br>` : '') + '<b>No se cambió nada.</b> Tus datos actuales siguen igual.');
    return;
  }
  const s = r.resumen;
  const si = await confirmar('Restaurar copia',
    `Copia del <b>${fechaTexto(s.fecha)}</b>: ${s.capas} capa(s), ${s.puntos} punto(s), ${s.fotos} foto(s).<br><br>
     Esto <b>reemplaza todo</b> lo que hay ahora en el celular (${S.capas.length} capa(s), ${S.puntos.length} punto(s)).
     Lo actual se pierde. Si querés conservarlo, cancelá y descargá primero una copia.`, 'Reemplazar todo', 'Cancelar', true);
  if (!si) return;
  try {
    await reemplazarTodo(prepararRestauracion(obj));
  } catch (e) {
    alerta('No se pudo restaurar', 'Hubo un error al guardar (' + esc(e.message || e) + '). La operación es "todo o nada": tus datos anteriores no se tocaron.');
    return;
  }
  await cargarTodo();
  cargarCapasURLVisibles(pedirDibujo);
  actualizarBarra(); pedirDibujo(); revisarAvisoCopia();
  cerrarPanel();
  toast(`Copia restaurada: ${S.capas.length} capa(s) y ${S.puntos.length} punto(s).`, 5000);
}

/* --- Borrar todo (doble confirmación) --- */
async function borrarTodo() {
  const uno = await confirmar('Borrar todo',
    `Se van a borrar del celular <b>${S.capas.length} capa(s)</b>, <b>${S.puntos.length} punto(s)</b> con sus fotos, y todos los ajustes.<br><br>
     <b>No se puede deshacer.</b> La única forma de recuperarlos es con un archivo de copia de seguridad descargado antes.`,
    'Entiendo, continuar', 'Cancelar', true);
  if (!uno) return;
  const dos = await dialogo({ titulo: 'Última confirmación',
    html: 'Para confirmar, escribí <b>BORRAR</b> en mayúsculas.', campo: { placeholder: 'BORRAR' },
    botones: [{ texto: 'Cancelar', valor: false, clase: 'borde' }, { texto: 'Borrar todo', valor: true, clase: 'peligro' }] });
  if (!dos.valor) return;
  if (dos.texto.trim() !== 'BORRAR') { alerta('No se borró nada', 'El texto no coincide con BORRAR.'); return; }
  await vaciarTodo();
  await cargarTodo();
  S.destino = null; document.getElementById('navCaja').hidden = true;
  actualizarBarra(); pedirDibujo(); revisarAvisoCopia();
  cerrarPanel();
  toast('Se borró todo.');
}

/* --- Versión de la app --- */
export async function versionApp() {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return '(sin instalar)';
  return await new Promise(ok => {
    const t = setTimeout(() => ok('—'), 1500);
    navigator.serviceWorker.addEventListener('message', function m(e) {
      if (e.data?.tipo === 'VERSION') { clearTimeout(t); navigator.serviceWorker.removeEventListener('message', m); ok(e.data.version); }
    });
    sw.postMessage({ tipo: 'VERSION' });
  });
}

/* --- Panel --- */
export async function panelAjustes() {
  const al = await estadoAlmacenamiento();
  const version = await versionApp();
  const opcProy = Object.entries(PROY).map(([k, p]) =>
    `<option value="${k}" ${S.ajustes.proyeccion === k ? 'selected' : ''}>${p.largo}</option>`).join('');
  const persist = al.persistente === true ? '<div class="nota ok">✔ <b>Concedido.</b> El navegador no va a borrar tus datos por falta de espacio.</div>'
    : al.persistente === false ? '<div class="nota aviso">✖ <b>No concedido.</b> Si el celular se queda sin espacio, el navegador podría borrar los datos. Instalá la app (Agregar a pantalla de inicio) y tocá "Pedir de nuevo". Descargá copias seguido.</div>'
    : '<div class="nota aviso">Este navegador no informa si el almacenamiento es persistente. Descargá copias seguido.</div>';

  const cuerpo = abrirPanel('Ajustes', `
    <label>Sistema de coordenadas en pantalla</label>
    <select id="sProy">${opcProy}</select>
    <div class="nota">Los puntos siempre guardan X/Y en CRTM05 además de latitud/longitud.
    Lambert usa el cambio de datum Helmert de 7 parámetros (igual que el GPS TICO original). El método oficial del IGN
    puede diferir de 1 a varios metros: no lo uses para catastro sin verificar.</div>

    <h4>Instalación</h4>
    ${estaInstalada() ? '<div class="nota ok">✔ Estás usando la app instalada.</div>'
      : '<div class="nota aviso">Estás usando la app desde el navegador. Instalala para abrirla sin internet desde un ícono.</div><button class="ancho" id="sInstalar">Instalar app</button>'}

    <h4>Almacenamiento persistente</h4>
    ${persist}
    ${al.persistente !== true ? '<button class="ancho borde" id="sPersist">Pedir de nuevo</button>' : ''}
    <div class="nota">Espacio usado por la app: <b>${mb(al.usado)}</b>${al.cuota ? ` de ${mb(al.cuota)} disponibles` : ''}.</div>

    <h4>Copia de seguridad</h4>
    <div class="nota ${S.ajustes.ultimaCopia ? '' : 'aviso'}">Última copia descargada: <b>${S.ajustes.ultimaCopia ? fechaTexto(S.ajustes.ultimaCopia) : 'nunca'}</b></div>
    <button class="ancho" id="sDescargar">Descargar copia</button>
    <button class="ancho borde" id="sRestaurar">Restaurar copia</button>
    <div class="nota">La copia es un archivo .json con todas las capas, puntos (con fotos) y ajustes.
    Guardala fuera del celular. Restaurar revisa el archivo primero; si tiene problemas, no cambia nada.</div>

    <h4>Zona peligrosa</h4>
    <button class="ancho peligro" id="sBorrar">Borrar todo</button>

    <h4>Acerca de</h4>
    <div class="nota">GPS TICO Web · versión ${esc(version)}<br>Tus datos quedan solo en este celular. No hay servidor ni cuenta.</div>
    <button class="ancho borde" id="sBuscarVer">Buscar actualización</button>`);

  const bi = cuerpo.querySelector('#sInstalar');
  if (bi) bi.onclick = instalar;
  cuerpo.querySelector('#sProy').onchange = async e => { await cambiarAjuste('proyeccion', e.target.value); actualizarBarra(); };
  const bp = cuerpo.querySelector('#sPersist');
  if (bp) bp.onclick = async () => { const r = await pedirPersistencia(); toast(r ? 'Concedido.' : 'El navegador no lo concedió.'); panelAjustes(); };
  cuerpo.querySelector('#sDescargar').onclick = async () => { await descargarCopia(); panelAjustes(); };
  cuerpo.querySelector('#sRestaurar').onclick = restaurarCopia;
  cuerpo.querySelector('#sBorrar').onclick = borrarTodo;
  cuerpo.querySelector('#sBuscarVer').onclick = async () => {
    if (!navigator.onLine) { toast('Sin conexión: no se puede buscar.'); return; }
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) { toast('La app no está instalada como aplicación sin conexión.'); return; }
    await reg.update();
    toast(reg.waiting || reg.installing ? 'Hay una versión nueva: mirá el aviso arriba.' : 'Ya tenés la última versión.');
  };
}

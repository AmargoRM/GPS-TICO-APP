/* =======================================================================
   MAPA SIN CONEXIÓN POR ZONAS (igual que la app Android)
   Se descarga el recuadro que estás viendo como una "zona" con nombre.
   Se pueden guardar varias zonas; cada una se borra por separado.
   Además, todo lo que mirás con internet queda guardado solo.
   Ojo: Esri y OpenStreetMap no permiten descargas masivas. Descargá áreas
   de trabajo, no provincias enteras (la app limita el tamaño).
   ======================================================================= */
import { S } from './estado.js';
import { leer, leerTodos, guardar, borrar, contar, vaciar, nuevoId } from './bd.js';
import { abrirPanel, cerrarPanel, toast, esc, confirmar } from './ui.js';
import { FONDOS, vista, tamanoMapa, lon2px, lat2px, px2lon, px2lat, irA, borrarTeselasMemoria, pedirDibujo } from './mapa.js';

const MAX_TESELAS = 6000;   // tope por zona para no abusar de los servidores ni llenar el celular

function cajaVista() {
  const { W, H } = tamanoMapa(), z = vista.zoom;
  const cx = lon2px(vista.lon, z), cy = lat2px(vista.lat, z);
  return { w: px2lon(cx - W / 2, z), e: px2lon(cx + W / 2, z), n: px2lat(cy - H / 2, z), s: px2lat(cy + H / 2, z) };
}
function teselasDe(b, zMin, zMax) {
  const out = [];
  for (let z = zMin; z <= zMax; z++) {
    const x0 = Math.floor(lon2px(b.w, z) / 256), x1 = Math.floor(lon2px(b.e, z) / 256);
    const y0 = Math.floor(lat2px(b.n, z) / 256), y1 = Math.floor(lat2px(b.s, z) / 256);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}
const cubre = (zona, z, x, y) => z >= zona.zMin && z <= zona.zMax && teselasDe(zona.caja, z, z).some(([, a, b]) => a === x && b === y);

export async function panelOffline() {
  const zonas = (await leerTodos('zonas')).sort((a, b) => b.t - a.t);
  const total = await contar('teselas');
  const fondo = FONDOS[S.ajustes.fondo];
  const cuerpo = abrirPanel('Mapa sin conexión', `
    <div class="nota ok">Se descarga el <b>recuadro que estás viendo</b> como una <b>zona</b> con nombre. Podés guardar varias; cada una se borra por separado.
    Fondo actual: <b>${fondo.nom}</b> (cambialo con ▦ antes de descargar si querés satélite y calles).</div>
    ${!fondo.url ? '<div class="nota aviso">El fondo actual es "Sin fondo": elegí Satélite o Calles para descargar.</div>' : ''}
    <label>Nombre de la zona</label><input id="oNom" placeholder="Ej. Naciente río Naranjo">
    <label>Zoom máximo a descargar</label>
    <select id="oZ"><option value="16">16 — calles y ríos principales</option><option value="17" selected>17 — recomendado para campo</option><option value="18">18 — detalle alto, pesa 4×</option><option value="19">19 — máximo, pesa 16×</option></select>
    <table class="coords"><tr><td>Estimado (área visible)</td><td id="oEst">—</td></tr></table>
    <div class="progreso"><i id="oBarra"></i></div>
    <button class="ancho" id="oOk" ${fondo.url ? '' : 'disabled'}>Descargar esta zona</button>
    <h4>Zonas guardadas</h4>
    ${zonas.length ? `<ul class="lista">${zonas.map(z => `<li><div class="cuerpo-item"><div class="t">${esc(z.nombre)}</div>
      <div class="s">${FONDOS[z.fondo]?.nom || z.fondo} · zoom ${z.zMin}–${z.zMax} · ${z.teselas} cuadritos · ${new Date(z.t).toLocaleDateString('es-CR')}</div></div>
      <button class="mini borde" data-ir="${z.id}">Ir</button><button class="mini peligro" data-del="${z.id}">×</button></li>`).join('')}</ul>`
      : '<div class="vacio">Sin zonas guardadas. Encuadrá un área y descargala.</div>'}
    <table class="coords"><tr><td>Total guardado en el celular</td><td>${total} cuadritos</td></tr></table>
    <button class="ancho borde rojo" id="oBorrar">Borrar todo el mapa guardado</button>
    <div class="nota">Google Maps no permite descargar su mapa; por eso se usan Esri y OpenStreetMap. Descargá áreas de trabajo, no provincias enteras (máximo ${MAX_TESELAS} cuadritos por zona).</div>`);
  const zMin = Math.max(2, Math.round(vista.zoom) - 2);
  const estimar = () => { const n = teselasDe(cajaVista(), zMin, +cuerpo.querySelector('#oZ').value).length; cuerpo.querySelector('#oEst').textContent = `${n} cuadritos · ~${(n * 22 / 1024).toFixed(1)} MB`; return n; };
  cuerpo.querySelector('#oZ').onchange = estimar; estimar();
  cuerpo.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => {
    const z = zonas.find(x => x.id === b.dataset.ir); cerrarPanel(); S.seguir = false;
    irA((z.caja.n + z.caja.s) / 2, (z.caja.w + z.caja.e) / 2, Math.min(z.zMax, 15));
  });
  cuerpo.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Borrar zona', 'Se borra esta zona y sus cuadritos (los que no comparta con otra zona).', 'Borrar', 'Cancelar', true)) return;
    const zona = zonas.find(x => x.id === b.dataset.del);
    const otras = zonas.filter(x => x.id !== zona.id && x.fondo === zona.fondo);
    for (const [z, x, y] of teselasDe(zona.caja, zona.zMin, zona.zMax)) if (!otras.some(o => cubre(o, z, x, y))) await borrar('teselas', `${zona.fondo}/${z}/${x}/${y}`);
    await borrar('zonas', zona.id);
    borrarTeselasMemoria(); pedirDibujo(); panelOffline();
  });
  cuerpo.querySelector('#oBorrar').onclick = async () => {
    if (!await confirmar('Borrar mapa guardado', 'Se borran TODOS los cuadritos y zonas guardados. El fondo dejará de verse sin internet hasta que descargues de nuevo. Tus capas y puntos NO se tocan.', 'Borrar', 'Cancelar', true)) return;
    await vaciar('teselas'); await vaciar('zonas'); borrarTeselasMemoria(); pedirDibujo(); panelOffline();
    toast('Mapa guardado borrado.');
  };
  cuerpo.querySelector('#oOk').onclick = async () => {
    if (!navigator.onLine) { toast('Para descargar hace falta internet.'); return; }
    const clave = S.ajustes.fondo, f = FONDOS[clave], caja = cajaVista(), zMax = +cuerpo.querySelector('#oZ').value;
    const lista = teselasDe(caja, zMin, zMax);
    if (lista.length > MAX_TESELAS) { toast(`Son ${lista.length} cuadritos: demasiado. Acercá el mapa o bajá el zoom máximo (tope ${MAX_TESELAS}).`, 7000); return; }
    const nombre = cuerpo.querySelector('#oNom').value.trim() || 'Zona ' + new Date().toLocaleDateString('es-CR');
    const btn = cuerpo.querySelector('#oOk'), barra = cuerpo.querySelector('#oBarra');
    btn.disabled = true;
    let hechas = 0, fallas = 0, guardadas = 0;
    for (let i = 0; i < lista.length; i += 6) {
      await Promise.all(lista.slice(i, i + 6).map(async ([z, x, y]) => {
        const k = `${clave}/${z}/${x}/${y}`;
        try {
          if (await leer('teselas', k)) { guardadas++; return; }
          const r = await fetch(f.url(z, x, y), { signal: AbortSignal.timeout(15000) });
          if (!r.ok) throw new Error();
          await guardar('teselas', await r.blob(), k); guardadas++;
        } catch (e) { fallas++; } finally { hechas++; }
      }));
      barra.style.width = (hechas / lista.length * 100) + '%';
      btn.textContent = `Descargando ${hechas}/${lista.length}`;
    }
    await guardar('zonas', { id: nuevoId(), nombre, fondo: clave, caja, zMin, zMax, teselas: guardadas, t: Date.now() });
    toast(fallas ? `Zona "${nombre}" guardada; ${fallas} cuadritos fallaron.` : `Zona "${nombre}" guardada: ${guardadas} cuadritos.`, 6000);
    pedirDibujo(); panelOffline();
  };
}

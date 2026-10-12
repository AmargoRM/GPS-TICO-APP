/* =======================================================================
   PIEZAS DE PANTALLA REUTILIZABLES
   Avisos cortos (toast), panel deslizable, diálogos de confirmación y
   descarga de archivos.
   ======================================================================= */

// Escapa texto para meterlo en HTML sin riesgo (nombres, notas, etc.).
export function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Aviso corto abajo de la pantalla que desaparece solo.
let tToast = null;
export function toast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(tToast);
  tToast = setTimeout(() => el.classList.remove('on'), ms);
}

// Panel que sube desde abajo, con título y contenido HTML.
// Devuelve el elemento del cuerpo para conectar botones.
export function abrirPanel(titulo, html) {
  const p = document.getElementById('panel');
  p.querySelector('h2').textContent = titulo;
  const cuerpo = p.querySelector('.cuerpo');
  cuerpo.innerHTML = html;
  cuerpo.scrollTop = 0;
  p.hidden = false;
  return cuerpo;
}
export function cerrarPanel() { document.getElementById('panel').hidden = true; }
export function panelAbierto() { return !document.getElementById('panel').hidden; }

// Diálogo genérico. botones = [{texto, valor, clase}]. Devuelve el valor elegido.
export function dialogo({ titulo, html, botones, campo }) {
  return new Promise(resolver => {
    const d = document.getElementById('dialogo');
    d.querySelector('h3').textContent = titulo;
    d.querySelector('.texto').innerHTML = html;
    const inp = d.querySelector('input');
    inp.hidden = !campo;
    inp.value = '';
    if (campo) inp.placeholder = campo.placeholder || '';
    const caja = d.querySelector('.botones');
    caja.innerHTML = '';
    for (const b of botones) {
      const el = document.createElement('button');
      el.textContent = b.texto;
      if (b.clase) el.className = b.clase;
      el.onclick = () => { d.hidden = true; resolver(campo ? { valor: b.valor, texto: inp.value } : b.valor); };
      caja.appendChild(el);
    }
    d.hidden = false;
    if (campo) setTimeout(() => inp.focus(), 50);
  });
}
// Pregunta Sí/No. Devuelve true si confirma.
export function confirmar(titulo, html, si = 'Sí', no = 'Cancelar', peligro = false) {
  return dialogo({ titulo, html, botones: [
    { texto: no, valor: false, clase: 'borde' },
    { texto: si, valor: true, clase: peligro ? 'peligro' : '' }
  ] });
}
// Mensaje con un solo botón.
export function alerta(titulo, html) {
  return dialogo({ titulo, html, botones: [{ texto: 'Entendido', valor: true }] });
}

// Descarga un archivo generado en el celular (no sube nada a internet).
export function descargar(nombre, contenido, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Fecha y hora legibles en español de Costa Rica.
export function fechaTexto(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });
}
// Fecha para nombres de archivo: 2026-10-12
export function fechaArchivo() { return new Date().toISOString().slice(0, 10); }

// Pide al usuario elegir un archivo. Devuelve el File o null.
export function elegirArchivo(accept) {
  return new Promise(resolver => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.onchange = () => resolver(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}

// Aviso fijo arriba de la pantalla (copia vieja, versión nueva, etc.).
// Si texto es null, quita el aviso. boton = {texto, accion}.
export function avisoFijo(id, texto, boton, clase = '') {
  const caja = document.getElementById('avisos');
  let el = document.getElementById('aviso-' + id);
  if (!texto) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'aviso-' + id; caja.appendChild(el); }
  el.className = 'aviso-barra ' + clase;
  el.innerHTML = `<span>${texto}</span>`;
  if (boton) {
    const b = document.createElement('button');
    b.className = 'mini'; b.textContent = boton.texto; b.onclick = boton.accion;
    el.appendChild(b);
  }
}

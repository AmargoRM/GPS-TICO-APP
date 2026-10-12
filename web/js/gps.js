/* =======================================================================
   GPS: posición en vivo, precisión y captura de puntos
   Usa el GPS del celular a través del navegador. Funciona sin internet
   (el GPS no necesita datos móviles), pero el navegador pide permiso.
   ======================================================================= */
import { S } from './estado.js';
import { guardar, nuevoId } from './bd.js';
import { aCRTM05, textoCoord, PROY } from './geodesia.js';
import { abrirPanel, cerrarPanel, toast, esc, confirmar, alerta } from './ui.js';
import { pedirDibujo, irA, vista } from './mapa.js';

export const PRECISION_LIMITE = 15;   // metros: peor que esto, se avisa antes de guardar

const oyentes = new Set();            // funciones a llamar cada vez que llega una posición
export function alCambiarPosicion(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

let errorMostrado = false;
export function iniciarGPS() {
  if (!('geolocation' in navigator)) {
    document.getElementById('cA').textContent = 'Este navegador no tiene GPS';
    return;
  }
  navigator.geolocation.watchPosition(pos => {
    const c = pos.coords;
    const primera = !S.fix;
    S.fix = { lat: c.latitude, lon: c.longitude, precision: c.accuracy, altitud: c.altitude,
              rumboMov: c.heading, t: pos.timestamp || Date.now() };
    errorMostrado = false;
    actualizarBarra();
    // La primera vez, o si el mapa está "siguiendo", centrar en mi posición.
    if (primera) irA(S.fix.lat, S.fix.lon, Math.max(vista.zoom, 16));
    else if (S.seguir) irA(S.fix.lat, S.fix.lon);
    else pedirDibujo();
    oyentes.forEach(fn => fn(S.fix));
  }, err => {
    if (err.code === 1) {
      document.getElementById('cA').textContent = 'Sin permiso de ubicación';
      if (!errorMostrado) alerta('Permiso de ubicación', 'El navegador no tiene permiso para usar el GPS. Activalo en los ajustes del navegador o del celular (Ubicación → permitir para este sitio) y volvé a abrir la app.');
      errorMostrado = true;
    } else if (err.code === 2 && !errorMostrado && !S.fix) {
      toast('El GPS no da posición. Revisá que la ubicación del celular esté encendida.');
      errorMostrado = true;
    }
    // código 3 (tiempo agotado): se sigue esperando sin molestar.
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}

// Clase de color según la precisión.
export function clasePrecision(m) {
  if (m == null) return '';
  return m <= 5 ? 'bien' : m <= PRECISION_LIMITE ? 'medio' : 'mal';
}
export function textoPrecision(m) { return m == null ? '— m' : `±${m < 10 ? m.toFixed(1) : Math.round(m)} m`; }

// Barra superior: coordenadas de mi posición en el sistema elegido.
export function actualizarBarra() {
  const modo = S.ajustes.proyeccion || 'crtm05';
  document.querySelector('#btnProy .sis').textContent = PROY[modo].nom.toUpperCase();
  const prec = document.getElementById('precision');
  if (!S.fix) { prec.className = 'prec'; prec.textContent = '— m'; return; }
  const t = textoCoord(S.fix.lat, S.fix.lon, modo);
  document.getElementById('cA').textContent = t.a;
  document.getElementById('cB').textContent = t.b;
  prec.className = 'prec ' + clasePrecision(S.fix.precision);
  prec.textContent = textoPrecision(S.fix.precision);
}

// Siguiente nombre libre: P001, P002…
function siguienteNombre() {
  let max = 0;
  for (const p of S.puntos) { const m = /^P(\d+)$/.exec(p.nombre); if (m) max = Math.max(max, +m[1]); }
  return 'P' + String(max + 1).padStart(3, '0');
}

// Achica la foto (máx. 1600 px, JPEG) para no llenar el celular.
async function reducirFoto(archivo) {
  try {
    const bmp = await createImageBitmap(archivo);
    const esc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * esc); cv.height = Math.round(bmp.height * esc);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
  } catch (e) {
    return archivo;   // si no se puede achicar, se guarda tal cual
  }
}

/* --- Panel de captura --- */
export function panelCaptura() {
  const cuerpo = abrirPanel('Capturar punto', `
    <div class="nota" id="kEstado">Esperando GPS…</div>
    <table class="coords" id="kCoords"></table>
    <label>Nombre</label>
    <input id="kNombre" value="${esc(siguienteNombre())}" autocomplete="off">
    <label>Nota (opcional)</label>
    <textarea id="kNota" placeholder="Descripción, estado, observaciones…"></textarea>
    <label>Foto (opcional)</label>
    <input type="file" id="kFoto" accept="image/*" capture="environment">
    <button class="ancho" id="kGuardar">Guardar punto</button>
    <div class="nota">Consejo: quedate quieto al aire libre unos segundos hasta que la precisión baje (ideal: ${PRECISION_LIMITE} m o menos).</div>`);

  const refrescar = () => {
    const f = S.fix, est = cuerpo.querySelector('#kEstado');
    if (!f) { est.className = 'nota aviso'; est.textContent = 'Esperando señal del GPS…'; return; }
    const cl = clasePrecision(f.precision);
    est.className = 'nota ' + (cl === 'bien' ? 'ok' : cl === 'medio' ? 'aviso' : 'mal');
    est.innerHTML = `Precisión actual: <b>${textoPrecision(f.precision)}</b>` +
      (f.precision > PRECISION_LIMITE ? ` — peor que ${PRECISION_LIMITE} m, conviene esperar.` : '');
    const c = aCRTM05(f.lat, f.lon);
    cuerpo.querySelector('#kCoords').innerHTML =
      `<tr><td>X CRTM05</td><td>${c.x.toFixed(2)}</td></tr><tr><td>Y CRTM05</td><td>${c.y.toFixed(2)}</td></tr>` +
      `<tr><td>Lat / Lon</td><td>${f.lat.toFixed(6)}, ${f.lon.toFixed(6)}</td></tr>`;
  };
  refrescar();
  // Actualizar con cada posición nueva; dejar de escuchar cuando el panel se cierra o cambia.
  const est = cuerpo.querySelector('#kEstado');
  const quitar = alCambiarPosicion(() => {
    if (!est.isConnected || document.getElementById('panel').hidden) { quitar(); return; }
    refrescar();
  });

  cuerpo.querySelector('#kGuardar').onclick = async () => {
    const f = S.fix ? { ...S.fix } : null;   // posición en el momento de tocar "Guardar"
    if (!f) { alerta('Sin posición', 'Todavía no hay señal del GPS. Esperá a que aparezca la precisión arriba a la derecha.'); return; }
    if (Date.now() - f.t > 60000) {
      if (!await confirmar('Posición vieja', 'La última posición del GPS tiene más de un minuto. Puede que ya no estés ahí. ¿Guardar igual?', 'Guardar igual', 'Esperar')) return;
    }
    if (f.precision > PRECISION_LIMITE) {
      const si = await confirmar('Precisión baja',
        `La precisión ahora es <b>${textoPrecision(f.precision)}</b>, peor que ${PRECISION_LIMITE} m.<br>El punto real puede estar a esa distancia de lo que se guarde.<br><br>¿Guardar igual o esperar a que mejore?`,
        'Guardar igual', 'Esperar');
      if (!si) return;
    }
    const nombre = cuerpo.querySelector('#kNombre').value.trim() || siguienteNombre();
    const archivoFoto = cuerpo.querySelector('#kFoto').files[0];
    const c = aCRTM05(f.lat, f.lon);
    const punto = {
      id: nuevoId(),
      nombre: nombre.slice(0, 80),
      nota: cuerpo.querySelector('#kNota').value.trim(),
      fecha: new Date().toISOString(),
      lat: +f.lat.toFixed(8), lon: +f.lon.toFixed(8),
      x: c.x, y: c.y,                                   // X/Y en CRTM05 (metros)
      precision: Math.round(f.precision * 10) / 10,     // metros
      foto: archivoFoto ? await reducirFoto(archivoFoto) : null
    };
    try {
      await guardar('puntos', punto);
    } catch (e) {
      alerta('No se pudo guardar', 'El celular no permitió guardar el punto (' + esc(e.message || e) + '). Puede que el almacenamiento esté lleno.');
      return;
    }
    S.puntos.push(punto);
    document.dispatchEvent(new Event('datos-cambiados'));   // revisa el aviso de copia
    cerrarPanel(); pedirDibujo();
    toast(`Punto ${punto.nombre} guardado (${textoPrecision(punto.precision)}).`);
  };
}

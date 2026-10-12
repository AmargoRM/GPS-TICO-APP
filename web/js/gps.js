/* =======================================================================
   GPS: posición en vivo y MARCAR PUNTO (igual que la app Android)
   - "Mi GPS" o "Ingresar coordenadas" (Geo, CRTM05, Lambert N/S).
   - Formulario de captura (plantilla), varias fotos con marca de agua
     (nombre, coordenadas y fecha impresos en la foto).
   - Guardar ahora (instantáneo) o PROMEDIAR quieto 30 s a 5 min: la app
     junta lecturas, descarta las raras y muestra la desviación en vivo.
   Funciona sin internet (el GPS no necesita datos), pero el navegador pide
   permiso de ubicación.
   ======================================================================= */
import { S, cambiarAjuste } from './estado.js';
import { guardar, nuevoId } from './bd.js';
import { aCRTM05, textoCoord, haciaWgs, PROY, D2R } from './geodesia.js';
import { abrirPanel, cerrarPanel, toast, esc, confirmar, alerta } from './ui.js';
import { pedirDibujo, irA, vista } from './mapa.js';
import { htmlCampos, leerCampos } from './plantillas.js';

export const PRECISION_LIMITE = 15;   // metros: peor que esto, se avisa antes de guardar

const oyentes = new Set();            // funciones a llamar cada vez que llega una posición
export function alCambiarPosicion(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

let errorMostrado = false;
export function iniciarGPS() {
  if (!('geolocation' in navigator)) { document.getElementById('cA').textContent = 'Este navegador no tiene GPS'; return; }
  navigator.geolocation.watchPosition(pos => {
    const c = pos.coords;
    const primera = !S.fix;
    S.fix = { lat: c.latitude, lon: c.longitude, precision: c.accuracy, altitud: c.altitude, precAltitud: c.altitudeAccuracy,
              rumboMov: c.heading, velocidad: c.speed, t: pos.timestamp || Date.now() };
    errorMostrado = false;
    actualizarBarra();
    if (primera && !S.ajustes.vista) irA(S.fix.lat, S.fix.lon, Math.max(vista.zoom, 16));
    else if (S.seguir) irA(S.fix.lat, S.fix.lon);
    else pedirDibujo();
    oyentes.forEach(fn => fn(S.fix));
  }, err => {
    if (err.code === 1) {
      document.getElementById('cA').textContent = 'Sin permiso de ubicación';
      if (!errorMostrado) alerta('Permiso de ubicación', 'El navegador no tiene permiso para usar el GPS.<br><br><b>iPhone:</b> Ajustes → Privacidad y seguridad → Localización → activada; y Ajustes → Apps → Safari → Ubicación → "Preguntar" o "Permitir".<br><b>Android:</b> en el navegador, candado de la barra → Permisos → Ubicación → Permitir.<br><br>Después cerrá y volvé a abrir la app.');
      errorMostrado = true;
    } else if (err.code === 2 && !errorMostrado && !S.fix) {
      toast('El GPS no da posición. Revisá que la ubicación del celular esté encendida.');
      errorMostrado = true;
    }
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}

export function clasePrecision(m) { return m == null ? '' : m <= 5 ? 'bien' : m <= PRECISION_LIMITE ? 'medio' : 'mal'; }
export function textoPrecision(m) { return m == null ? '— m' : `±${m < 10 ? m.toFixed(1) : Math.round(m)} m`; }

// Barra superior: sistema elegido, coordenadas, precisión, altura y velocidad.
export function actualizarBarra() {
  const modo = S.ajustes.proyeccion || 'crtm05';
  document.querySelectorAll('#sistemas [data-m]').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === modo ? 'true' : 'false'));
  const prec = document.getElementById('precision');
  if (!S.fix) { prec.className = 'prec'; prec.textContent = '— m'; return; }
  const t = textoCoord(S.fix.lat, S.fix.lon, modo);
  document.getElementById('cA').textContent = t.a;
  document.getElementById('cB').textContent = t.b;
  prec.className = 'prec ' + clasePrecision(S.fix.precision);
  prec.textContent = textoPrecision(S.fix.precision);
  document.getElementById('mAlt').textContent = S.fix.altitud != null ? Math.round(S.fix.altitud) + ' m' : '—';
  document.getElementById('mVel').textContent = S.fix.velocidad != null && S.fix.velocidad >= 0 ? (S.fix.velocidad * 3.6).toFixed(1) + ' km/h' : '—';
}

// Siguiente nombre libre: P001, P002…
function siguienteNombre() {
  let max = 0;
  for (const p of S.puntos) { const m = /^P(\d+)$/.exec(p.nombre); if (m) max = Math.max(max, +m[1]); }
  return 'P' + String(max + 1).padStart(3, '0');
}

/* --- Fotos: achicar (máx. 1600 px) e imprimir marca de agua --- */
async function prepararFoto(archivo, info) {
  try {
    const bmp = await createImageBitmap(archivo);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0, cv.width, cv.height);
    marcaDeAgua(g, cv.width, cv.height, info);
    return await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
  } catch (e) { return archivo; }   // si no se puede procesar (ej. HEIC raro), se guarda tal cual
}
function marcaDeAgua(g, w, h, info) {
  const lineas = [];
  if (info.nombre) lineas.push('📍 ' + info.nombre);
  lineas.push(`WGS84  ${info.lat.toFixed(6)}, ${info.lon.toFixed(6)}`);
  lineas.push(`CRTM05  X ${Math.round(info.x)}   Y ${Math.round(info.y)}`);
  lineas.push(info.fecha);
  const k = Math.max(1, w / 1024), fs = Math.round(14 * k), lh = Math.round(fs * 1.35), pad = Math.round(10 * k);
  const alto = pad * 2 + lh * lineas.length;
  g.fillStyle = 'rgba(0,0,0,.62)'; g.fillRect(0, h - alto, w, alto);
  g.fillStyle = 'rgba(242,201,76,.9)'; g.fillRect(0, h - alto, w, Math.max(1, Math.round(k)));
  g.font = `600 ${fs}px system-ui, sans-serif`; g.textBaseline = 'top'; g.fillStyle = '#fff';
  lineas.forEach((l, i) => g.fillText(l, pad, h - alto + pad + i * lh));
}

/* --- Promediado (ocupación estática), copiado del original --- */
const M_GRADO = 111320;
// Media ponderada por precisión (peso 1/precisión²) y desviación estándar en metros.
// Descarta lecturas a más de 3 desviaciones de la media.
export function calcularPromedio(muestras) {
  if (!muestras.length) return null;
  const media = arr => { let sw = 0, sa = 0, so = 0; for (const m of arr) { const w = m.acc > 0 ? 1 / (m.acc * m.acc) : 1; sw += w; sa += m.lat * w; so += m.lon * w; } return { lat: sa / sw, lon: so / sw }; };
  let ctr = media(muestras);
  const mLon0 = M_GRADO * Math.cos(ctr.lat * D2R);
  const d = muestras.map(m => Math.hypot((m.lon - ctr.lon) * mLon0, (m.lat - ctr.lat) * M_GRADO));
  const sigma = Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length) || 0;
  const ok = muestras.filter((m, i) => sigma === 0 || d[i] <= 3 * sigma);
  ctr = media(ok);
  const mLon = M_GRADO * Math.cos(ctr.lat * D2R);
  let s2 = 0; for (const m of ok) { const dy = (m.lat - ctr.lat) * M_GRADO, dx = (m.lon - ctr.lon) * mLon; s2 += dx * dx + dy * dy; }
  const n = ok.length;
  const prom = sel => { const v = ok.map(sel).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return { lat: ctr.lat, lon: ctr.lon, desv: Math.sqrt(s2 / (n > 1 ? n - 1 : 1)), n, descartadas: muestras.length - n, accMedia: prom(m => m.acc), altitud: prom(m => m.alt) };
}

/* --- Panel Marcar punto --- */
export function panelCaptura() {
  const pl = S.ajustes.plantillas || [];
  const modoP = ['geo', 'crtm05', 'ln', 'ls'].includes(S.ajustes.proyeccion) ? S.ajustes.proyeccion : 'crtm05';
  const cuerpo = abrirPanel('Marcar punto', `
    <div class="fila2"><button class="mini" id="kGps">📡 Mi GPS</button><button class="mini borde" id="kMan">✎ Ingresar coordenadas</button></div>
    <div id="kCajaGps"><div class="nota" id="kEstado">Esperando GPS…</div><table class="coords" id="kCoords"></table></div>
    <div id="kCajaMan" hidden>
      <label>Proyección de entrada</label>
      <select id="kProy"><option value="geo">Geográficas (lat, lon)</option><option value="crtm05">CRTM05 · EPSG:5367 (X, Y)</option>
      <option value="ln">Lambert Norte · EPSG:5456 (X, Y)</option><option value="ls">Lambert Sur · EPSG:5457 (X, Y)</option></select>
      <div class="fila2"><div><label id="kLA">Latitud</label><input id="kA" inputmode="decimal"></div><div><label id="kLB">Longitud</label><input id="kB" inputmode="decimal"></div></div>
      <button class="ancho borde" id="kIr">Ir al punto en el mapa</button>
      <div class="nota">Escribí la coordenada en la proyección elegida y tocá <b>Ir al punto</b> para verla. Al guardar, el punto se crea ahí (fuente: manual).</div>
    </div>
    <label>Nombre</label><input id="kNombre" value="${esc(siguienteNombre())}" autocomplete="off">
    <label>Descripción</label><textarea id="kNota" placeholder="Naciente, punto de aforo, testigo…"></textarea>
    ${pl.length ? `<label>Formulario de captura</label><select id="kPlant"><option value="">— Sin formulario —</option>
      ${pl.map(t => `<option value="${t.id}" ${t.id === S.ajustes.plantillaActiva ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>` : ''}
    <div id="kCampos"></div>
    <label>Fotos del punto</label><input type="file" id="kFotos" accept="image/*" multiple>
    <div class="nota">En iPhone podés elegir "Tomar foto" o "Fototeca". La foto lleva impreso el nombre, las coordenadas y la fecha.</div>
    <button class="ancho" id="kGuardar">Guardar ahora (instantáneo)</button>
    <label>Promediar (quedarse quieto)</label>
    <select id="kDur"><option value="30">30 segundos</option><option value="60" selected>60 segundos</option><option value="120">2 minutos</option><option value="300">5 minutos</option></select>
    <button class="ancho borde" id="kProm">Promediar quieto</button>
    <div class="nota">Promediar junta varias lecturas del GPS y reduce el ruido. Mejor al aire libre, lejos de paredes y árboles. Mantené la pantalla encendida.</div>`);
  const $ = s => cuerpo.querySelector(s);
  let manual = false;

  // Cambio GPS / manual
  $('#kGps').onclick = () => { manual = false; $('#kCajaGps').hidden = false; $('#kCajaMan').hidden = true; $('#kGps').classList.remove('borde'); $('#kMan').classList.add('borde'); };
  $('#kMan').onclick = () => { manual = true; $('#kCajaGps').hidden = true; $('#kCajaMan').hidden = false; $('#kMan').classList.remove('borde'); $('#kGps').classList.add('borde'); };
  const sel = $('#kProy'); sel.value = modoP;
  const etiquetas = () => {
    const g = sel.value === 'geo';
    $('#kLA').textContent = g ? 'Latitud' : 'X / Este (m)'; $('#kLB').textContent = g ? 'Longitud' : 'Y / Norte (m)';
    $('#kA').placeholder = g ? '10.34567' : '477250'; $('#kB').placeholder = g ? '-84.43119' : '1110500';
  };
  sel.onchange = etiquetas; etiquetas();
  const resolverManual = () => {
    const a = parseFloat($('#kA').value.replace(',', '.')), b = parseFloat($('#kB').value.replace(',', '.'));
    if (!isFinite(a) || !isFinite(b)) { toast('Escribí las dos coordenadas.'); return null; }
    const ll = sel.value === 'geo' ? { lat: a, lon: b } : haciaWgs(a, b, sel.value);
    if (!ll || !isFinite(ll.lat) || Math.abs(ll.lat) > 90 || Math.abs(ll.lon) > 180) { toast('Coordenada fuera de rango. Revisá la proyección elegida.'); return null; }
    return ll;
  };
  $('#kIr').onclick = () => { const r = resolverManual(); if (!r) return; S.seguir = false; irA(r.lat, r.lon, Math.max(vista.zoom, 18)); toast('Mapa centrado en el punto. Tocá Guardar para marcarlo.'); };

  // Plantilla
  const selPl = $('#kPlant');
  const camposPlantilla = () => { $('#kCampos').innerHTML = htmlCampos(selPl ? selPl.value : null); };
  if (selPl) selPl.onchange = async () => { await cambiarAjuste('plantillaActiva', selPl.value || null); camposPlantilla(); };
  camposPlantilla();

  // Estado del GPS en vivo
  const est = $('#kEstado');
  const refrescar = () => {
    const f = S.fix;
    if (!f) { est.className = 'nota aviso'; est.textContent = 'Esperando señal del GPS…'; return; }
    const cl = clasePrecision(f.precision);
    est.className = 'nota ' + (cl === 'bien' ? 'ok' : cl === 'medio' ? 'aviso' : 'mal');
    est.innerHTML = `Precisión actual: <b>${textoPrecision(f.precision)}</b>` + (f.precision > PRECISION_LIMITE ? ` — peor que ${PRECISION_LIMITE} m, conviene esperar.` : '');
    const t = textoCoord(f.lat, f.lon, S.ajustes.proyeccion);
    const c = aCRTM05(f.lat, f.lon);
    $('#kCoords').innerHTML = `<tr><td>${PROY[S.ajustes.proyeccion].nom}</td><td>${t.a}<br>${t.b}</td></tr>` +
      (S.ajustes.proyeccion !== 'crtm05' ? `<tr><td>CRTM05</td><td>X ${c.x.toFixed(2)}<br>Y ${c.y.toFixed(2)}</td></tr>` : '') +
      `<tr><td>Altura (GPS)</td><td>${f.altitud != null ? f.altitud.toFixed(1) + ' m' : 'no disponible'}</td></tr>`;
  };
  refrescar();
  const quitar = alCambiarPosicion(() => { if (!est.isConnected || document.getElementById('panel').hidden) { quitar(); return; } refrescar(); });

  // Datos comunes (nombre, nota, plantilla, fotos)
  const datosComunes = () => {
    const dp = leerCampos(selPl ? selPl.value : null, cuerpo);
    if (!dp) return null;
    return { nombre: ($('#kNombre').value.trim() || siguienteNombre()).slice(0, 80), nota: $('#kNota').value.trim(),
      ...dp, archivosFoto: [...$('#kFotos').files, ...dp.archivosFoto] };
  };

  $('#kGuardar').onclick = async () => {
    const dc = datosComunes(); if (!dc) return;
    let base;
    if (manual) {
      const r = resolverManual(); if (!r) return;
      base = { lat: r.lat, lon: r.lon, precision: null, altitud: null, fuente: 'manual' };
    } else {
      const f = S.fix ? { ...S.fix } : null;   // posición en el momento de tocar "Guardar"
      if (!f) { alerta('Sin posición', 'Todavía no hay señal del GPS. Esperá a que aparezca la precisión arriba a la derecha, o usá "Ingresar coordenadas".'); return; }
      if (Date.now() - f.t > 60000 && !await confirmar('Posición vieja', 'La última posición del GPS tiene más de un minuto. Puede que ya no estés ahí. ¿Guardar igual?', 'Guardar igual', 'Esperar')) return;
      if (f.precision > PRECISION_LIMITE && !await confirmar('Precisión baja',
        `La precisión ahora es <b>${textoPrecision(f.precision)}</b>, peor que ${PRECISION_LIMITE} m.<br>El punto real puede estar a esa distancia de lo que se guarde.<br><br>¿Guardar igual o esperar a que mejore?`,
        'Guardar igual', 'Esperar')) return;
      base = { lat: f.lat, lon: f.lon, precision: Math.round(f.precision * 10) / 10, altitud: f.altitud != null ? Math.round(f.altitud * 10) / 10 : null, fuente: 'gps' };
    }
    await guardarPunto(base, dc);
  };

  $('#kProm').onclick = () => {
    if (manual) { toast('Promediar es solo con el GPS. En modo manual tocá Guardar.'); return; }
    const dc = datosComunes(); if (!dc) return;
    promediar(dc, +$('#kDur').value || 60);
  };
}

async function guardarPunto(base, dc, extra = {}) {
  const c = aCRTM05(base.lat, base.lon);
  const fecha = new Date();
  const info = { nombre: dc.nombre, lat: base.lat, lon: base.lon, x: c.x, y: c.y, fecha: fecha.toLocaleString('es-CR') };
  const fotos = [];
  for (const a of dc.archivosFoto) fotos.push(await prepararFoto(a, info));
  const punto = { id: nuevoId(), nombre: dc.nombre, nota: dc.nota, fecha: fecha.toISOString(),
    lat: +base.lat.toFixed(8), lon: +base.lon.toFixed(8), x: c.x, y: c.y,
    precision: base.precision, altitud: base.altitud, fuente: base.fuente,
    plantilla: dc.plantilla, datos: dc.datos, fotos, ...extra };
  try { await guardar('puntos', punto); }
  catch (e) { alerta('No se pudo guardar', 'El celular no permitió guardar el punto (' + esc(e.message || e) + '). Puede que el almacenamiento esté lleno.'); return; }
  S.puntos.push(punto);
  document.dispatchEvent(new Event('datos-cambiados'));
  cerrarPanel(); pedirDibujo();
  toast(`Punto ${punto.nombre} guardado` + (punto.precision != null ? ` (${textoPrecision(punto.precision)})` : ' (manual)') + (fotos.length ? ` · ${fotos.length} foto(s)` : '') + '.');
}

function promediar(dc, segundos) {
  const muestras = [], t0 = Date.now();
  let terminado = false, reloj = null;
  const cuerpo = abrirPanel('Promediando: ' + dc.nombre, '<div id="ocu"></div>');
  const quitar = alCambiarPosicion(f => muestras.push({ lat: f.lat, lon: f.lon, acc: f.precision, alt: f.altitud }));
  if (S.fix && Date.now() - S.fix.t < 3000) muestras.push({ lat: S.fix.lat, lon: S.fix.lon, acc: S.fix.precision, alt: S.fix.altitud });
  const fin = async guardarlo => {
    if (terminado) return; terminado = true;
    clearInterval(reloj); quitar();
    if (!guardarlo) { cerrarPanel(); toast('Promedio cancelado.'); return; }
    const r = calcularPromedio(muestras);
    if (!r) { cerrarPanel(); toast('No llegaron lecturas del GPS. Cancelado.'); return; }
    await guardarPunto({ lat: r.lat, lon: r.lon, precision: Math.round((r.accMedia ?? r.desv) * 10) / 10, altitud: r.altitud != null ? Math.round(r.altitud * 10) / 10 : null, fuente: 'gps' },
      dc, { promediado: true, muestras: r.n, desvStd: Math.round(r.desv * 100) / 100, duracion: segundos });
  };
  const pintar = () => {
    const caja = cuerpo.querySelector('#ocu'); if (!caja) return;
    const seg = Math.round((Date.now() - t0) / 1000), r = calcularPromedio(muestras);
    const t = r ? textoCoord(r.lat, r.lon, S.ajustes.proyeccion) : null;
    caja.innerHTML = `<div class="progreso"><i style="width:${Math.min(100, seg / segundos * 100).toFixed(0)}%"></i></div>
      <div class="s">${seg} s / ${segundos} s · ${muestras.length} lecturas</div>
      ${r ? `<table class="coords"><tr><td>${PROY[S.ajustes.proyeccion].nom} (media)</td><td>${t.a}<br>${t.b}</td></tr>
        <tr><td>Desviación estándar</td><td>± ${r.desv.toFixed(2)} m</td></tr>
        <tr><td>Lecturas usadas</td><td>${r.n} (descartadas ${r.descartadas})</td></tr></table>` : '<div class="vacio">Esperando lecturas…</div>'}
      <div class="nota aviso">⚠ Promediar reduce el ruido, NO el error por rebote de la señal en paredes o árboles. Una desviación baja no garantiza exactitud.</div>
      <button class="ancho" id="oGuardar">Detener y guardar ahora</button><button class="ancho borde" id="oCancelar">Cancelar</button>`;
    caja.querySelector('#oGuardar').onclick = () => fin(true);
    caja.querySelector('#oCancelar').onclick = () => fin(false);
    if (seg >= segundos) fin(true);
  };
  reloj = setInterval(() => { if (document.getElementById('panel').hidden) { fin(false); return; } pintar(); }, 500);
  pintar();
}

/* =======================================================================
   EXPORTAR PUNTOS: CSV, GPX, GeoJSON, KML y DXF (CAD)
   Los archivos se generan en el celular; no se sube nada.
   - CSV en el sistema elegido (CRTM05 por defecto), listo para QGIS.
   - GPX, GeoJSON y KML van en latitud/longitud (así lo exige cada
     formato), con X/Y CRTM05 como atributos.
   - DXF en metros del sistema elegido, para AutoCAD/Civil/QGIS.
   Las fotos no van en estos archivos (sí van en la copia de seguridad).
   ======================================================================= */
import { S } from './estado.js';
import { abrirPanel, descargar, esc, toast, fechaArchivo } from './ui.js';
import { desdeWgs, PROY } from './geodesia.js';

const ordenados = () => [...S.puntos].sort((a, b) => a.fecha.localeCompare(b.fecha));
const camposDatos = () => { const k = []; for (const p of S.puntos) for (const x of Object.keys(p.datos || {})) if (!k.includes(x)) k.push(x); return k; };
const tipo = p => p.promediado ? 'promediado' : 'instantaneo';

export function puntosAGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: ordenados().map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { nombre: p.nombre, nota: p.nota, fecha: p.fecha, x_crtm05: p.x, y_crtm05: p.y, precision_m: p.precision,
        altitud_m: p.altitud ?? null, tipo: tipo(p), muestras: p.muestras ?? null, desv_std_m: p.desvStd ?? null,
        fuente: p.fuente || 'gps', plantilla: p.plantilla || null, fotos: (p.fotos || []).length, ...(p.datos || {}) }
    }))
  };
}

export function puntosAKML() {
  const marcas = ordenados().map(p => {
    const extra = { x_crtm05: p.x, y_crtm05: p.y, precision_m: p.precision ?? '', altitud_m: p.altitud ?? '', tipo: tipo(p), fecha: p.fecha, ...(p.datos || {}) };
    return `  <Placemark>
    <name>${esc(p.nombre)}</name>
    <description>${esc(p.nota)}</description>
    <TimeStamp><when>${p.fecha}</when></TimeStamp>
    <ExtendedData>
${Object.entries(extra).map(([k, v]) => `      <Data name="${esc(k)}"><value>${esc(v)}</value></Data>`).join('\n')}
    </ExtendedData>
    <Point><coordinates>${p.lon},${p.lat}${p.altitud != null ? ',' + p.altitud : ''}</coordinates></Point>
  </Placemark>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n  <name>Puntos GPS TICO Web</name>\n${marcas}\n</Document>\n</kml>\n`;
}

export function puntosAGPX() {
  const wpts = ordenados().map(p => `<wpt lat="${p.lat}" lon="${p.lon}">${p.altitud != null ? `<ele>${p.altitud}</ele>` : ''}<time>${p.fecha}</time><name>${esc(p.nombre)}</name><desc>${esc(p.nota)}</desc></wpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GPS TICO Web" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>Puntos GPS TICO Web</name></metadata>\n${wpts}\n</gpx>\n`;
}

// Campo CSV seguro (comillas si hace falta).
function campo(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function puntosACSV(sis = 'crtm05') {
  const extra = camposDatos();
  const xy = sis === 'geo' ? ['latitud', 'longitud'] : [`x_${sis}`, `y_${sis}`];
  const enc = ['nombre', ...xy, ...(sis !== 'geo' ? ['latitud', 'longitud'] : []), 'precision_m', 'altitud_m', 'tipo', 'muestras', 'desv_std_m', 'fuente', 'fecha', 'descripcion', 'plantilla', ...extra, ...(sis !== 'geo' ? ['epsg'] : [])];
  const filas = ordenados().map(p => {
    const c = sis === 'geo' ? [p.lat.toFixed(8), p.lon.toFixed(8)] : (q => [q.e.toFixed(3), q.n.toFixed(3)])(desdeWgs(p.lat, p.lon, sis));
    return [p.nombre, ...c, ...(sis !== 'geo' ? [p.lat.toFixed(8), p.lon.toFixed(8)] : []), p.precision ?? '', p.altitud ?? '', tipo(p), p.muestras ?? '', p.desvStd ?? '',
      p.fuente || 'gps', p.fecha, p.nota, p.plantilla || '', ...extra.map(k => (p.datos || {})[k] ?? ''), ...(sis !== 'geo' ? [PROY[sis].epsg] : [])].map(campo).join(',');
  });
  // ﻿ al inicio para que Excel reconozca las tildes.
  return '﻿' + enc.join(',') + '\r\n' + filas.join('\r\n') + '\r\n';
}

// DXF (ASCII R12) en metros del sistema elegido: cada punto es POINT + TEXT con el nombre.
export function puntosADXF(sis = 'crtm05') {
  let s = '0\nSECTION\n2\nENTITIES\n';
  for (const p of ordenados()) {
    const q = desdeWgs(p.lat, p.lon, sis);
    s += `0\nPOINT\n8\nPUNTOS\n10\n${q.e.toFixed(3)}\n20\n${q.n.toFixed(3)}\n30\n0\n`;
    s += `0\nTEXT\n8\nPUNTOS\n10\n${(q.e + 1).toFixed(3)}\n20\n${(q.n + 1).toFixed(3)}\n30\n0\n40\n3\n1\n${String(p.nombre).replace(/[\r\n]/g, ' ')}\n`;
  }
  return s + '0\nENDSEC\n0\nEOF\n';
}

export function panelExportar() {
  const n = S.puntos.length;
  const cuerpo = abrirPanel('Exportar puntos', `
    <div class="nota">${n} punto(s). En iPhone se abre el menú Compartir: elegí <b>Guardar en Archivos</b>, AirDrop o correo.</div>
    <label>Sistema para el CSV</label>
    <select id="xSis"><option value="crtm05">CRTM05 (EPSG:5367)</option><option value="ln">Lambert Norte (EPSG:5456)</option><option value="ls">Lambert Sur (EPSG:5457)</option><option value="geo">Geográficas (WGS84)</option></select>
    <button class="ancho" id="xCsv">Descargar CSV</button>
    <button class="ancho borde" id="xGpx">Descargar GPX</button>
    <button class="ancho borde" id="xGeo">Descargar GeoJSON (para QGIS)</button>
    <button class="ancho borde" id="xKml">Descargar KML (Google Earth)</button>
    <label>Sistema para el DXF (CAD)</label>
    <select id="xDxfSis"><option value="crtm05">CRTM05 (EPSG:5367)</option><option value="ln">Lambert Norte (EPSG:5456)</option><option value="ls">Lambert Sur (EPSG:5457)</option></select>
    <button class="ancho borde" id="xDxf">Descargar DXF (AutoCAD / QGIS)</button>
    <div class="nota">En QGIS: el CSV se abre con "Capa de texto delimitado", X = <b>x_crtm05</b>, Y = <b>y_crtm05</b>, sistema <b>EPSG:5367</b>.
    GeoJSON, KML y GPX van en latitud/longitud (WGS84), como exigen esos formatos. <b>DWG</b> no se genera (es cerrado): abrí el DXF en AutoCAD y guardalo como DWG.</div>
    <div class="nota aviso">Las fotos no van en estos archivos. Para guardar todo (fotos incluidas) usá <b>Menú → Ajustes → Descargar copia</b>.</div>`);
  const nom = ext => `puntos-gps-tico-${fechaArchivo()}.${ext}`;
  const hay = () => { if (!S.puntos.length) { toast('No hay puntos para exportar.'); return false; } return true; };
  cuerpo.querySelector('#xCsv').onclick = () => { if (hay()) { const s = cuerpo.querySelector('#xSis').value; descargar(nom(s === 'crtm05' ? 'csv' : s + '.csv'), puntosACSV(s), 'text/csv'); } };
  cuerpo.querySelector('#xGpx').onclick = () => { if (hay()) descargar(nom('gpx'), puntosAGPX(), 'application/gpx+xml'); };
  cuerpo.querySelector('#xGeo').onclick = () => { if (hay()) descargar(nom('geojson'), JSON.stringify(puntosAGeoJSON(), null, 1), 'application/geo+json'); };
  cuerpo.querySelector('#xKml').onclick = () => { if (hay()) descargar(nom('kml'), puntosAKML(), 'application/vnd.google-earth.kml+xml'); };
  cuerpo.querySelector('#xDxf').onclick = () => { if (hay()) { const s = cuerpo.querySelector('#xDxfSis').value; descargar(`puntos-gps-tico-${fechaArchivo()}_${s}.dxf`, puntosADXF(s), 'application/dxf'); } };
}

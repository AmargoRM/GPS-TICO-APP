/* =======================================================================
   EXPORTAR PUNTOS: GeoJSON, KML y CSV
   Los archivos se generan en el celular y se descargan; no se sube nada.
   - GeoJSON y KML van en latitud/longitud (así lo exige cada formato),
     con X/Y CRTM05 como atributos.
   - CSV lleva X/Y en CRTM05 (y también lat/lon), listo para QGIS.
   Las fotos no van en estos archivos (sí van en la copia de seguridad).
   ======================================================================= */
import { S } from './estado.js';
import { abrirPanel, descargar, esc, toast, fechaArchivo } from './ui.js';

const ordenados = () => [...S.puntos].sort((a, b) => a.fecha.localeCompare(b.fecha));

export function puntosAGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: ordenados().map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { nombre: p.nombre, nota: p.nota, fecha: p.fecha, x_crtm05: p.x, y_crtm05: p.y,
                    precision_m: p.precision, tiene_foto: !!p.foto }
    }))
  };
}

export function puntosAKML() {
  const marcas = ordenados().map(p => `  <Placemark>
    <name>${esc(p.nombre)}</name>
    <description>${esc(p.nota)}</description>
    <TimeStamp><when>${p.fecha}</when></TimeStamp>
    <ExtendedData>
      <Data name="x_crtm05"><value>${p.x}</value></Data>
      <Data name="y_crtm05"><value>${p.y}</value></Data>
      <Data name="precision_m"><value>${p.precision ?? ''}</value></Data>
      <Data name="fecha"><value>${p.fecha}</value></Data>
    </ExtendedData>
    <Point><coordinates>${p.lon},${p.lat}</coordinates></Point>
  </Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Puntos GPS TICO Web</name>
${marcas}
</Document>
</kml>
`;
}

// Campo CSV seguro (comillas si hace falta).
function campo(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function puntosACSV() {
  const enc = ['nombre', 'x_crtm05', 'y_crtm05', 'latitud', 'longitud', 'precision_m', 'fecha', 'nota'];
  const filas = ordenados().map(p => [p.nombre, p.x.toFixed(3), p.y.toFixed(3), p.lat.toFixed(8), p.lon.toFixed(8),
    p.precision ?? '', p.fecha, p.nota].map(campo).join(','));
  // ﻿ al inicio para que Excel reconozca las tildes.
  return '﻿' + enc.join(',') + '\r\n' + filas.join('\r\n') + '\r\n';
}

export function panelExportar() {
  const n = S.puntos.length;
  const cuerpo = abrirPanel('Exportar puntos', `
    <div class="nota">${n} punto(s). Los archivos se guardan en Descargas (o el celular te pregunta dónde).</div>
    <button class="ancho" id="xGeo">GeoJSON (.geojson)</button>
    <button class="ancho" id="xKml">KML (.kml) — Google Earth</button>
    <button class="ancho" id="xCsv">CSV (.csv) — X/Y en CRTM05</button>
    <div class="nota">En QGIS: el CSV se abre con "Capa de texto delimitado", X = <b>x_crtm05</b>, Y = <b>y_crtm05</b>,
    sistema <b>EPSG:5367</b>. El GeoJSON y el KML van en latitud/longitud (WGS84), como exigen esos formatos.</div>
    <div class="nota aviso">Las fotos no van en estos archivos. Para guardar todo (fotos incluidas) usá
    <b>Ajustes → Descargar copia</b>.</div>`);
  const nombre = ext => `puntos-gps-tico-${fechaArchivo()}.${ext}`;
  const sinPuntos = () => { if (!S.puntos.length) { toast('No hay puntos para exportar.'); return true; } return false; };
  cuerpo.querySelector('#xGeo').onclick = () => { if (!sinPuntos()) descargar(nombre('geojson'), JSON.stringify(puntosAGeoJSON(), null, 1), 'application/geo+json'); };
  cuerpo.querySelector('#xKml').onclick = () => { if (!sinPuntos()) descargar(nombre('kml'), puntosAKML(), 'application/vnd.google-earth.kml+xml'); };
  cuerpo.querySelector('#xCsv').onclick = () => { if (!sinPuntos()) descargar(nombre('csv'), puntosACSV(), 'text/csv;charset=utf-8'); };
}

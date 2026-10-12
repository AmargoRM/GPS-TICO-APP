// Prueba automática de la revisión de copias de seguridad.
// Cómo correrla: node web/pruebas/copia.test.mjs
// Comprueba que una copia correcta se acepta y que cada tipo de daño se rechaza.
import { validarCopia, prepararRestauracion } from '../js/copia.js';

const base = () => ({
  app: 'gps-tico-web', version: 2, fecha: '2026-10-12T10:00:00.000Z',
  capas: [
    { id: 'c1', nombre: 'Lotes', tipo: 'vector', origen: 'archivo', formato: 'geojson', color: '#E0A458', fecha: '2026-10-01T00:00:00Z',
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-84.09, 9.93] } }] } },
    { id: 'c3', nombre: 'Fincas WFS', tipo: 'vector', origen: 'url', fuente: { tipo: 'wfs', url: 'https://ejemplo.cr/wfs', capaServicio: 'fincas' },
      geojson: { type: 'FeatureCollection', features: [] } },
    { id: 'c2', nombre: 'WMS', origen: 'url', tipo: 'wms', url: 'https://ejemplo.cr/wms', capaServicio: 'fincas' }
  ],
  puntos: [{ id: 'p1', nombre: 'P001', nota: '', fecha: '2026-10-12T09:00:00Z', lat: 9.9281, lon: -84.0907,
    x: 490054.522, y: 1097793.719, precision: 4, fotos: ['data:image/png;base64,iVBORw0KGgo='], datos: { estado: 'bueno' } }],
  ajustes: { proyeccion: 'crtm05', capasVisibles: ['c1'], fondo: 'sat', ultimaCopia: null, vista: { lat: 9.9, lon: -84, zoom: 12 },
    plantillas: [{ id: 't1', nombre: 'Poste', campos: [{ clave: 'estado', tipo: 'text' }] }], radioConsulta: 30 }
});
// Copia de la versión 1 (formato anterior): debe aceptarse y convertirse.
const v1 = () => ({ app: 'gps-tico-web', version: 1, fecha: '2026-10-12T10:00:00.000Z',
  capas: [{ id: 'c1', nombre: 'URL', origen: 'url', tipo: 'geojson', url: 'https://x.cr/a.geojson' },
          { id: 'c2', nombre: 'Archivo', origen: 'archivo', geojson: { type: 'FeatureCollection', features: [] } }],
  puntos: [{ id: 'p1', nombre: 'P1', nota: '', fecha: '2026-10-12T09:00:00Z', lat: 9.9, lon: -84, x: 500000, y: 1094000, precision: 3, foto: 'data:image/png;base64,iVBORw0KGgo=' }],
  ajustes: { proyeccion: 'crtm05' } });

const casos = [
  ['copia correcta', c => c, true],
  ['otra app', c => { c.app = 'otra'; }, false],
  ['sin fecha', c => { delete c.fecha; }, false],
  ['sin puntos', c => { delete c.puntos; }, false],
  ['latitud texto', c => { c.puntos[0].lat = '9.9'; }, false],
  ['latitud fuera de rango', c => { c.puntos[0].lat = 95; }, false],
  ['X CRTM05 falta', c => { delete c.puntos[0].x; }, false],
  ['foto dañada', c => { c.puntos[0].fotos = ['hola']; }, false],
  ['copia versión 1', () => v1(), true],
  ['versión 3', c => { c.version = 3; }, false],
  ['WFS con origen inválido', c => { c.capas[1].fuente.url = 'nada'; }, false],
  ['tipo de capa desconocido', c => { c.capas[0].tipo = 'raro'; }, false],
  ['plantillas dañadas', c => { c.ajustes.plantillas = [{ id: 1 }]; }, false],
  ['id repetido', c => { c.puntos.push({ ...c.puntos[0] }); }, false],
  ['capa con coordenadas dañadas', c => { c.capas[0].geojson.features[0].geometry.coordinates = ['a', 1]; }, false],
  ['capa URL sin https', c => { c.capas[2].url = 'ftp://x'; }, false],
  ['WMS sin capa', c => { c.capas[2].capaServicio = ''; }, false],
  ['ajuste desconocido', c => { c.ajustes.raro = 1; }, false],
  ['proyección inválida', c => { c.ajustes.proyeccion = 'utm'; }, false],
  ['no es objeto', () => [], false]
];

let fallas = 0;
for (const [nombre, cambiar, esperado] of casos) {
  let c = base(); const r0 = cambiar(c); if (r0 !== undefined) c = r0;
  const r = validarCopia(c);
  const ok = r.ok === esperado;
  if (!ok) fallas++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(30)} → ${r.ok ? 'aceptada' : 'rechazada: ' + r.errores[0]}`);
}
// La restauración convierte la foto de texto a imagen y marca la fecha de copia.
const prep = prepararRestauracion(validarCopia(base()).normalizada);
const prep1 = prepararRestauracion(validarCopia(v1()).normalizada);
const okPrep = prep.puntos[0].fotos[0] instanceof Blob && prep.ajustes.ultimaCopia === base().fecha
  && prep1.puntos[0].fotos.length === 1 && prep1.capas[0].tipo === 'vector' && prep1.capas[0].fuente.url === 'https://x.cr/a.geojson';
if (!okPrep) fallas++;
console.log(`${okPrep ? 'OK   ' : 'FALLA'} preparar restauración (fotos, fecha y versión 1)`);
console.log(fallas ? `\n${fallas} prueba(s) fallaron.` : '\nTodas las pruebas pasaron.');
process.exit(fallas ? 1 : 0);

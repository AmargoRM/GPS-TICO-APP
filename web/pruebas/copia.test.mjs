// Prueba automática de la revisión de copias de seguridad.
// Cómo correrla: node web/pruebas/copia.test.mjs
// Comprueba que una copia correcta se acepta y que cada tipo de daño se rechaza.
import { validarCopia, prepararRestauracion } from '../js/copia.js';

const base = () => ({
  app: 'gps-tico-web', version: 1, fecha: '2026-10-12T10:00:00.000Z',
  capas: [
    { id: 'c1', nombre: 'Lotes', origen: 'archivo', formato: 'geojson', color: '#E0A458', fecha: '2026-10-01T00:00:00Z',
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-84.09, 9.93] } }] } },
    { id: 'c2', nombre: 'WMS', origen: 'url', tipo: 'wms', url: 'https://ejemplo.cr/wms', capaServicio: 'fincas' }
  ],
  puntos: [{ id: 'p1', nombre: 'P001', nota: '', fecha: '2026-10-12T09:00:00Z', lat: 9.9281, lon: -84.0907,
    x: 490054.522, y: 1097793.719, precision: 4, foto: 'data:image/png;base64,iVBORw0KGgo=' }],
  ajustes: { proyeccion: 'crtm05', capasVisibles: ['c1'], fondo: 'sat', ultimaCopia: null, vista: { lat: 9.9, lon: -84, zoom: 12 } }
});

const casos = [
  ['copia correcta', c => c, true],
  ['otra app', c => { c.app = 'otra'; }, false],
  ['versión 2', c => { c.version = 2; }, false],
  ['sin fecha', c => { delete c.fecha; }, false],
  ['sin puntos', c => { delete c.puntos; }, false],
  ['latitud texto', c => { c.puntos[0].lat = '9.9'; }, false],
  ['latitud fuera de rango', c => { c.puntos[0].lat = 95; }, false],
  ['X CRTM05 falta', c => { delete c.puntos[0].x; }, false],
  ['foto dañada', c => { c.puntos[0].foto = 'hola'; }, false],
  ['id repetido', c => { c.puntos.push({ ...c.puntos[0] }); }, false],
  ['capa con coordenadas dañadas', c => { c.capas[0].geojson.features[0].geometry.coordinates = ['a', 1]; }, false],
  ['capa URL sin https', c => { c.capas[1].url = 'ftp://x'; }, false],
  ['WMS sin capa', c => { c.capas[1].capaServicio = ''; }, false],
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
const prep = prepararRestauracion(base());
const okPrep = prep.puntos[0].foto instanceof Blob && prep.ajustes.ultimaCopia === base().fecha;
if (!okPrep) fallas++;
console.log(`${okPrep ? 'OK   ' : 'FALLA'} preparar restauración (foto y fecha)`);
console.log(fallas ? `\n${fallas} prueba(s) fallaron.` : '\nTodas las pruebas pasaron.');
process.exit(fallas ? 1 : 0);

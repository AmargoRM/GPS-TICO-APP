// Prueba automática de las proyecciones.
// Cómo correrla (en una computadora con Node.js): node web/pruebas/geodesia.test.mjs
//
// Los valores esperados se calcularon con PROJ, el motor de coordenadas que usa QGIS,
// eligiendo el MISMO cambio de datum que usa la app (y el GPS TICO original):
//   - CRTM05: "CR05 to WGS 84 (1)" (WGS84 y CR05 se toman como iguales).
//   - Lambert: "Ocotepeque 1935 to WGS 84 (1)" (Helmert de 7 parámetros).
// Ojo: QGIS a veces elige por defecto otra transformación ("(2)"). Con esa,
// CRTM05 cambia hasta ~25 cm y Lambert hasta ~2 m. Ver README.
import { desdeWgs, haciaWgs } from '../js/geodesia.js';

const casos = [
  // [lon, lat, sistema, X esperado, Y esperado]
  [-84.0907, 9.9281, 'crtm05', 490054.522, 1097793.719],   // San José
  [-85.4377, 10.6346, 'crtm05', 342687.180, 1176294.571],   // Liberia
  [-83.0325, 9.9913, 'crtm05', 606073.067, 1104937.449],    // Limón
  [-82.9, 8.6, 'crtm05', 621078.751, 951088.884],           // Zona sur
  [-84.0907, 9.9281, 'ln', 526395.265, 212422.072],
  [-85.4377, 10.6346, 'ln', 378951.110, 290767.388],
  [-83.0325, 9.9913, 'ln', 642413.052, 219696.365],
  [-84.0907, 9.9281, 'ls', 453281.678, 430816.845],
  [-83.0325, 9.9913, 'ls', 569326.664, 437841.334],
  [-82.9, 8.6, 'ls', 584178.071, 283986.246]
];

let fallas = 0;
for (const [lon, lat, modo, xe, ye] of casos) {
  const p = desdeWgs(lat, lon, modo);
  const dif = Math.hypot(p.e - xe, p.n - ye);
  // Ida y vuelta: convertir y regresar debe dar el mismo punto.
  const w = haciaWgs(p.e, p.n, modo);
  const vuelta = Math.hypot((w.lat - lat) * 111320, (w.lon - lon) * 111320);
  // CRTM05 debe coincidir al centímetro; Lambert a menos de 10 cm.
  const tol = modo === 'crtm05' ? 0.01 : 0.10;
  const ok = dif <= tol && vuelta < 0.01;
  if (!ok) fallas++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${modo.padEnd(6)} ${lat},${lon} → X ${p.e.toFixed(3)} Y ${p.n.toFixed(3)}  diferencia ${dif.toFixed(3)} m  ida-vuelta ${vuelta.toFixed(4)} m`);
}
console.log(fallas ? `\n${fallas} prueba(s) fallaron.` : '\nTodas las pruebas pasaron.');
process.exit(fallas ? 1 : 0);

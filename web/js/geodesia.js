/* =======================================================================
   GEODESIA — proyecciones de Costa Rica
   Copiado del GPS TICO original (fórmulas probadas). Escrito a mano, sin
   librerías, para que funcione 100 % sin internet.
   Fórmulas: Snyder / EPSG guidance note 7-2.

   Sistemas que maneja:
   - geo    : latitud/longitud WGS84 (lo que da el GPS del celular)
   - crtm05 : CRTM05 (EPSG:5367), la proyección oficial actual
   - ln     : Lambert Norte (EPSG:5456), datum Ocotepeque 1935
   - ls     : Lambert Sur  (EPSG:5457), datum Ocotepeque 1935
   ======================================================================= */

export const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// Elipsoides: tamaño (a) y achatamiento (f) de la Tierra según cada datum.
const ELI = {
  wgs84:    { a: 6378137.0, f: 1 / 298.257223563 },
  clarke66: { a: 6378206.4, f: 1 / 294.978698213898 }
};

// --- Transversa de Mercator (EPSG 9807): la base de CRTM05 ---
export function tmFwd(lat, lon, P) {
  const { a, f } = P.eli, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
  const phi = lat * D2R, lam = lon * D2R, lam0 = P.lon0 * D2R, phi0 = P.lat0 * D2R;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = (lam - lam0) * Math.cos(phi);
  const M = meridArc(phi, a, e2);
  const M0 = meridArc(phi0, a, e2);
  const x = P.fe + P.k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = P.fn + P.k0 * (M - M0 + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
            + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return { e: x, n: y };
}
export function tmInv(x, y, P) {
  const { a, f } = P.eli, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
  const lam0 = P.lon0 * D2R, phi0 = P.lat0 * D2R;
  const M = meridArc(phi0, a, e2) + (y - P.fn) / P.k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
           + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
           + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(p1) ** 2, 1.5);
  const D = (x - P.fe) / (N1 * P.k0);
  const phi = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
            + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lam = lam0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
            + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return { lat: phi * R2D, lon: lam * R2D };
}
function meridArc(phi, a, e2) {
  return a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
}

// --- Cónica Conforme de Lambert 1SP (EPSG 9801): base de Lambert Norte/Sur ---
function lccT(phi, e) {
  const s = e * Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - s) / (1 + s), e / 2);
}
function lccFwd(lat, lon, P) {
  const { a, f } = P.eli, e2 = 2 * f - f * f, e = Math.sqrt(e2);
  const phi = lat * D2R, lam = lon * D2R, phi0 = P.lat0 * D2R, lam0 = P.lon0 * D2R;
  const m0 = Math.cos(phi0) / Math.sqrt(1 - e2 * Math.sin(phi0) ** 2);
  const t0 = lccT(phi0, e), t = lccT(phi, e);
  const n = Math.sin(phi0);
  const F = m0 / (n * Math.pow(t0, n));
  const r = a * F * Math.pow(t, n) * P.k0;
  const r0 = a * F * Math.pow(t0, n) * P.k0;
  const th = n * (lam - lam0);
  return { e: P.fe + r * Math.sin(th), n: P.fn + r0 - r * Math.cos(th) };
}
function lccInv(x, y, P) {
  const { a, f } = P.eli, e2 = 2 * f - f * f, e = Math.sqrt(e2);
  const phi0 = P.lat0 * D2R, lam0 = P.lon0 * D2R;
  const m0 = Math.cos(phi0) / Math.sqrt(1 - e2 * Math.sin(phi0) ** 2);
  const t0 = lccT(phi0, e), n = Math.sin(phi0);
  const F = m0 / (n * Math.pow(t0, n));
  const r0 = a * F * Math.pow(t0, n) * P.k0;
  const dx = x - P.fe, dy = r0 - (y - P.fn);
  const rp = Math.sign(n) * Math.sqrt(dx * dx + dy * dy);
  const th = Math.atan2(Math.sign(n) * dx, Math.sign(n) * dy);
  const tp = Math.pow(rp / (a * F * P.k0), 1 / n);
  const lam = th / n + lam0;
  let phi = Math.PI / 2 - 2 * Math.atan(tp);
  for (let i = 0; i < 12; i++) {
    const s = e * Math.sin(phi);
    const np = Math.PI / 2 - 2 * Math.atan(tp * Math.pow((1 - s) / (1 + s), e / 2));
    if (Math.abs(np - phi) < 1e-12) { phi = np; break; }
    phi = np;
  }
  return { lat: phi * R2D, lon: lam * R2D };
}

// --- Cambio de datum Ocotepeque 1935 <-> CR05 (Helmert 7 parámetros) ---
// Es la misma transformación que usa QGIS por defecto (EPSG:6890).
// Rotaciones en segundos de arco, escala en partes por millón.
const OCO2CR05 = { dx: 213.116, dy: 9.358, dz: -74.946, rx: 1.14e-05, ry: -2.98e-07, rz: 3.1e-05, s: 5.22 };
const SEC2RAD = Math.PI / (180 * 3600);

function geo2ecef(lat, lon, h, eli) {
  const { a, f } = eli, e2 = 2 * f - f * f;
  const p = lat * D2R, l = lon * D2R;
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
}
function ecef2geo(X, Y, Z, eli) {
  const { a, f } = eli, e2 = 2 * f - f * f, b = a * (1 - f), ep2 = (a * a - b * b) / (b * b);
  const p = Math.hypot(X, Y), th = Math.atan2(Z * a, p * b);
  const lat = Math.atan2(Z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3);
  const lon = Math.atan2(Y, X);
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return { lat: lat * R2D, lon: lon * R2D, h: p / Math.cos(lat) - N };
}
function helmert(X, Y, Z, P, inv) {
  const rx = P.rx * SEC2RAD, ry = P.ry * SEC2RAD, rz = P.rz * SEC2RAD, s = P.s * 1e-6;
  if (!inv) {
    return [P.dx + (1 + s) * (X - rz * Y + ry * Z),
            P.dy + (1 + s) * (rz * X + Y - rx * Z),
            P.dz + (1 + s) * (-ry * X + rx * Y + Z)];
  }
  const x = (X - P.dx) / (1 + s), y = (Y - P.dy) / (1 + s), z = (Z - P.dz) / (1 + s);
  return [x + rz * y - ry * z, -rz * x + y + rx * z, ry * x - rx * y + z];
}
function ocoToWgs(lat, lon) {
  const [X, Y, Z] = geo2ecef(lat, lon, 0, ELI.clarke66);
  const [A, B, C] = helmert(X, Y, Z, OCO2CR05, false);
  return ecef2geo(A, B, C, ELI.wgs84);
}
function wgsToOco(lat, lon) {
  const [X, Y, Z] = geo2ecef(lat, lon, 0, ELI.wgs84);
  const [A, B, C] = helmert(X, Y, Z, OCO2CR05, true);
  return ecef2geo(A, B, C, ELI.clarke66);
}

// --- Definiciones oficiales de Costa Rica ---
export const CRTM05 = { eli: ELI.wgs84, lat0: 0, lon0: -84, k0: 0.9999, fe: 500000, fn: 0 };
const LAM_N = { eli: ELI.clarke66, lat0: 10 + 28 / 60, lon0: -(84 + 20 / 60), k0: 0.99995696, fe: 500000, fn: 271820.522 };
const LAM_S = { eli: ELI.clarke66, lat0: 9, lon0: -(83 + 40 / 60), k0: 0.99995696, fe: 500000, fn: 327987.436 };

// Nombres para mostrar en pantalla.
export const PROY = {
  crtm05: { nom: 'CRTM05', largo: 'CRTM05 · EPSG:5367', epsg: 'EPSG:5367' },
  ln:     { nom: 'Lambert Norte', largo: 'Lambert Norte · EPSG:5456', epsg: 'EPSG:5456' },
  ls:     { nom: 'Lambert Sur', largo: 'Lambert Sur · EPSG:5457', epsg: 'EPSG:5457' },
  geo:    { nom: 'Geográficas', largo: 'Geográficas · WGS84', epsg: 'EPSG:4326' }
};

// De latitud/longitud (WGS84) al sistema pedido. Devuelve {e, n} en metros,
// o {lat, lon} si el sistema es 'geo'.
export function desdeWgs(lat, lon, modo) {
  if (modo === 'geo') return { lat, lon };
  if (modo === 'crtm05') return tmFwd(lat, lon, CRTM05);
  const o = wgsToOco(lat, lon);
  return lccFwd(o.lat, o.lon, modo === 'ln' ? LAM_N : LAM_S);
}
// Del sistema indicado a latitud/longitud WGS84.
export function haciaWgs(a, b, modo) {
  if (modo === 'geo') return { lat: b, lon: a };   // a = longitud (X), b = latitud (Y)
  if (modo === 'crtm05') return tmInv(a, b, CRTM05);
  const g = lccInv(a, b, modo === 'ln' ? LAM_N : LAM_S);
  return ocoToWgs(g.lat, g.lon);
}

// Atajo: X/Y en CRTM05 redondeados al milímetro.
export function aCRTM05(lat, lon) {
  const p = tmFwd(lat, lon, CRTM05);
  return { x: Math.round(p.e * 1000) / 1000, y: Math.round(p.n * 1000) / 1000 };
}

// Texto listo para mostrar: dos líneas con la coordenada en el sistema elegido.
export function textoCoord(lat, lon, modo) {
  if (modo === 'geo') return { a: `Lat ${lat.toFixed(6)}`, b: `Lon ${lon.toFixed(6)}` };
  const p = desdeWgs(lat, lon, modo);
  return { a: `X ${p.e.toFixed(2)}`, b: `Y ${p.n.toFixed(2)}` };
}

// Distancia en metros entre dos puntos (fórmula del haversine).
export function distM(a1, o1, a2, o2) {
  const R = 6371008.8, dp = (a2 - a1) * D2R, dl = (o2 - o1) * D2R;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(a1 * D2R) * Math.cos(a2 * D2R) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Rumbo inicial en grados (0 = norte, 90 = este) para ir del punto 1 al 2.
export function rumbo(a1, o1, a2, o2) {
  const p1 = a1 * D2R, p2 = a2 * D2R, dl = (o2 - o1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}
// Rumbo en palabras (N, NE, E…).
export function cardinal(g) {
  const n = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return n[Math.round(g / 45) % 8];
}
export function textoDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

// Caja aproximada de Costa Rica (con margen), para reconocer proyecciones ticas.
export const CR_CAJA = { latMin: 7.5, latMax: 11.7, lonMin: -86.5, lonMax: -82.0 };
export function dentroCR(lat, lon) {
  return lat >= CR_CAJA.latMin && lat <= CR_CAJA.latMax && lon >= CR_CAJA.lonMin && lon <= CR_CAJA.lonMax;
}

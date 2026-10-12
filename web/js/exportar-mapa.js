/* =======================================================================
   EXPORTAR MAPA (PNG o PDF georreferenciado) — copiado del original
   Exporta EXACTAMENTE la vista actual con marco, cuadrícula CRTM05 en el
   borde, flecha de norte, barra de escala, leyenda editable y fecha.
   El PDF lleva georreferencia (WGS84) para abrirse ubicado en QGIS o Avenza.
   Las imágenes de servidores que no dan permiso (CORS) no se pueden
   incluir: la app avisa cuáles quedaron fuera.
   ======================================================================= */
import { S, capaVisible } from './estado.js';
import { tmFwd, CRTM05, D2R } from './geodesia.js';
import { abrirPanel, descargar, esc, toast, cargando, fechaArchivo } from './ui.js';
import { pintar, vista, tamanoMapa, cajaDe, px2lon, px2lat } from './mapa.js';
import { esIOS } from './compat.js';

function pasoGrilla(rango) {
  const obj = Math.max(1e-6, rango / 6), p10 = Math.pow(10, Math.floor(Math.log10(obj)));
  for (const m of [1, 2, 2.5, 5, 10]) if (p10 * m >= obj) return p10 * m;
  return p10 * 10;
}
const fmtMetros = v => { v = Math.round(v); return (v < 0 ? '-' : '') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };

// Dibuja la página completa. Devuelve { canvas, geo, omitidas }.
function renderizar(titulo, leyenda) {
  const { W, H } = tamanoMapa();
  // Nitidez x2, pero sin pasarse del límite de tamaño de canvas del iPhone (~16 Mpx).
  let k = 2; while ((W * k + 120) * (H * k + 300) > (esIOS ? 15e6 : 30e6) && k > 1) k -= 0.25;
  const mW = Math.round(W * k), mH = Math.round(H * k);
  const padL = 84, padT = 72, padR = 34;
  const filasLey = Math.ceil(leyenda.length / 2), franja = 118 + filasLey * 34;
  const pW = padL + mW + padR, pH = padT + mH + franja;
  const cv = document.createElement('canvas'); cv.width = pW; cv.height = pH;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, pW, pH);
  // Mapa: se vuelve a pintar la vista en alta resolución.
  g.save(); g.translate(padL, padT); g.scale(k, k);
  g.beginPath(); g.rect(0, 0, W, H); g.clip();
  const t = pintar(g, W, H, { sinSucias: true, sinEscala: true });
  g.restore();
  g.strokeStyle = '#111'; g.lineWidth = 2; g.strokeRect(padL, padT, mW, mH);

  // Esquinas exactas de lo dibujado.
  const lonW = px2lon(t.x0, t.zi), lonE = px2lon(t.x0 + W / t.esc, t.zi), latN = px2lat(t.y0, t.zi), latS = px2lat(t.y0 + H / t.esc, t.zi);
  // Cuadrícula CRTM05 exterior (marcas y números en el marco).
  const esq = [tmFwd(latN, lonW, CRTM05), tmFwd(latN, lonE, CRTM05), tmFwd(latS, lonW, CRTM05), tmFwd(latS, lonE, CRTM05)];
  const Emin = Math.min(...esq.map(q => q.e)), Emax = Math.max(...esq.map(q => q.e)), Nmin = Math.min(...esq.map(q => q.n)), Nmax = Math.max(...esq.map(q => q.n));
  const paso = pasoGrilla(Math.max(Emax - Emin, Nmax - Nmin));
  const lonParaE = (lat, E) => { let a = lonW, b = lonE; for (let i = 0; i < 38; i++) { const m = (a + b) / 2; (tmFwd(lat, m, CRTM05).e < E) ? a = m : b = m; } return (a + b) / 2; };
  const latParaN = (lon, N) => { let a = latS, b = latN; for (let i = 0; i < 38; i++) { const m = (a + b) / 2; (tmFwd(m, lon, CRTM05).n < N) ? a = m : b = m; } return (a + b) / 2; };
  const PX = x => padL + x * k, PY = y => padT + y * k, TIC = 11;
  g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 1.5; g.font = '600 18px ui-monospace, monospace'; g.textAlign = 'center';
  for (let E = Math.ceil(Emin / paso) * paso; E <= Emax; E += paso) {
    const xt = t.aPant(latN, lonParaE(latN, E)).x, xb = t.aPant(latS, lonParaE(latS, E)).x;
    if (xt >= 0 && xt <= W) { const X = PX(xt); g.beginPath(); g.moveTo(X, padT); g.lineTo(X, padT - TIC); g.stroke(); g.textBaseline = 'bottom'; g.fillText(fmtMetros(E), X, padT - TIC - 3); }
    if (xb >= 0 && xb <= W) { const X = PX(xb); g.beginPath(); g.moveTo(X, padT + mH); g.lineTo(X, padT + mH + TIC); g.stroke(); g.textBaseline = 'top'; g.fillText(fmtMetros(E), X, padT + mH + TIC + 3); }
  }
  for (let N = Math.ceil(Nmin / paso) * paso; N <= Nmax; N += paso) {
    const yl = t.aPant(latParaN(lonW, N), lonW).y, yr = t.aPant(latParaN(lonE, N), lonE).y;
    if (yl >= 0 && yl <= H) { const Y = PY(yl); g.beginPath(); g.moveTo(padL, Y); g.lineTo(padL - TIC, Y); g.stroke(); g.save(); g.translate(padL - TIC - 4, Y); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(fmtMetros(N), 0, 0); g.restore(); }
    if (yr >= 0 && yr <= H) { const Y = PY(yr); g.beginPath(); g.moveTo(padL + mW, Y); g.lineTo(padL + mW + TIC, Y); g.stroke(); g.save(); g.translate(padL + mW + TIC + 4, Y); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(fmtMetros(N), 0, 0); g.restore(); }
  }
  // Cabecera
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  if (titulo) { g.fillStyle = '#111'; g.font = '700 26px system-ui'; g.fillText(titulo, padL, 40); }
  g.fillStyle = '#555'; g.font = '600 16px ui-monospace, monospace'; g.fillText('Cuadrícula CRTM05 · EPSG:5367 · m', padL, 62);
  // Franja inferior: norte, escala, leyenda, fecha
  const sy = padT + mH;
  g.strokeStyle = '#ccc'; g.lineWidth = 1; g.beginPath(); g.moveTo(padL, sy + 40); g.lineTo(pW - padR, sy + 40); g.stroke();
  const nx = padL + 16, ny = sy + 90;
  g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(nx, ny + 22); g.lineTo(nx, ny - 22); g.stroke();
  g.beginPath(); g.moveTo(nx, ny - 28); g.lineTo(nx - 7, ny - 14); g.lineTo(nx + 7, ny - 14); g.closePath(); g.fill();
  g.textAlign = 'center'; g.font = '700 18px system-ui'; g.fillText('N', nx, ny + 40);
  const mPorPx = 156543.03392 * Math.cos(vista.lat * D2R) / Math.pow(2, vista.zoom) / k;
  const obj = 150 * mPorPx, e10 = Math.pow(10, Math.floor(Math.log10(obj)));
  const metros = e10 * ([1, 2, 5, 10].find(x => e10 * x >= obj) || 10), barra = metros / mPorPx;
  const bx = nx + 70, by = sy + 96;
  g.lineWidth = 2.5; g.beginPath(); g.moveTo(bx, by - 8); g.lineTo(bx, by); g.lineTo(bx + barra, by); g.lineTo(bx + barra, by - 8); g.stroke();
  g.textAlign = 'left'; g.font = '600 15px ui-monospace, monospace'; g.fillText(metros >= 1000 ? (metros / 1000) + ' km' : metros + ' m', bx, by - 12);
  g.font = '600 16px system-ui';
  const lx0 = bx + barra + 60, colW = (pW - padR - lx0) / 2;
  leyenda.forEach((it, i) => {
    const ex = lx0 + (i % 2) * colW, ey = sy + 70 + Math.floor(i / 2) * 34;
    g.fillStyle = it.color || '#666'; g.strokeStyle = '#111'; g.lineWidth = 1;
    g.fillRect(ex, ey - 14, 20, 16); g.strokeRect(ex, ey - 14, 20, 16);
    g.fillStyle = '#111'; let nom = it.nombre || ''; if (nom.length > 28) nom = nom.slice(0, 27) + '…';
    g.fillText(nom, ex + 28, ey);
  });
  if (!leyenda.length) { g.fillStyle = '#888'; g.fillText('(sin capas activas en la vista)', lx0, sy + 72); }
  g.fillStyle = '#555'; g.textAlign = 'right'; g.font = '600 15px ui-monospace, monospace';
  g.fillText('Generado: ' + new Date().toLocaleString('es-CR'), pW - padR, pH - 14);
  return { canvas: cv, geo: { padL, padT, mW, mH, latN, latS, lonW, lonE }, omitidas: t.omitidas };
}

// PDF de una página con la imagen (JPEG) y georreferencia OGC (WGS84) para QGIS/GDAL y Avenza.
async function construirPDF(canvas, geo) {
  const blobJpg = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
  const jpg = new Uint8Array(await blobJpg.arrayBuffer());
  const iw = canvas.width, ih = canvas.height, PT = 72 / 150;
  const PW = +(iw * PT).toFixed(2), PH = +(ih * PT).toFixed(2);
  const bx0 = (geo.padL * PT).toFixed(2), bx1 = ((geo.padL + geo.mW) * PT).toFixed(2);
  const by1 = (PH - geo.padT * PT).toFixed(2), by0 = (PH - (geo.padT + geo.mH) * PT).toFixed(2);
  const gpts = [geo.latS, geo.lonW, geo.latN, geo.lonW, geo.latN, geo.lonE, geo.latS, geo.lonE].map(v => v.toFixed(8)).join(' ');
  const wkt = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';
  const vp = `/VP [ << /Type /Viewport /BBox [${bx0} ${by0} ${bx1} ${by1}] /Name (Mapa) /Measure << /Type /Measure /Subtype /GEO /Bounds [0 0 0 1 1 1 1 0] /GPTS [${gpts}] /LPTS [0 0 0 1 1 1 1 0] /GCS << /Type /GEOGCS /WKT (${wkt}) >> >> >> ]`;
  const contenido = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
  const enc = new TextEncoder(), partes = [], off = []; let largo = 0;
  const meter = s => { const b = typeof s === 'string' ? enc.encode(s) : s; partes.push(b); largo += b.length; };
  const obj = s => { off.push(largo); meter(s); };
  meter('%PDF-1.7\n');
  obj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  obj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  obj(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R ${vp} >>\nendobj\n`);
  obj(`4 0 obj\n<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream\nendobj\n`);
  off.push(largo);
  meter(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
  meter(jpg); meter('\nendstream\nendobj\n');
  const xref = largo;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 0; i < 5; i++) x += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  meter(x);
  meter(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(partes, { type: 'application/pdf' });
}

// Capas y puntos visibles dentro de la vista (para la leyenda).
function leyendaEnVista() {
  const { W, H } = tamanoMapa();
  const z = vista.zoom, cx = (vista.lon + 180) / 360 * 256 * 2 ** z;
  const s = Math.sin(vista.lat * D2R), cy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
  const b = { w: px2lon(cx - W / 2, z), e: px2lon(cx + W / 2, z), n: px2lat(cy - H / 2, z), s: px2lat(cy + H / 2, z) };
  const corta = k => !(k[2] < b.w || k[0] > b.e || k[3] < b.s || k[1] > b.n);
  const items = [];
  for (const c of S.capas) {
    if (!capaVisible(c.id)) continue;
    if (c.tipo === 'wms') items.push({ color: '#8899AA', nombre: c.nombre });
    else if (c.tipo === 'grande') { if (corta(c.grande.bb)) items.push({ color: c.color, nombre: c.nombre }); }
    else if (c.geojson && c.geojson.features.some(f => f.geometry && corta(cajaDe(f)))) items.push({ color: c.color, nombre: c.nombre });
  }
  if (S.puntos.some(p => p.visible !== false && p.lon >= b.w && p.lon <= b.e && p.lat >= b.s && p.lat <= b.n)) items.push({ color: '#DCE6E4', nombre: 'Puntos del proyecto' });
  return items;
}

export function panelExportarMapa() {
  const items = leyendaEnVista();
  const cuerpo = abrirPanel('Exportar mapa', `
    <div class="nota ok">Exporta <b>exactamente la vista actual</b> con cuadrícula CRTM05 en el borde, norte, escala, leyenda y fecha. Encuadrá la zona antes de generar.</div>
    <label>Título del mapa (opcional)</label><input id="emTit" placeholder="Dejalo en blanco si no querés título">
    <label>Formato</label><select id="emFmt"><option value="pdf">PDF georreferenciado (QGIS / Avenza)</option><option value="png">PNG (imagen)</option></select>
    <label>Leyenda (capas visibles en la vista) — editá los nombres</label>
    <div id="emLey">${items.length ? items.map((it, i) => `<div class="filaLey"><span class="color" style="background:${esc(it.color)}"></span><input data-ley="${i}" value="${esc(it.nombre)}"></div>`).join('') : '<div class="vacio">No hay capas activas dentro de la vista.</div>'}</div>
    <button class="ancho" id="emOk">Generar y guardar</button>
    <div class="nota">El PDF lleva georreferencia (WGS84) para abrirse ubicado en QGIS/Avenza; la <b>cuadrícula visible es CRTM05</b>. Las imágenes WMS de servidores que no lo permiten no se pueden incluir.</div>`);
  cuerpo.querySelector('#emOk').onclick = async () => {
    const titulo = cuerpo.querySelector('#emTit').value.trim(), fmt = cuerpo.querySelector('#emFmt').value;
    cuerpo.querySelectorAll('[data-ley]').forEach(i => { items[+i.dataset.ley].nombre = i.value; });
    cargando('Generando mapa…');
    try {
      const r = renderizar(titulo, items);
      const base = (titulo || 'mapa-' + fechaArchivo()).replace(/\s+/g, '_');
      const blob = fmt === 'png' ? await new Promise(ok => r.canvas.toBlob(ok, 'image/png')) : await construirPDF(r.canvas, r.geo);
      cargando(null);
      if (r.omitidas) toast(`${r.omitidas} cuadrito(s) de imagen no se incluyeron: el servidor no lo permite.`, 7000);
      await descargar(base + '.' + fmt, blob, fmt === 'png' ? 'image/png' : 'application/pdf');
    } catch (e) { toast('No se pudo generar: ' + (e.message || e)); }
    finally { cargando(null); }
  };
}

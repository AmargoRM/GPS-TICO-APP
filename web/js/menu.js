/* =======================================================================
   MENÚ ☰ (igual que la app Android)
   Agrupa las funciones que no entran en la barra de abajo.
   ======================================================================= */
import { S } from './estado.js';
import { abrirPanel } from './ui.js';
import { panelCapas } from './capas.js';
import { panelPuntos } from './puntos.js';
import { panelConvertir } from './herramientas.js';
import { panelOffline } from './offline.js';
import { panelExportar } from './exportar.js';
import { panelExportarMapa } from './exportar-mapa.js';
import { panelPlantillas } from './plantillas.js';
import { panelAjustes } from './ajustes.js';

export function panelMenu() {
  const opciones = [
    ['Capas del proyecto', `${S.capas.length} capa(s) · GeoJSON · KML · SHP · DXF · WFS · WMS`, panelCapas],
    ['Puntos', `${S.puntos.length} punto(s) · ver por día`, panelPuntos],
    ['Convertir coordenadas', 'Geo ↔ CRTM05 ↔ Lambert N/S', panelConvertir],
    ['Mapa sin conexión', 'Zonas y parches descargables', panelOffline],
    ['Exportar puntos', 'CSV · GPX · GeoJSON · KML · DXF', panelExportar],
    ['Exportar mapa', 'PDF georreferenciado · PNG · grilla CRTM05', panelExportarMapa],
    ['Plantillas de captura', `${(S.ajustes.plantillas || []).length} plantilla(s) · se eligen al marcar un punto`, panelPlantillas],
    ['⚙ Ajustes', 'Instalación, almacenamiento, copia de seguridad, borrar todo', panelAjustes]
  ];
  const cuerpo = abrirPanel('Menú', `<ul class="lista">${opciones.map(([t, s], i) =>
    `<li data-i="${i}"><div class="cuerpo-item"><div class="t">${t}</div><div class="s">${s}</div></div><button class="mini">Abrir</button></li>`).join('')}</ul>`);
  cuerpo.querySelectorAll('[data-i]').forEach(li => li.onclick = () => opciones[+li.dataset.i][2]());
}

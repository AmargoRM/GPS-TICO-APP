/* =======================================================================
   ESTADO COMPARTIDO
   Lo que la app tiene "en memoria" mientras está abierta. Lo permanente
   está en IndexedDB (ver bd.js); esto es una copia de trabajo.
   ======================================================================= */
import { guardarAjuste, leerTodos, leerAjustes, guardar } from './bd.js';

export const S = {
  capas: [],              // capas guardadas (cajón "capas"), en el orden de dibujo
  puntos: [],             // puntos guardados (cajón "puntos")
  ajustes: {},            // preferencias (cajón "ajustes")
  fix: null,              // última posición del GPS: {lat, lon, precision, altitud, rumboMov, velocidad, t}
  destino: null,          // punto hacia el que se navega
  seguir: true            // el mapa sigue mi posición
};

// Valores por defecto de los ajustes.
export const AJUSTES_DEFECTO = {
  proyeccion: 'crtm05',   // crtm05 | ln | ls | geo
  capasVisibles: [],      // ids de capas visibles
  fondo: 'sat',           // sat | calles | ninguno
  ultimaCopia: null,      // fecha (ISO) de la última copia descargada
  vista: null,            // último encuadre del mapa {lat, lon, zoom}
  plantillas: [],         // formularios de captura [{id, nombre, campos:[{clave, tipo, req, opciones}]}]
  plantillaActiva: null,  // id de la plantilla elegida por defecto al marcar
  radioConsulta: 30       // metros del "Consultar aquí" (mantener presionado)
};

// ¿Está visible esta capa? (la lista de visibles se guarda en ajustes)
export function capaVisible(id) {
  return (S.ajustes.capasVisibles || []).includes(id);
}

// Cambia un ajuste en memoria y lo guarda en el celular.
export async function cambiarAjuste(clave, valor) {
  S.ajustes[clave] = valor;
  await guardarAjuste(clave, valor);
}

// Capas guardadas por la versión 1 de la app → formato actual (igual a Android).
// Devuelve true si hubo que cambiar algo.
export function migrarCapa(c) {
  let cambio = false;
  if (c.origen === 'url' && (c.tipo === 'geojson' || c.tipo === 'wfs')) {
    c.fuente = { tipo: c.tipo, url: c.url, capaServicio: c.capaServicio || null };
    c.tipo = 'vector'; c.geojson = c.geojson || null;
    delete c.url; delete c.capaServicio; cambio = true;
  }
  if (c.origen === 'archivo' && !c.tipo) { c.tipo = 'vector'; cambio = true; }
  if (c.consultable === undefined) { c.consultable = true; cambio = true; }
  return cambio;
}
// Puntos de la versión 1 (una sola foto) → lista de fotos.
export function migrarPunto(p) {
  if (p.fotos === undefined) { p.fotos = p.foto ? [p.foto] : []; delete p.foto; return true; }
  return false;
}

// Lee todo desde la base del celular hacia la memoria de trabajo.
export async function cargarTodo() {
  S.capas = (await leerTodos('capas')).sort((a, b) => (a.orden ?? 1e9) - (b.orden ?? 1e9) || (a.fecha || '').localeCompare(b.fecha || ''));
  S.puntos = await leerTodos('puntos');
  S.ajustes = { ...AJUSTES_DEFECTO, ...(await leerAjustes()) };
  for (const c of S.capas) if (migrarCapa(c)) await guardar('capas', c);
  for (const p of S.puntos) if (migrarPunto(p)) await guardar('puntos', p);
}

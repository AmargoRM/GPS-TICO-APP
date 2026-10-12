/* =======================================================================
   ESTADO COMPARTIDO
   Lo que la app tiene "en memoria" mientras está abierta. Lo permanente
   está en IndexedDB (ver bd.js); esto es una copia de trabajo.
   ======================================================================= */
import { guardarAjuste, leerTodos, leerAjustes } from './bd.js';

export const S = {
  capas: [],              // capas guardadas (cajón "capas")
  puntos: [],             // puntos guardados (cajón "puntos")
  ajustes: {},            // preferencias (cajón "ajustes")
  fix: null,              // última posición del GPS: {lat, lon, precision, altitud, rumbo, t}
  datosURL: new Map(),    // contenido descargado de capas de URL (solo en memoria)
  estadoURL: new Map(),   // estado de cada capa de URL: 'cargando' | 'ok' | mensaje de error
  destino: null,          // punto hacia el que se navega
  seguir: true            // el mapa sigue mi posición
};

// Valores por defecto de los ajustes.
export const AJUSTES_DEFECTO = {
  proyeccion: 'crtm05',   // crtm05 | ln | ls | geo
  capasVisibles: [],      // ids de capas visibles
  fondo: 'sat',           // sat | calles | ninguno
  ultimaCopia: null,      // fecha (ISO) de la última copia descargada
  vista: null             // último encuadre del mapa {lat, lon, zoom}
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

// Lee todo desde la base del celular hacia la memoria de trabajo.
export async function cargarTodo() {
  S.capas = (await leerTodos('capas')).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  S.puntos = await leerTodos('puntos');
  S.ajustes = { ...AJUSTES_DEFECTO, ...(await leerAjustes()) };
  S.datosURL.clear(); S.estadoURL.clear();
}

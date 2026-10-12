/* =======================================================================
   BASE DE DATOS EN EL CELULAR (IndexedDB)
   Todo se guarda solo en este navegador/celular. No hay servidor.

   Tres "cajones" (almacenes):
   - capas   : capas de mapa. Las de archivo con su contenido completo;
               las de URL solo con la dirección y el nombre.
   - puntos  : puntos capturados con el GPS (con foto opcional).
   - ajustes : preferencias sueltas, guardadas como clave → valor.
   ======================================================================= */

const NOMBRE_BD = 'gps-tico-web';   // distinto al original, para que nunca se mezclen
const VERSION_BD = 1;
export const CAJONES = ['capas', 'puntos', 'ajustes'];

let bd = null;

// Abre (o crea la primera vez) la base de datos.
export function abrirBD() {
  return new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(NOMBRE_BD, VERSION_BD);
    pedido.onupgradeneeded = () => {
      const d = pedido.result;
      if (!d.objectStoreNames.contains('capas')) d.createObjectStore('capas', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('puntos')) d.createObjectStore('puntos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('ajustes')) d.createObjectStore('ajustes');   // clave aparte
    };
    pedido.onsuccess = () => { bd = pedido.result; resolver(bd); };
    pedido.onerror = () => rechazar(pedido.error);
    pedido.onblocked = () => rechazar(new Error('La base de datos está abierta en otra pestaña. Cerrala y volvé a intentar.'));
  });
}

// Convierte un pedido de IndexedDB en una promesa.
function esperar(pedido) {
  return new Promise((ok, mal) => { pedido.onsuccess = () => ok(pedido.result); pedido.onerror = () => mal(pedido.error); });
}
// Espera a que termine una transacción completa (todo o nada).
function terminar(tx) {
  return new Promise((ok, mal) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error || new Error('Operación cancelada'));
  });
}
function cajon(nombre, modo = 'readonly') { return bd.transaction(nombre, modo).objectStore(nombre); }

export const leer = (c, clave) => esperar(cajon(c).get(clave));
export const leerTodos = (c) => esperar(cajon(c).getAll());
export const guardar = (c, valor, clave) => esperar(cajon(c, 'readwrite').put(valor, clave));
export const borrar = (c, clave) => esperar(cajon(c, 'readwrite').delete(clave));

// Ajustes: atajos para leer/guardar una preferencia.
export const leerAjuste = (clave) => leer('ajustes', clave);
export const guardarAjuste = (clave, valor) => guardar('ajustes', valor, clave);

// Todos los ajustes como un objeto { clave: valor }.
export async function leerAjustes() {
  const tx = bd.transaction('ajustes');
  const st = tx.objectStore('ajustes');
  const [claves, valores] = await Promise.all([esperar(st.getAllKeys()), esperar(st.getAll())]);
  const out = {};
  claves.forEach((k, i) => { out[k] = valores[i]; });
  return out;
}

// Borra TODO (los tres cajones) en una sola transacción.
export async function vaciarTodo() {
  const tx = bd.transaction(CAJONES, 'readwrite');
  for (const c of CAJONES) tx.objectStore(c).clear();
  await terminar(tx);
}

// Reemplaza TODO por los datos de una copia, en una sola transacción:
// si algo falla a la mitad, el navegador deshace todo y quedan los datos de antes.
export async function reemplazarTodo({ capas, puntos, ajustes }) {
  const tx = bd.transaction(CAJONES, 'readwrite');
  const sc = tx.objectStore('capas'), sp = tx.objectStore('puntos'), sa = tx.objectStore('ajustes');
  sc.clear(); sp.clear(); sa.clear();
  for (const c of capas) sc.put(c);
  for (const p of puntos) sp.put(p);
  for (const [k, v] of Object.entries(ajustes)) sa.put(v, k);
  await terminar(tx);
}

// Identificador único para capas y puntos.
export function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

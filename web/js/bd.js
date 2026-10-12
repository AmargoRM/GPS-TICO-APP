/* =======================================================================
   BASE DE DATOS EN EL CELULAR (IndexedDB)
   Todo se guarda solo en este navegador/celular. No hay servidor.

   Tres "cajones" (almacenes) con los datos del usuario:
   - capas   : capas de mapa con su contenido completo (las de URL también,
               como en la app Android, para verlas sin internet).
   - puntos  : puntos capturados (con fotos y datos de plantilla).
   - ajustes : preferencias sueltas, guardadas como clave → valor.
   Cajones auxiliares (versión 2):
   - bigprops: atributos de capas grandes, en bloques de 1000 ("idCapa:bloque").
   - teselas : cuadritos de imagen del mapa ya vistos o descargados (sin conexión).
   - zonas   : zonas de mapa descargadas a propósito para usar sin conexión.
   ======================================================================= */

const NOMBRE_BD = 'gps-tico-web';   // distinto al original, para que nunca se mezclen
const VERSION_BD = 2;
export const CAJONES = ['capas', 'puntos', 'ajustes'];          // datos del usuario (van en la copia)
export const AUXILIARES = ['bigprops', 'teselas', 'zonas'];     // datos de apoyo

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
      if (!d.objectStoreNames.contains('bigprops')) d.createObjectStore('bigprops');
      if (!d.objectStoreNames.contains('teselas')) d.createObjectStore('teselas');
      if (!d.objectStoreNames.contains('zonas')) d.createObjectStore('zonas', { keyPath: 'id' });
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

export const contar = (c) => esperar(cajon(c).count());
export const vaciar = (c) => esperar(cajon(c, 'readwrite').clear());

// Borra todas las claves que empiezan con un prefijo (ej. atributos de una capa grande).
export function borrarPrefijo(c, prefijo) {
  return new Promise(ok => {
    const pedido = cajon(c, 'readwrite').openCursor(IDBKeyRange.bound(prefijo, prefijo + '\uffff'));
    pedido.onsuccess = () => { const cur = pedido.result; if (cur) { cur.delete(); cur.continue(); } else ok(); };
    pedido.onerror = () => ok();
  });
}

// Borra TODO (datos y cajones de apoyo) en una sola transacción.
export async function vaciarTodo() {
  const todos = [...CAJONES, ...AUXILIARES];
  const tx = bd.transaction(todos, 'readwrite');
  for (const c of todos) tx.objectStore(c).clear();
  await terminar(tx);
}

// Reemplaza TODO por los datos de una copia, en una sola transacción:
// si algo falla a la mitad, el navegador deshace todo y quedan los datos de antes.
export async function reemplazarTodo({ capas, puntos, ajustes }) {
  const tx = bd.transaction([...CAJONES, 'bigprops'], 'readwrite');
  const sc = tx.objectStore('capas'), sp = tx.objectStore('puntos'), sa = tx.objectStore('ajustes');
  sc.clear(); sp.clear(); sa.clear();
  tx.objectStore('bigprops').clear();   // las capas grandes no viajan en la copia
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

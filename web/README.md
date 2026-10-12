# GPS TICO Web

Versión web instalable (PWA) de GPS TICO. Funciona en el celular **sin conexión** una vez instalada.
No tiene servidor, cuentas ni conexión con Nube-amarga o Neon: **los datos quedan solo en el celular**.

## Qué hace

- Mapa con coordenadas en **CRTM05**, **Lambert Norte**, **Lambert Sur** o latitud/longitud (tocá las coordenadas de arriba para cambiar).
- Capas desde **archivo**: GeoJSON, KML, KMZ, GPX, CSV con X/Y y shapefile en ZIP. Se guardan completas en el celular.
- Capas desde **URL**: GeoJSON, WFS y WMS. Solo se guarda la dirección; necesitan internet.
- **Capturar puntos** con el GPS (nombre, nota, foto, precisión). Avisa si la precisión es peor que 15 m.
- **Navegar** hacia un punto: distancia y rumbo.
- **Exportar** puntos a GeoJSON, KML y CSV (X/Y en CRTM05).
- **Copia de seguridad**: descargar y restaurar todo en un archivo `.json`. Avisa si pasaron más de 7 días sin copia.
- **Borrar todo** con doble confirmación.
- Aviso cuando hay una **versión nueva**.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la pantalla. |
| `estilos.css` | Colores y tamaños. |
| `manifest.webmanifest` | Nombre e íconos para instalar la app. |
| `sw.js` | Guarda la app en el celular para que abra sin internet y detecta versiones nuevas. |
| `iconos/` | Íconos de la app. |
| `js/app.js` | Arranque: conecta todo. |
| `js/estado.js` | Datos en memoria mientras la app está abierta. |
| `js/bd.js` | Base de datos del celular (IndexedDB): cajones `capas`, `puntos`, `ajustes`. |
| `js/geodesia.js` | Proyecciones CRTM05, Lambert Norte y Sur (copiadas del GPS TICO original). |
| `js/mapa.js` | Visor del mapa. |
| `js/importar.js` | Lectores de GeoJSON, KML, GPX, CSV y shapefile. |
| `js/capas.js` | Panel de capas. |
| `js/capas-url.js` | Capas por URL y mensajes cuando el servidor bloquea (CORS). |
| `js/gps.js` | GPS en vivo y captura de puntos. |
| `js/puntos.js` | Lista de puntos, detalle y navegación. |
| `js/exportar.js` | Exportar GeoJSON, KML y CSV. |
| `js/copia.js` | Crear y revisar copias de seguridad. |
| `js/ajustes.js` | Panel de ajustes, almacenamiento persistente y borrar todo. |
| `pruebas/` | Pruebas automáticas (solo para computadora, con Node.js: `npm test` dentro de `web/`). |
| `package.json` | Solo para correr las pruebas. La app no lo usa. |

## Publicar una versión nueva

1. Hacer los cambios.
2. En `sw.js`, cambiar `const VERSION = '1.0.0'` por un número nuevo (por ejemplo `'1.0.1'`).
   **Si no se cambia, los celulares no se enteran de la versión nueva.**
3. Si se agregó un archivo nuevo, sumarlo a la lista `ARCHIVOS` de `sw.js`.
4. Publicar. Al abrir la app con internet, aparece "Hay una versión nueva" → **Actualizar**.
   Los datos guardados no se tocan al actualizar.

La app necesita **https** para instalarse y usar el GPS (excepto en `localhost` para pruebas).

## Coordenadas y QGIS

- La conversión es la misma del GPS TICO original. Se comprobó contra PROJ (el motor de QGIS):
  CRTM05 coincide al milímetro; Lambert a menos de 5 cm.
- **Ojo al comparar con QGIS:** entre WGS84 (lo que da el GPS) y CR05, QGIS puede elegir por defecto la transformación
  "CR05 to WGS 84 (2)", que mueve el punto hasta ~25 cm. La app usa "(1)" (WGS84 = CR05), igual que el original.
  En Lambert, QGIS puede elegir "Ocotepeque 1935 to WGS 84 (2)", con diferencias de hasta ~2 m.
  Para comparar exacto, en QGIS elegí la transformación "(1)" cuando la pregunte.
- Lambert usa Helmert de 7 parámetros. El método oficial del IGN puede diferir de 1 a varios metros:
  no usar para catastro sin verificar.
- La precisión real la pone el GPS del celular (normalmente 3 a 10 m).

## Límites conocidos

- El **fondo del mapa** necesita internet. Sin conexión, las capas de archivo y los puntos se ven sobre fondo liso.
- Las capas de **URL** necesitan internet; si el servidor no permite CORS, la app lo explica y sugiere cargar el archivo.
- El navegador puede borrar los datos si no concede "almacenamiento persistente" y el celular se queda sin espacio.
  En iPhone, si la app no está instalada en la pantalla de inicio, Safari puede borrarlos tras ~7 días sin uso.
  **Descargá copias seguido.**
- Una web no puede usar el GPS con la pantalla apagada.

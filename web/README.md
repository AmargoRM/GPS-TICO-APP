# GPS TICO Web

Versión web instalable (PWA) de GPS TICO, lo más parecida posible a la app Android.
Funciona en el celular **sin conexión** una vez instalada. No tiene servidor, cuentas ni conexión con
Nube-amarga o Neon: **los datos quedan solo en el celular**.

Enlace: https://amargorm.github.io/GPS-TICO-APP/

## Qué hace

**Mapa y coordenadas**
- Coordenadas en **CRTM05**, **Lambert Norte**, **Lambert Sur** o geográficas (botones GEO / CRTM05 / LAM·N / LAM·S).
- Fondo satélite o calles. Lo que se ve con internet queda guardado; además se pueden **descargar zonas** para usar sin conexión.
- 📏 **Medir** distancia, perímetro y área (en CRTM05). 🧭 **Navegar**: distancia, rumbo, ruta por caminos (con internet) y abrir en Waze, Google Maps o Apple Mapas.
- **Mantener presionado** el mapa: "Consultar aquí" (todos los elementos en un radio, en una tabla al costado) o **Chincheta** (con círculo de radio, navegar, guardar como punto).
- **Convertir coordenadas** entre los cuatro sistemas.

**Capas (como en Android)**
- Desde **archivo**: GeoJSON, KML, KMZ, GPX, CSV con X/Y, DXF (CAD), shapefile en ZIP o `.shp` suelto. GeoJSON de más de 8 MB con motor compacto.
- Desde **URL**: GeoJSON, WFS (escanear capas) y WMS (escanear capas). GeoJSON y WFS **quedan guardadas en el celular** y se actualizan con 🔄.
- En Android: **compartir** un archivo a la app desde otra app.
- Grupos plegables 📁, orden ▲▼, ver/ocultar, consultable 🔍/🔒, tabla de atributos, **filtro por atributos 🔎**,
  simbología por atributo 🎨, etiquetas 🏷, estilo (color, símbolo, tamaño, grosor, relleno), proyección de origen 🌐, ir ◎.
- Tocar un elemento muestra sus atributos (también en WMS, si el servidor lo permite).

**Filtro por atributos 🔎** (dentro de una misma capa)
- Condiciones como `uso es igual a agricola` Y `area mayor que 500`; se unen con "todas (Y)" o "cualquiera (O)".
- Operadores: igual, distinto, contiene, no contiene, mayor, menor, mayor o igual, menor o igual, vacío, no vacío.
- Mayúsculas y tildes no importan; los números se comparan como números.
- Lo filtrado no se dibuja ni responde al toque. El resultado se puede **guardar como capa nueva**.

**Puntos**
- **Marcar punto** con el GPS o **escribiendo coordenadas** (cualquier sistema).
- **Promediar** quieto (30 s a 5 min) con desviación en vivo.
- **Plantillas de captura** (formularios propios: texto, número, lista, foto; campos obligatorios).
- Varias **fotos** por punto, con marca de agua (nombre, coordenadas, fecha).
- Aviso si la precisión es peor que 15 m. Lista por día con ver/ocultar.

**Exportar y respaldar**
- Puntos a **CSV** (en el sistema elegido), **GPX**, **GeoJSON**, **KML** y **DXF**.
- **Exportar mapa** a PNG o **PDF georreferenciado** con cuadrícula CRTM05, norte, escala y leyenda.
- **Copia de seguridad** (capas, puntos con fotos, plantillas y ajustes) y **restaurar** con revisión previa. Aviso a los 7 días.
- **Borrar todo** con doble confirmación. Aviso de **versión nueva** y botón **Instalar app**.

## iPhone y Safari

- Instalar: abrir el enlace en **Safari** → Compartir → **Agregar a inicio**. Abrir siempre desde el ícono.
- **Importante:** si se usa desde Safari sin instalar, Safari puede borrar los datos tras ~7 días sin abrirla. Instalada, no.
- Los archivos exportados se guardan con el menú **Compartir** (Guardar en Archivos, AirDrop, correo).
- Para cargar capas se eligen desde la app **Archivos** (iCloud Drive, "En mi iPhone", etc.).
- La brújula pide permiso la primera vez que se navega.
- No disponible en iPhone (límite de Apple): recibir archivos con "Compartir" desde otra app.
- Requiere iOS 15 o más nuevo (recomendado iOS 16.4+).

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `estilos.css` | Pantalla y estilos (ajustados para iPhone). |
| `manifest.webmanifest` | Nombre e íconos para instalar; recibir archivos compartidos (Android). |
| `sw.js` | Guarda la app en el celular para abrir sin internet y detecta versiones nuevas. |
| `js/app.js` | Arranque: conecta todo. |
| `js/compat.js` | Piezas que faltan en Safari viejos. |
| `js/estado.js`, `js/bd.js` | Datos en memoria y base de datos del celular (IndexedDB). |
| `js/geodesia.js` | Proyecciones CRTM05, Lambert Norte y Sur (copiadas del original). |
| `js/mapa.js` | Visor del mapa, estilos, simbología y etiquetas. |
| `js/capas.js`, `js/capas-url.js` | Panel de capas y capas por URL. |
| `js/importar.js`, `js/grandes.js` | Lectores de archivos y motor de capas grandes. |
| `js/filtros.js` | Filtro por atributos dentro de una capa. |
| `js/consulta.js` | Consulta al tocar, por radio y tabla de atributos. |
| `js/herramientas.js` | Medir, navegar, chincheta y convertir. |
| `js/gps.js`, `js/plantillas.js`, `js/puntos.js` | Marcar punto, promediar, plantillas, lista y navegación. |
| `js/exportar.js`, `js/exportar-mapa.js` | Exportar puntos y mapa. |
| `js/offline.js` | Zonas de mapa sin conexión. |
| `js/copia.js`, `js/ajustes.js`, `js/instalar.js`, `js/menu.js`, `js/ui.js` | Copia, ajustes, instalar, menú y piezas de pantalla. |
| `pruebas/` | Pruebas automáticas (`npm test` dentro de `web/`). |

## Publicar una versión nueva

1. Hacer los cambios.
2. En `sw.js`, subir el número de `VERSION` (por ejemplo `'2.1.0'` → `'2.2.0'`). **Si no se cambia, los celulares no se enteran.**
3. Si se agregó un archivo, sumarlo a la lista `ARCHIVOS` de `sw.js`.
4. Guardar en la rama: GitHub Actions corre las pruebas y publica solo. En la app aparece "Hay una versión nueva" → **Actualizar**.
   Los datos guardados no se tocan al actualizar.

## Coordenadas y QGIS

- La conversión es la misma del GPS TICO original. Comprobada contra PROJ (motor de QGIS): CRTM05 al milímetro; Lambert a menos de 5 cm.
- **Al comparar con QGIS:** QGIS puede elegir por defecto "CR05 to WGS 84 (2)", que mueve el punto hasta ~25 cm; la app usa "(1)",
  igual que el original. En Lambert, QGIS puede elegir "Ocotepeque 1935 to WGS 84 (2)", con diferencias de hasta ~2 m.
  Para comparar exacto, elegí en QGIS la transformación "(1)".
- Lambert usa Helmert de 7 parámetros. El método oficial del IGN puede diferir de 1 a varios metros: no usar para catastro sin verificar.

## Límites conocidos

- Una web no puede usar el GPS con la pantalla apagada ni mostrar satélites/L5 (eso solo lo hace la app Android).
- Capas por URL: si el servidor no permite CORS, la app lo explica y sugiere cargar el archivo.
- Las capas grandes no entran en la copia de seguridad: guardar sus archivos originales.
- El navegador podría borrar los datos si no concede "almacenamiento persistente". **Descargá copias seguido.**

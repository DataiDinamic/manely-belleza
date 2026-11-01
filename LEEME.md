# Manely Belleza · app de gestión (alfa 0.5)

Agenda, clientas y servicios. Funciona en móvil, tablet y ordenador, y se instala como app desde el navegador.

## Probarla sin configurar nada

Mientras `js/config.js` esté vacío, la app arranca en **modo demostración**, con datos de ejemplo guardados solo en ese navegador.
Necesita servirse por http (no vale abrir el archivo con doble clic):

```
cd manely-app
python -m http.server 8000
```

Abre `http://localhost:8000`. Para forzar la demostración aunque haya configuración: `http://localhost:8000/?demo`.

## Puesta en marcha con Supabase (una sola vez)

1. **Crear el proyecto** en supabase.com → *New project*. Región: **Europa** (Frankfurt o París), por protección de datos. Guarda la contraseña de la base de datos.
2. **Crear las tablas**: *SQL Editor → New query*, pega entero `supabase/001_fase1.sql` y pulsa *Run*. Se puede volver a ejecutar sin romper nada.
3. **Cerrar el registro público**: *Authentication → Sign In / Providers* → desactiva **Allow new users to sign up**. Así nadie puede crearse una cuenta.
4. **Crear la cuenta de Eli**: *Authentication → Users → Add user → Create new user*, con su email y una contraseña, y marca **Auto Confirm User**.
5. **Copiar las claves** a `js/config.js`:
   - `SUPABASE_URL`: *Project Settings → Data API → Project URL*
   - `SUPABASE_KEY`: *Project Settings → API Keys → Publishable key* (`sb_publishable_…`). Es pública a propósito; lo que protege los datos es el inicio de sesión y las reglas del SQL.
6. **Publicarla** con HTTPS (necesario para el PIN y para instalarla). Lo más sencillo es GitHub Pages: sube la carpeta `manely-app` a un repositorio y actívalo en *Settings → Pages*.
7. **Avisar a Supabase de la dirección**: *Authentication → URL Configuration* → pon la dirección publicada en **Site URL** y en **Redirect URLs**. Así funciona el enlace de «He olvidado la contraseña».
8. En la tablet o el móvil de Eli: abrir la dirección → entrar → crear el PIN → menú del navegador → **Añadir a pantalla de inicio / Instalar app**.

## Seguridad

- **Inicio de sesión** con email y contraseña. Supabase solo devuelve los datos del negocio al que pertenece la usuaria (reglas RLS). Sin sesión no se puede leer ni escribir nada.
- **PIN de 6 cifras por dispositivo**: bloquea la app tras unos minutos sin usarla (ajustable) y al volver a ella después de más de un minuto fuera. Tras 5 fallos impone esperas. «He olvidado el PIN» cierra la sesión y obliga a entrar con email y contraseña.
- Todo lo que se escribe (nombres, notas…) se muestra como texto, nunca como código.
- **Datos de salud** de las clientas: solo se pueden guardar si se marca su autorización. La base de datos lo comprueba y lo exige.

## Lo que hace esta versión

- **Agenda por día**: la semana arriba, franjas por hora, línea de la hora actual. Se toca un hueco para crear una cita y las citas que se cruzan se ponen lado a lado. Al lado, la lista del día con el total previsto.
- **Agenda por mes**: muestra cuántas citas hay cada día; al tocar un día se abre su agenda.
- **Citas**: con varios servicios, y precio y duración editables en cada uno. Avisa si la hora se cruza con otra cita. Estados: pendiente, confirmada, hecha, no vino, anulada (con motivo). Las citas no se borran, se anulan. Se puede cambiar la hora o el día, repetir una cita y enviar un recordatorio por WhatsApp.
- **Clientas**: ficha con «Le gusta» (colores, forma, marcas), notas, datos para facturas, consentimientos, historial, número de visitas y total gastado. Se pueden archivar, nunca borrar, para no perder el historial.
- **Servicios**: por categorías, con duración, precio con IVA incluido y tipo de IVA. Cada cita guarda el precio del momento, así que cambiar una tarifa no altera las citas pasadas. Los servicios que ya no se ofrecen se desactivan.
- **Ajustes**: datos del centro (los usarán las facturas), horario de la agenda, tiempo de bloqueo y cambio de PIN.

## Fase 2: Caja (versión 0.2)

**Instalación sobre la 0.1:** ejecutar `supabase/002_fase2_caja.sql` en el SQL Editor (pestaña nueva con **+**, **Run**, y **Run query** si avisa de «destructive operations»). Solo añade tablas: no toca clientas, servicios ni citas. Después, subir a GitHub los archivos de la actualización.

- **Cobrar una cita**: desde su ficha, botón **Cobrar**. Vienen puestos sus servicios; se pueden cambiar precios, añadir productos u otros conceptos y aplicar descuento (en € o %). Forma de pago: datáfono, efectivo (calcula el cambio), Bizum o mixto. Al cobrar, la cita queda como realizada y en la agenda aparece «cobrada».
- **Venta suelta**: en **Caja → Nueva venta**, con o sin clienta.
- **Productos**: en **Catálogo → Productos**, con marca, precio, IVA, coste y stock opcional (se descuenta en cada venta y se devuelve si se anula).
- **Caja del día**: total cobrado y desglose por forma de pago, citas pendientes de cobrar, lista de cobros y **cierre de caja** (fondo inicial + efectivo cobrado frente a lo contado).
- **Los cobros no se modifican ni se borran**: se **anulan** con motivo y PIN, y queda registrado quién y cuándo. La base de datos solo permite crear y anular cobros a través de sus funciones.
- La ficha de cada clienta muestra lo **gastado de verdad** (cobros, con productos y descuentos) y su lista de cobros.

## Versión 0.3: TPV de botones y facturas

**Instalación:** ejecutar en el SQL Editor `supabase/002_fase2_caja.sql` (si no se hizo con la 0.2; repetirlo no hace daño) y después `supabase/003_facturas.sql`. Luego subir los archivos a GitHub.

- **TPV en tablet y ordenador** (pantallas de 700 px o más): ticket a la izquierda, **botones de categorías** en el centro (las categorías de servicios y productos del Catálogo), al pulsar una salen sus tratamientos y productos, con «‹ Categorías» para volver. **Teclado numérico** a la derecha: escribir un importe y **+** lo añade al ticket, **−** lo resta como descuento, **⌫** borra un número, **C** limpia; para cambiar el precio de una línea se escribe en el teclado y se toca el precio de la línea. Abajo, **Datáfono / Efectivo / Bizum / Mixto** y el total.
- **En el móvil** sigue el formulario de cobro.
- Al elegir la forma de pago sale el **resumen** con **Cancelar** (rojo), **Factura** (azul) y **Cobrar** (verde).
- **Facturas**: simplificada (sin datos de la clienta) o completa (nombre, NIF y dirección; se pueden guardar en su ficha). Numeración correlativa por año: `T2026-0001…` (simplificadas) y `F2026-0001…` (completas). PDF con logo, datos del centro y desglose de IVA, para **enviar** (correo, WhatsApp… desde el móvil o la tablet) o **descargar**. Se puede hacer la factura de un cobro más tarde y volver a descargarla desde el cobro.
- Para facturar hacen falta en **Ajustes → Datos del centro** al menos el **titular y el NIF** (y la **dirección** para las completas).
- Un cobro con factura **no se puede anular** desde la app: hará falta una factura rectificativa (próxima versión; consultar con el gestor).
- Estas facturas aún **no envían registros a Hacienda (Verifactu)**: será obligatorio para autónomos desde el 1 de julio de 2027 y se añadirá antes.

## Versión 0.4: agenda por semana e importar de Google Calendar

No necesita SQL nuevo: basta con subir los archivos.

- **Agenda por semana**: los 7 días en columnas con las horas a la izquierda. Tocar un hueco crea una cita ese día a esa hora; tocar el nombre de un día abre su vista de día. En el móvil se ven tres días y el resto se desliza.
- **Importar de Google Calendar** (*Ajustes*): en calendar.google.com → ⚙ Configuración → Importar y exportar → Exportar (descarga un .zip). En la app se elige ese .zip (o el .ics de dentro). Se muestra la lista para revisar: la app intenta reconocer la clienta y el servicio por el título del evento; lo que no reconoce lo propone como clienta nueva (con el teléfono si aparece en la descripción). Los eventos de día completo vienen desmarcados. Las citas pasadas entran como realizadas y las futuras como confirmadas. Si se importa dos veces, lo que ya está no se duplica.

## Versión 0.5: Inventario de material

**Instalación:** ejecutar `supabase/004_inventario.sql` en el SQL Editor (solo añade tablas) y subir los archivos.

En **Catálogo → Inventario**, el material que se gasta y no se cobra (algodones, acetona, guantes…):
- Cada artículo: nombre, marca, categoría, proveedor, **unidad** (unidades, gramos, kilos, mililitros, litros), **contenido del envase**, **precio del envase**, **stock mínimo** y stock inicial.
- La app calcula el **precio comparable** (€/ud, €/kg o €/l) y, si hay el mismo artículo de varias marcas, cuál sale más barata y cuánto.
- **Usar** (con botones rápidos: ¼, ½ o 1 envase; 1, 2, 5, 10 unidades): descuenta el stock y calcula el coste de lo usado.
- **Comprar**: suma envases y apunta lo pagado; si el precio ha cambiado, ofrece actualizarlo.
- **Recontar**: corrige el stock tras contarlo; si falta material, cuenta como gasto (merma).
- Arriba: **gastado este mes** (material usado), **comprado este mes**, **valor del stock** y **cuántos artículos hay que comprar**.
- En la ficha de cada artículo: consumo medio al mes (cantidad y euros), para cuántos días queda y todos sus movimientos (se puede borrar uno mal apuntado y el stock se recalcula).
- **Lista de la compra** con lo que está por debajo del mínimo, agrupada por proveedor, para enviar por WhatsApp o copiar.

## Límites del plan gratuito de Supabase

- El proyecto **se pausa tras una semana sin uso**; con uso diario no pasa. Si se pausa, se reactiva desde el panel.
- 500 MB de base de datos y 1 GB de archivos: para un centro, años de citas.
- Copias de seguridad: el plan Pro guarda 7 días. En el gratuito conviene exportar los datos con regularidad (la exportación llega en la fase 4).

## Estructura

```
index.html              página
css/app.css             estilos
js/config.js            ← claves de Supabase y horario por defecto
js/app.js               arranque, acceso, navegación
js/db.js                acceso a datos (Supabase o demostración)
js/pin.js               PIN de bloqueo
js/citas.js             formulario y detalle de cita
js/caja.js              cobro (móvil), resumen Cancelar/Cobrar/Factura, detalle y anulación
js/tpv.js               TPV de botones (tablet y ordenador)
js/factura.js           facturas: datos, PDF, enviar y descargar
js/ics.js               lectura de calendarios .ics (Google Calendar)
js/importar.js          pantalla de importación de citas
js/fechas.js            fechas en hora local (sin desfases)
js/vistas/*.js          agenda, caja, clientas, catálogo (servicios y productos), ajustes
supabase/001_fase1.sql  tablas, reglas de seguridad y funciones (fase 1)
supabase/002_fase2_caja.sql  productos, cobros y cierres de caja (fase 2)
supabase/003_facturas.sql    facturas con numeración correlativa (0.3)
supabase/004_inventario.sql  inventario de material (0.5)
sw.js, manifest         instalación como app
```

Al publicar cambios, sube `VERSION` en `sw.js` para que los dispositivos descarguen la versión nueva.

## Próximas fases

2. ~~Caja~~ ✔ hecha en la versión 0.2.
3. Proveedores y compras, con los PDF de las facturas recibidas.
4. Informe trimestral en un clic, en el mismo formato que recibe el gestor, y exportación de datos.
5. Facturas a clientas en PDF y por email, con Verifactu (obligatorio para autónomos desde el 1 de julio de 2027).
6. Inventario, recordatorios y estadísticas.

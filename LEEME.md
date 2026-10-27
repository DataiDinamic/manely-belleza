# Manely Belleza · app de gestión (alfa 0.1 — fase 1)

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
js/fechas.js            fechas en hora local (sin desfases)
js/vistas/*.js          agenda, clientas, servicios, ajustes
supabase/001_fase1.sql  tablas, reglas de seguridad y funciones
sw.js, manifest         instalación como app
```

Al publicar cambios, sube `VERSION` en `sw.js` para que los dispositivos descarguen la versión nueva.

## Próximas fases

2. Caja: cobro de cada cita (datáfono, efectivo o Bizum) y venta de productos.
3. Proveedores y compras, con los PDF de las facturas recibidas.
4. Informe trimestral en un clic, en el mismo formato que recibe el gestor, y exportación de datos.
5. Facturas a clientas en PDF y por email, con Verifactu (obligatorio para autónomos desde el 1 de julio de 2027).
6. Inventario, recordatorios y estadísticas.

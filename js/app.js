// Arranque: sesión → PIN → app con navegación por secciones
import * as db from './db.js';
import { esc, aviso, errorAviso, cargando } from './util.js';
import { tienePin, crearPin, desbloquear, vigilar, borrarPin } from './pin.js';
import { leerAjustes } from './ajustes.js';
import * as agenda from './vistas/agenda.js';
import * as clientas from './vistas/clientas.js';
import * as catalogo from './vistas/catalogo.js';
import * as caja from './vistas/caja.js';
import * as ajustes from './vistas/ajustes.js';

const raiz = document.getElementById('app');
let cuenta = null;
let vigilando = false;

// ---------------------------------------------------------------------
// Pantalla de acceso
// ---------------------------------------------------------------------
function pantallaAcceso({ recuperando = false } = {}) {
  document.body.classList.remove('con-app');
  const demo = db.modo === 'demo';
  raiz.innerHTML = `
    <main class="acceso">
      <div class="acceso-caja">
        <img class="insignia" src="iconos/insignia.png" alt="Manely Belleza · Estética y uñas" width="128" height="128">
        <h1 class="sr">Manely Belleza</h1>
        ${recuperando ? `
          <p class="texto-suave">Escribe tu nueva contraseña.</p>
          <form data-f="nueva">
            <label class="campo"><span>Nueva contraseña</span><input name="p" type="password" minlength="8" autocomplete="new-password" required autofocus></label>
            <button class="btn btn-principal ancho">Guardar contraseña</button>
          </form>` : demo ? `
          <p class="texto-suave">Modo demostración. La app todavía no está conectada a Supabase: los datos son de ejemplo y se quedan en este navegador.</p>
          <form data-f="entrar"><button class="btn btn-principal ancho" autofocus>Entrar en la demostración</button></form>` : `
          <form data-f="entrar">
            <label class="campo"><span>Email</span><input name="email" type="email" autocomplete="username" required autofocus></label>
            <label class="campo"><span>Contraseña</span><input name="p" type="password" autocomplete="current-password" required></label>
            <p class="acceso-error" role="alert"></p>
            <button class="btn btn-principal ancho">Entrar</button>
            <button type="button" class="enlace" data-olvido>He olvidado la contraseña</button>
          </form>`}
      </div>
    </main>`;

  const err = raiz.querySelector('.acceso-error');
  raiz.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      cargando(true);
      if (e.target.dataset.f === 'nueva') {
        await db.nuevaContrasena(f.p.value);
        aviso('Contraseña guardada');
        history.replaceState(null, '', location.pathname);
        await arrancarApp();
      } else {
        await db.entrar(f.email?.value.trim(), f.p?.value);
        await arrancarApp();
      }
    } catch (ex) {
      if (err) err.textContent = /invalid/i.test(ex.message) ? 'Email o contraseña incorrectos.' : ex.message;
      else errorAviso(ex, 'No se pudo entrar');
    } finally { cargando(false); }
  });
  raiz.querySelector('[data-olvido]')?.addEventListener('click', async () => {
    const email = raiz.querySelector('[name=email]').value.trim();
    if (!email) { err.textContent = 'Escribe tu email y vuelve a pulsar «He olvidado la contraseña».'; return; }
    try { await db.recuperarContrasena(email); err.textContent = `Te hemos enviado un enlace a ${email} para crear una contraseña nueva.`; }
    catch (ex) { err.textContent = ex.message; }
  });
}

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------
async function arrancarApp() {
  const sesion = await db.sesionActual();
  if (!sesion) return pantallaAcceso();
  cuenta = sesion.user?.email || 'demo@local';

  cargando(true);
  try { await db.cargarNegocio(); }
  catch (e) { cargando(false); errorAviso(e, 'No se pudieron cargar los datos del centro'); return pantallaAcceso(); }
  cargando(false);

  if (!tienePin(cuenta)) await crearPin(cuenta);
  if (!vigilando) {
    vigilar({ minutos: leerAjustes().bloqueo, olvido: olvidePin });
    vigilando = true;
  }
  pintarMarco();
  navegar();
}

async function olvidePin() {
  borrarPin();
  await db.salir();
  aviso('Vuelve a entrar con tu email y contraseña para crear un PIN nuevo.');
  pantallaAcceso();
}

async function salir() {
  await db.salir();
  pantallaAcceso();
}

const SECCIONES = [
  { id: 'agenda', texto: 'Agenda', icono: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>' },
  { id: 'caja', texto: 'Caja', icono: '<path d="M3 10h18v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9ZM5 10V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v4M8 14h2M14 14h2M8 17h8"/>' },
  { id: 'clientas', texto: 'Clientas', icono: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0"/>' },
  { id: 'catalogo', texto: 'Catálogo', icono: '<path d="M9 3h6v4l2 3v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V10l2-3V3ZM7 13h10"/>' },
  { id: 'ajustes', texto: 'Ajustes', icono: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>' },
];

function pintarMarco() {
  document.body.classList.add('con-app');
  raiz.innerHTML = `
    ${db.modo === 'demo' ? '<div class="banda-demo">Modo demostración · datos solo en este navegador</div>' : ''}
    <div class="marco">
      <nav class="navegacion" aria-label="Secciones">
        <div class="nav-marca" aria-hidden="true"><img src="iconos/flor.png" alt="" width="36" height="36"><b>${esc(db.negocioActual()?.nombre || 'Manely Belleza')}</b></div>
        ${SECCIONES.map((s) => `<a href="#${s.id}" data-seccion="${s.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${s.icono}</svg><span>${s.texto}</span></a>`).join('')}
      </nav>
      <main id="vista" tabindex="-1"></main>
    </div>`;
}

async function navegar() {
  if (!document.body.classList.contains('con-app')) return;
  let [seccion = 'agenda', param] = (location.hash.slice(1) || 'agenda').split('/');
  if (seccion === 'servicios') seccion = 'catalogo';   // dirección antigua
  raiz.querySelectorAll('[data-seccion]').forEach((a) =>
    a.toggleAttribute('aria-current', a.dataset.seccion === seccion));
  const zona = document.getElementById('vista');
  const el = document.createElement('div');   // contenedor nuevo en cada navegación
  el.className = 'vista-interior';
  zona.replaceChildren(el);
  try {
    if (seccion === 'clientas') await clientas.render(el, param);
    else if (seccion === 'catalogo') await catalogo.render(el, param);
    else if (seccion === 'caja') await caja.render(el);
    else if (seccion === 'ajustes') await ajustes.render(el, { cuenta, alSalir: salir });
    else await agenda.render(el);
  } catch (e) { errorAviso(e, 'Error al abrir la sección'); }
}

window.addEventListener('hashchange', navegar);

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------
(async () => {
  try {
    await db.iniciar();
  } catch (e) {
    raiz.innerHTML = `<main class="acceso"><div class="acceso-caja"><h1>Sin conexión</h1>
      <p class="texto-suave">No se pudo cargar la conexión con la base de datos. Comprueba internet y vuelve a abrir la app.</p>
      <button class="btn btn-principal" onclick="location.reload()">Reintentar</button></div></main>`;
    return console.error(e);
  }
  const recuperando = /type=recovery/.test(location.hash);
  db.alCambiarSesion((evento) => {
    if (evento === 'PASSWORD_RECOVERY') pantallaAcceso({ recuperando: true });
    if (evento === 'SIGNED_OUT' && document.body.classList.contains('con-app')) pantallaAcceso();
  });
  if (recuperando) return pantallaAcceso({ recuperando: true });
  // Con sesión guardada en el dispositivo se entra pidiendo solo el PIN
  const sesion = await db.sesionActual();
  if (sesion && tienePin(sesion.user?.email || 'demo@local')) {
    vigilar({ minutos: leerAjustes().bloqueo, olvido: olvidePin });
    vigilando = true;
    if (await desbloquear() === 'olvido') return;   // ya está en la pantalla de acceso
  }
  await arrancarApp();
})();

// App instalable
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker:', e));
}

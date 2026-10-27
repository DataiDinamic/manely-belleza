// PIN de bloqueo local. No sustituye al inicio de sesión: es una segunda
// barrera para que nadie toque la app si el móvil o la tablet se quedan a mano.
// El PIN no se guarda tal cual: se guarda un hash PBKDF2 con sal.

const CLAVE = 'mb_pin_v1';
const LARGO = 6;
let bloqueada = false;
let temporizador = null;
let ocultaDesde = null;
let minutosBloqueo = 5;
let alOlvidar = null;

const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE)); } catch { return null; } };
const escribir = (v) => { try { v ? localStorage.setItem(CLAVE, JSON.stringify(v)) : localStorage.removeItem(CLAVE); } catch { /* */ } };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function derivar(pin, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, base, 256);
  return hex(bits);
}

export function tienePin(cuenta) {
  const p = leer();
  return !!(p && p.cuenta === cuenta);
}

export function borrarPin() { escribir(null); }

async function guardarPin(pin, cuenta) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  escribir({ cuenta, salt, hash: await derivar(pin, salt), fallos: 0, esperaHasta: 0 });
}

async function comprobarPin(pin) {
  const p = leer();
  if (!p) return true;
  return (await derivar(pin, p.salt)) === p.hash;
}

// ---------------------------------------------------------------------
// Teclado numérico
// ---------------------------------------------------------------------
function teclado({ titulo, texto, mostrarOlvido, cancelable = false, peligro = false }) {
  return new Promise((resolve) => {
    const capa = document.createElement('div');
    capa.className = 'pantalla-pin' + (peligro ? ' pin-peligro' : '');
    capa.innerHTML = `
      ${cancelable ? '<button type="button" class="pin-cerrar" data-accion="cancelar" aria-label="Cancelar">✕</button>' : ''}
      <div class="pin-caja" role="dialog" aria-modal="true" aria-labelledby="pinTitulo">
        <img class="pin-flor" src="iconos/flor.png" alt="" width="56" height="56">
        <h1 id="pinTitulo"></h1>
        <p class="pin-texto"></p>
        <div class="pin-puntos" aria-live="polite">${'<i></i>'.repeat(LARGO)}</div>
        <p class="pin-error" role="alert"></p>
        <div class="pin-teclas">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('')}
          <button type="button" class="pin-sec" data-accion="olvido" ${mostrarOlvido ? '' : 'hidden'}>He olvidado el PIN</button>
          <button type="button" data-n="0">0</button>
          <button type="button" class="pin-sec" data-accion="borrar" aria-label="Borrar">Borrar</button>
        </div>
      </div>`;
    // Textos con textContent: pueden llevar nombres escritos por la usuaria
    capa.querySelector('h1').textContent = titulo;
    capa.querySelector('.pin-texto').textContent = texto;
    document.body.appendChild(capa);
    const puntos = capa.querySelectorAll('.pin-puntos i');
    const err = capa.querySelector('.pin-error');
    let valor = '';

    const pintar = () => puntos.forEach((p, i) => p.classList.toggle('lleno', i < valor.length));
    const api = {
      error(msg) {
        err.textContent = msg;
        capa.querySelector('.pin-caja').classList.remove('temblor');
        void capa.offsetWidth;
        capa.querySelector('.pin-caja').classList.add('temblor');
        valor = ''; pintar();
      },
      cerrar() { document.removeEventListener('keydown', onKey); capa.remove(); },
      texto(t) { capa.querySelector('.pin-texto').textContent = t; },
      titulo(t) { capa.querySelector('h1').textContent = t; },
    };
    const pulsar = (n) => {
      if (valor.length >= LARGO) return;
      valor += n; pintar(); err.textContent = '';
      if (valor.length === LARGO) { const v = valor; setTimeout(() => resolve({ pin: v, api }), 120); }
    };
    const borrar = () => { valor = valor.slice(0, -1); pintar(); };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) pulsar(e.key);
      else if (e.key === 'Backspace') borrar();
      else if (e.key === 'Escape' && cancelable) resolve({ cancelado: true, api });
    };
    document.addEventListener('keydown', onKey);
    capa.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.n) pulsar(b.dataset.n);
      else if (b.dataset.accion === 'borrar') borrar();
      else if (b.dataset.accion === 'olvido') resolve({ olvido: true, api });
      else if (b.dataset.accion === 'cancelar') resolve({ cancelado: true, api });
    });
    // Para recibir el siguiente PIN sin cerrar la pantalla
    api.siguiente = () => new Promise((r) => { resolve = r; valor = ''; pintar(); });
  });
}

export async function crearPin(cuenta) {
  let r = await teclado({ titulo: 'Crea tu PIN', texto: `Elige ${LARGO} números. Lo pedirá la app cada vez que se bloquee en este dispositivo.` });
  for (;;) {
    const primero = r.pin;
    r.api.titulo('Repite el PIN');
    r.api.texto('Escríbelo otra vez para confirmarlo.');
    r = await r.api.siguiente();
    if (r.pin === primero) { await guardarPin(primero, cuenta); r.api.cerrar(); return; }
    r.api.titulo('Crea tu PIN');
    r.api.texto(`Elige ${LARGO} números.`);
    r.api.error('Los dos PIN no coinciden. Empieza de nuevo.');
    r = await r.api.siguiente();
  }
}

export async function cambiarPin(cuenta) {
  let r = await teclado({ titulo: 'PIN actual', texto: 'Escribe el PIN que usas ahora.' });
  while (!(await comprobarPin(r.pin))) { r.api.error('Ese no es el PIN actual.'); r = await r.api.siguiente(); }
  r.api.cerrar();
  await crearPin(cuenta);
}

// Comprueba un PIN tecleado, con esperas tras 5 fallos (comparten contador
// el bloqueo y las confirmaciones). Devuelve true si es correcto.
async function intentoPin(r) {
  const p = leer();
  const espera = (p?.esperaHasta || 0) - Date.now();
  if (espera > 0) {
    r.api.error(`Demasiados intentos. Espera ${Math.ceil(espera / 1000)} segundos.`);
    return false;
  }
  if (await comprobarPin(r.pin)) {
    if (p) escribir({ ...p, fallos: 0, esperaHasta: 0 });
    return true;
  }
  if (p) {
    const fallos = (p.fallos || 0) + 1;
    const esperaHasta = fallos >= 5 ? Date.now() + Math.min(300, 30 * 2 ** (fallos - 5)) * 1000 : 0;
    escribir({ ...p, fallos, esperaHasta });
    r.api.error(fallos >= 5 ? 'PIN incorrecto. Espera un momento antes de volver a probar.' : 'PIN incorrecto.');
  }
  return false;
}

// Pide el PIN para confirmar una acción delicada (p. ej. eliminar).
// Devuelve true si el PIN es correcto y false si se cancela con la X.
export async function confirmarConPin({ titulo, texto }) {
  if (!leer()) return true;
  let r = await teclado({ titulo, texto, cancelable: true, peligro: true });
  for (;;) {
    if (r.cancelado) { r.api.cerrar(); return false; }
    if (await intentoPin(r)) { r.api.cerrar(); return true; }
    r = await r.api.siguiente();
  }
}

export async function desbloquear() {
  if (bloqueada) return;
  bloqueada = true;
  document.body.classList.add('bloqueada');
  let r = await teclado({ titulo: 'App bloqueada', texto: 'Escribe tu PIN para continuar.', mostrarOlvido: true });
  for (;;) {
    if (r.olvido) {
      r.api.cerrar();
      bloqueada = false;
      document.body.classList.remove('bloqueada');
      await alOlvidar?.();
      return 'olvido';
    }
    if (await intentoPin(r)) {
      r.api.cerrar();
      bloqueada = false;
      document.body.classList.remove('bloqueada');
      reiniciarTemporizador();
      return 'ok';
    }
    r = await r.api.siguiente();
  }
}

function reiniciarTemporizador() {
  clearTimeout(temporizador);
  if (!leer() || minutosBloqueo <= 0) return;
  temporizador = setTimeout(() => desbloquear(), minutosBloqueo * 60000);
}

// Bloqueo automático por inactividad y al volver a la app tras un rato fuera
export function vigilar({ minutos, olvido }) {
  minutosBloqueo = Number(minutos) || 0;
  alOlvidar = olvido;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, () => { if (!bloqueada) reiniciarTemporizador(); }, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ocultaDesde = Date.now();
    else if (ocultaDesde && Date.now() - ocultaDesde > 60000 && leer()) desbloquear();
  });
  reiniciarTemporizador();
}

export function fijarMinutosBloqueo(m) { minutosBloqueo = Number(m) || 0; reiniciarTemporizador(); }
export function bloquearYa() { if (leer()) desbloquear(); }

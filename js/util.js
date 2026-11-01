// Utilidades de interfaz: escapado, dinero, avisos, ventanas.

const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);
}

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export function euros(n) {
  return eur.format(Number(n) || 0);
}

export function nombreCompleto(c) {
  if (!c) return 'Clienta eliminada';
  return [c.nombre, c.apellidos].filter(Boolean).join(' ');
}

export function iniciales(c) {
  const n = nombreCompleto(c).trim().split(/\s+/);
  return ((n[0]?.[0] || '') + (n[1]?.[0] || '')).toUpperCase() || '?';
}

// Teléfono para enlaces wa.me (asume España si no lleva prefijo)
export function telefonoWhatsApp(t) {
  let d = String(t || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.length === 9) return '34' + d;
  return d;
}

// Colores de clienta: tonos de esmalte
export const ESMALTES = [
  '#C2185B', '#E57373', '#F4A6B7', '#B5838D', '#8E3B5A', '#D4A373',
  '#E9C46A', '#7FB7A4', '#5E8C9A', '#6D6875', '#9C89B8', '#C08497',
];
export function esmalteAleatorio() {
  return ESMALTES[Math.floor(Math.random() * ESMALTES.length)];
}

// ---------- Avisos ----------
let toastTimer;
export function aviso(texto, tipo = 'ok') {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.dataset.tipo = tipo;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), tipo === 'error' ? 5000 : 2800);
}

export function errorAviso(e, prefijo = 'No se pudo guardar') {
  console.error(e);
  const msg = e?.message || String(e);
  aviso(`${prefijo}: ${msg}`, 'error');
}

// ---------- Ventanas (hojas) ----------
// abrirHoja devuelve { el, cerrar }. El contenido usa [data-cerrar] para cerrar.
export function abrirHoja(html, { ancho = 'normal', alCerrar } = {}) {
  const capa = document.createElement('div');
  capa.className = 'capa';
  capa.innerHTML = `<div class="hoja hoja-${ancho}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(capa);
  const hoja = capa.firstElementChild;
  const previo = document.activeElement;

  const cerrar = () => {
    capa.classList.add('saliendo');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => capa.remove(), 160);
    previo?.focus?.();
    alCerrar?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', onKey);
  capa.addEventListener('mousedown', (e) => { if (e.target === capa) cerrar(); });
  hoja.addEventListener('click', (e) => { if (e.target.closest('[data-cerrar]')) cerrar(); });

  requestAnimationFrame(() => {
    capa.classList.add('abierta');
    hoja.querySelector('[autofocus]')?.focus();
  });
  return { el: hoja, cerrar };
}

export function confirmar(texto, { si = 'Aceptar', no = 'Cancelar', peligro = false, detalle = '' } = {}) {
  return new Promise((resolve) => {
    let respondido = false;
    const { el, cerrar } = abrirHoja(`
      <div class="hoja-cuerpo">
        <h2 class="hoja-titulo">${esc(texto)}</h2>
        ${detalle ? `<p class="texto-suave">${esc(detalle)}</p>` : ''}
      </div>
      <div class="hoja-pie">
        <button class="btn" data-r="no">${esc(no)}</button>
        <button class="btn ${peligro ? 'btn-peligro' : 'btn-principal'}" data-r="si" autofocus>${esc(si)}</button>
      </div>`, { ancho: 'estrecha', alCerrar: () => { if (!respondido) resolve(false); } });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      respondido = true;
      resolve(b.dataset.r === 'si');
      cerrar();
    });
  });
}

export function pedirTexto(titulo, { etiqueta = '', boton = 'Aceptar', peligro = false, valor = '' } = {}) {
  return new Promise((resolve) => {
    let respondido = false;
    const { el, cerrar } = abrirHoja(`
      <form class="hoja-cuerpo">
        <h2 class="hoja-titulo">${esc(titulo)}</h2>
        <label class="campo"><span>${esc(etiqueta)}</span>
          <input name="t" value="${esc(valor)}" autofocus></label>
        <div class="hoja-pie sin-borde">
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button class="btn ${peligro ? 'btn-peligro' : 'btn-principal'}">${esc(boton)}</button>
        </div>
      </form>`, { ancho: 'estrecha', alCerrar: () => { if (!respondido) resolve(null); } });
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      respondido = true;
      resolve(el.querySelector('input').value.trim());
      cerrar();
    });
  });
}

export function cargando(on) {
  document.body.classList.toggle('ocupado', !!on);
}

export function datosFormulario(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value.trim();
  }
  return o;
}

// ---------- Duración en horas y minutos ----------
// Dos casillas (horas y minutos) en lugar de escribirlo todo en minutos
export function campoDuracion(nombre, minutos, etiqueta = 'Duración') {
  const m = Math.max(0, Number(minutos) || 0);
  return `<fieldset class="campo duracion-hm">
    <legend>${esc(etiqueta)}</legend>
    <div class="hm">
      <label><input type="number" name="${nombre}_h" min="0" max="12" step="1" inputmode="numeric" value="${Math.floor(m / 60)}" aria-label="Horas"><span>h</span></label>
      <label><input type="number" name="${nombre}_m" min="0" max="59" step="5" inputmode="numeric" value="${m % 60}" aria-label="Minutos"><span>min</span></label>
    </div>
  </fieldset>`;
}
export function leerDuracion(form, nombre) {
  const h = Math.max(0, Math.floor(Number(form.elements[`${nombre}_h`].value) || 0));
  const m = Math.min(59, Math.max(0, Math.floor(Number(form.elements[`${nombre}_m`].value) || 0)));
  return h * 60 + m;
}
export function ponerDuracion(form, nombre, minutos) {
  const m = Math.max(0, Number(minutos) || 0);
  form.elements[`${nombre}_h`].value = Math.floor(m / 60);
  form.elements[`${nombre}_m`].value = m % 60;
}

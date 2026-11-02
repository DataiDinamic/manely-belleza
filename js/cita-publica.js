// Página que ve la clienta con el enlace de su cita (cita.html?t=…):
// responde «Asistiré» / «No podré ir» y la añade a su calendario.
// No necesita entrar en la app: el enlace lleva un código secreto de esa cita.
import { CONFIG } from './config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const raiz = document.getElementById('pub');
const token = new URLSearchParams(location.search).get('t') || '';
const demo = new URLSearchParams(location.search).has('demo') || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY;

const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);
const pad = (n) => String(n).padStart(2, '0');
const enumerar = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} y ${l.at(-1)}` : l[0] || '');

function aviso(texto, tipo = 'ok') {
  const el = document.getElementById('aviso');
  el.textContent = texto; el.dataset.tipo = tipo; el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3500);
}

// ---------------------------------------------------------------------
// Datos: Supabase (lo normal) o el modo demostración de este navegador
// ---------------------------------------------------------------------
let sb = null;
async function api(fn, args) {
  if (demo) return apiDemo(fn, args);
  if (!sb) {
    const { createClient } = await import(SUPABASE_JS);
    sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

function apiDemo(fn, { p_token: t, p_respuesta: r }) {
  const d = JSON.parse(localStorage.getItem('mb_demo_v1') || 'null');
  const c = d?.citas?.find((x) => x.token === t);
  if (!c) return null;
  if (fn === 'responder_cita') {
    const hoy = new Date(); const hoyISO = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
    if (!['pendiente', 'confirmada'].includes(c.estado) || c.fecha < hoyISO) throw new Error('Esta cita ya no se puede cambiar. Escríbenos por WhatsApp.');
    c.respuesta = r; c.respuesta_en = new Date().toISOString();
    if (r === 'si' && c.estado === 'pendiente') c.estado = 'confirmada';
    localStorage.setItem('mb_demo_v1', JSON.stringify(d));
  }
  const cl = d.clientas.find((x) => x.id === c.clienta_id) || {};
  const n = d.negocio || {};
  return {
    fecha: c.fecha, hora: String(c.hora_inicio).slice(0, 5), duracion_min: c.duracion_min, estado: c.estado, respuesta: c.respuesta || null,
    nombre: cl.nombre, servicios: (c.cita_servicios || []).map((s) => s.nombre), negocio: n.nombre,
    direccion: [n.direccion, [n.cp, n.poblacion].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null, telefono: n.telefono,
  };
}

// ---------------------------------------------------------------------
// Fechas y calendario
// ---------------------------------------------------------------------
const fechaDe = (iso, hhmm) => { const [y, m, d] = iso.split('-').map(Number); const [h, mi] = hhmm.split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
const textoDia = (f) => { const t = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(f); return t.charAt(0).toUpperCase() + t.slice(1); };
const horaDe = (f) => `${pad(f.getHours())}:${pad(f.getMinutes())}`;
const sello = (f) => `${f.getFullYear()}${pad(f.getMonth() + 1)}${pad(f.getDate())}T${pad(f.getHours())}${pad(f.getMinutes())}00`;

function enlaceGoogle(c, ini, fin) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Cita en ${c.negocio || 'Manely Belleza'}`,
    dates: `${sello(ini)}/${sello(fin)}`,
    ctz: 'Europe/Madrid',
    details: `${enumerar(c.servicios)}${c.telefono ? `\nTeléfono: ${c.telefono}` : ''}`,
  });
  if (c.direccion) p.set('location', c.direccion);
  return `https://calendar.google.com/calendar/render?${p}`;
}

function archivoICS(c, ini, fin) {
  const limpiar = (s) => String(s || '').replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const ahora = new Date();
  const utc = `${ahora.getUTCFullYear()}${pad(ahora.getUTCMonth() + 1)}${pad(ahora.getUTCDate())}T${pad(ahora.getUTCHours())}${pad(ahora.getUTCMinutes())}00Z`;
  const lineas = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Manely Belleza//Citas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${token}@manely-belleza`,
    `DTSTAMP:${utc}`,
    `DTSTART;TZID=Europe/Madrid:${sello(ini)}`,
    `DTEND;TZID=Europe/Madrid:${sello(fin)}`,
    `SUMMARY:${limpiar(`Cita en ${c.negocio || 'Manely Belleza'}`)}`,
    `DESCRIPTION:${limpiar(`${enumerar(c.servicios)}${c.telefono ? `\nTeléfono: ${c.telefono}` : ''}`)}`,
    ...(c.direccion ? [`LOCATION:${limpiar(c.direccion)}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Mañana tienes cita', 'TRIGGER:-P1D', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Recordatorio de tu cita', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return new Blob([lineas.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
}

// ---------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------
function pintar(c) {
  const ini = fechaDe(c.fecha, c.hora);
  const fin = new Date(ini.getTime() + (Number(c.duracion_min) || 30) * 60000);
  const activa = ['pendiente', 'confirmada'].includes(c.estado) && fin > new Date();
  document.title = `Tu cita · ${c.negocio || 'Manely Belleza'}`;
  const mapa = c.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.direccion)}` : '';
  raiz.innerHTML = `
    <header class="pub-marca"><img src="iconos/flor.png" alt="" width="40" height="40"><b>${esc(c.negocio || 'Manely Belleza')}</b></header>
    <h1>Hola${c.nombre ? ` ${esc(c.nombre)}` : ''}</h1>
    <p class="texto-suave">Estos son los datos de tu cita:</p>
    <section class="pub-cita">
      <p class="cuando">${esc(textoDia(ini))}<br>de ${horaDe(ini)} a ${horaDe(fin)}</p>
      <p class="que">${esc(enumerar(c.servicios))}</p>
      ${c.direccion ? `<p class="donde">📍 <a href="${esc(mapa)}" target="_blank" rel="noopener">${esc(c.direccion)}</a></p>` : ''}
    </section>
    ${!activa ? `<p class="pub-estado info">${c.estado === 'anulada' ? 'Esta cita está anulada.' : 'Esta cita ya ha pasado.'} Si quieres otra, escríbenos por WhatsApp.</p>` : `
      ${c.respuesta === 'si' ? '<p class="pub-estado si">✓ Has confirmado que vienes. ¡Te esperamos!</p>' : ''}
      ${c.respuesta === 'no' ? '<p class="pub-estado no">Nos has avisado de que no podrás venir. ¡Gracias por avisar! Escríbenos por WhatsApp para buscar otro día.</p>' : ''}
      ${!c.respuesta ? '<p><strong>¿Vendrás?</strong></p>' : '<p class="texto-suave">¿Ha cambiado algo? Puedes cambiar tu respuesta:</p>'}
      <div class="pub-botones">
        <button class="btn btn-verde" data-r="si" ${c.respuesta === 'si' ? 'disabled' : ''}>✓ Asistiré</button>
        <button class="btn btn-rojo" data-r="no" ${c.respuesta === 'no' ? 'disabled' : ''}>✗ No podré ir</button>
      </div>
      <h2>Añadir a mi calendario</h2>
      <div class="pub-cal">
        <a class="btn" href="${esc(enlaceGoogle(c, ini, fin))}" target="_blank" rel="noopener">Google Calendar</a>
        <button class="btn" data-ics>Otro calendario (iPhone, Samsung, Outlook…)</button>
      </div>`}
    <p class="pub-pie">${esc(c.negocio || 'Manely Belleza')}${c.telefono ? ` · ${esc(c.telefono)}` : ''}</p>`;

  raiz.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
    raiz.querySelectorAll('[data-r]').forEach((x) => { x.disabled = true; });
    try {
      const nueva = await api('responder_cita', { p_token: token, p_respuesta: b.dataset.r });
      aviso(b.dataset.r === 'si' ? '¡Gracias! Cita confirmada' : 'Gracias por avisar');
      pintar(nueva);
    } catch (e) { aviso(e.message, 'error'); pintar(c); }
  }));
  raiz.querySelector('[data-ics]')?.addEventListener('click', () => {
    const url = URL.createObjectURL(archivoICS(c, ini, fin));
    const a = document.createElement('a');
    a.href = url; a.download = `cita-${c.fecha}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    aviso('Abre el archivo descargado para añadir la cita a tu calendario');
  });
}

(async () => {
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    raiz.innerHTML = '<h1>Enlace no válido</h1><p class="texto-suave">Revisa que el enlace esté completo o pídenos uno nuevo por WhatsApp.</p>';
    return;
  }
  try {
    const c = await api('ver_cita_publica', { p_token: token });
    if (!c) { raiz.innerHTML = '<h1>Cita no encontrada</h1><p class="texto-suave">Puede que la cita se haya cambiado. Escríbenos por WhatsApp.</p>'; return; }
    pintar(c);
  } catch (e) {
    console.error(e);
    raiz.innerHTML = '<h1>No se pudo abrir la cita</h1><p class="texto-suave">Comprueba la conexión a internet e inténtalo de nuevo.</p>';
  }
})();

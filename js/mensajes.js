// Mensajes de WhatsApp a las clientas: mensajes predefinidos (iguales en
// todos los dispositivos, se cambian en Ajustes) y ventana para revisarlos
// y cambiarlos antes de abrir WhatsApp.
import * as db from './db.js';
import { esc, nombreCompleto, abrirHoja, aviso, errorAviso, cargando, telefonoWhatsApp } from './util.js';
import { textoDiaLargo, hoyISO } from './fechas.js';
import { enviarSMS } from './telefono.js';

export const ORIGINALES = {
  cita: '¡Buenas! Te confirmo la cita para [tratamientos], el día [día] a las [hora]. Para cualquier cosa escríbeme aquí y lo arreglo lo antes posible. Gracias.',
  general: '¡Hola [nombre]! ',
};
export const TITULOS = {
  cita: 'Mensaje para confirmar una cita',
  general: 'Mensaje general (desde la ficha de la clienta, cuando no tiene cita próxima)',
};
export const HUECOS = { cita: ['[nombre]', '[tratamientos]', '[día]', '[hora]'], general: ['[nombre]'] };
const CLAVE_LOCAL = 'mb_mensajes_whatsapp_v1';
const CLAVE_ANTIGUA = 'mb_plantilla_whatsapp_v1';   // versión 0.7.1 (solo el de citas, en el dispositivo)

function locales() {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE_LOCAL) || '{}');
    const antiguo = localStorage.getItem(CLAVE_ANTIGUA);
    if (antiguo && !m.cita) m.cita = antiguo;
    return m;
  } catch { return {}; }
}

export function leerMensaje(tipo) {
  const enNegocio = db.negocioActual()?.mensajes?.[tipo];
  return enNegocio || locales()[tipo] || ORIGINALES[tipo];
}

// Guarda los mensajes en el negocio (iguales en todos los dispositivos).
// Si falta el SQL 007, se quedan en este dispositivo.
export async function guardarMensajes(mensajes) {
  const limpio = {};
  for (const k of Object.keys(ORIGINALES)) if (mensajes[k] && mensajes[k].trim() !== ORIGINALES[k].trim()) limpio[k] = mensajes[k].trim();
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(limpio)); localStorage.removeItem(CLAVE_ANTIGUA); } catch { /* */ }
  try {
    await db.guardarNegocio({ mensajes: limpio });
    return 'todos';
  } catch (e) {
    if (/mensajes/.test(e.message)) return 'dispositivo';
    throw e;
  }
}

const enumerar = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} y ${l.at(-1)}` : l[0] || '');
export function rellenar(plantilla, { clienta, cita }) {
  const datos = { nombre: clienta?.nombre || '' };
  if (cita) {
    datos.tratamientos = enumerar(cita.servicios.map((x) => x.nombre.trim()));
    datos['día'] = datos.dia = textoDiaLargo(cita.fecha).replace(',', '');
    datos.hora = cita.hora;
  }
  return plantilla.replace(/\[(nombre|tratamientos|día|dia|hora)\]/gi, (m, k) => datos[k.toLowerCase()] ?? m);
}

// Ventana para revisar y cambiar el mensaje antes de abrir WhatsApp.
// cita es opcional; citas (opcional) son las próximas de la clienta, para elegir.
export function abrirMensajeWhatsApp({ clienta, cita = null, citas = [], alConfirmar }) {
  const tel = telefonoWhatsApp(clienta?.telefono);
  if (!tel) return aviso('Esta clienta no tiene teléfono.', 'error');
  const sinWhatsApp = clienta.whatsapp === false;
  let medio = sinWhatsApp ? 'sms' : 'whatsapp';
  const opciones = cita ? [cita] : citas;
  let actual = opciones[0] || null;
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <div><h2 class="hoja-titulo">Mensaje a la clienta</h2>
          <p class="texto-suave">Para ${esc(nombreCompleto(clienta))} · ${esc(clienta?.telefono || '')}</p></div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <div class="segmentos medio-mensaje" role="radiogroup" aria-label="Enviar por">
          <button type="button" data-medio="whatsapp" ${sinWhatsApp ? 'disabled title="No tiene WhatsApp"' : ''}>WhatsApp</button>
          <button type="button" data-medio="sms">SMS</button>
        </div>
        ${clienta?.whatsapp === false ? '<p class="texto-suave">Esta clienta no tiene WhatsApp.</p>' : ''}
        ${!cita && citas.length ? `<label class="campo"><span>Sobre</span><select name="sobre">
          ${citas.map((x, i) => `<option value="${i}">Su cita del ${esc(textoDiaLargo(x.fecha).toLowerCase())} a las ${esc(x.hora)}</option>`).join('')}
          <option value="general">Mensaje general (sin cita)</option></select></label>` : ''}
        <label class="campo"><span>Mensaje (se puede cambiar antes de enviarlo)</span>
          <textarea name="texto" rows="6"></textarea></label>
        <label class="check con-enlace" hidden><input type="checkbox" name="enlace" checked> Incluir el enlace para que confirme si viene y la guarde en su calendario</label>
        <label class="check confirmar-cita" hidden><input type="checkbox" name="confirmar" checked> Marcar la cita como confirmada</label>
        <p class="texto-suave">Los mensajes predefinidos se cambian en <a href="#ajustes" data-cerrar>Ajustes → Mensajes de WhatsApp</a>.</p>
      </div>
      <footer class="hoja-pie">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-whatsapp" data-enviar>Abrir WhatsApp</button>
      </footer>
    </form>`, { ancho: 'normal' });
  const f = el.querySelector('form');
  const pintarMedio = () => {
    el.querySelectorAll('[data-medio]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.medio === medio)));
    const b = el.querySelector('[data-enviar]');
    b.textContent = medio === 'sms' ? 'Enviar SMS' : 'Abrir WhatsApp';
    b.classList.toggle('btn-whatsapp', medio !== 'sms');
    b.classList.toggle('btn-principal', medio === 'sms');
  };
  el.querySelector('.medio-mensaje').addEventListener('click', (e) => {
    const b = e.target.closest('[data-medio]'); if (b) { medio = b.dataset.medio; pintarMedio(); }
  });
  pintarMedio();
  // Línea con el enlace de la cita (se añade o se quita con la casilla)
  const lineaEnlace = () => (actual?.token ? `\n\nConfirma si vienes y guárdala en tu calendario aquí: ${enlaceCita(actual)}` : '');
  const ponerEnlace = () => {
    const t = f.elements.texto;
    const linea = lineaEnlace();
    const sin = t.value.replace(/\n*Confirma si vienes y guárdala en tu calendario aquí: \S+/, '');
    t.value = f.elements.enlace.checked && linea ? sin.replace(/\s+$/, '') + linea : sin;
  };
  const pintar = () => {
    f.elements.texto.value = rellenar(leerMensaje(actual ? 'cita' : 'general'), { clienta, cita: actual });
    el.querySelector('.confirmar-cita').hidden = !(actual && actual.estado === 'pendiente');
    el.querySelector('.con-enlace').hidden = !actual?.token;
    // Con el enlace, la cita se confirma cuando ella responda; sin él, se puede marcar ya
    f.elements.confirmar.checked = !actual?.token;
    ponerEnlace();
  };
  f.elements.enlace.addEventListener('change', ponerEnlace);
  f.elements.sobre?.addEventListener('change', (e) => { actual = e.target.value === 'general' ? null : citas[Number(e.target.value)]; pintar(); });
  pintar();
  setTimeout(() => { const t = f.elements.texto; t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 120);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = f.elements.texto.value.trim();
    if (!texto) return aviso('Escribe el mensaje.', 'error');
    cerrar();
    // WhatsApp o SMS se abren con el mensaje escrito: allí solo queda pulsar «Enviar»
    if (medio === 'sms') enviarSMS(clienta, texto);
    else window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    if (actual?.estado === 'pendiente' && f.elements.confirmar.checked) {
      try {
        cargando(true);
        await db.cambiarEstadoCita(actual.id, 'confirmada');
        window.dispatchEvent(new Event('mb:datos'));
        aviso('Cita confirmada');
        alConfirmar?.();
      } catch (err) { errorAviso(err); } finally { cargando(false); }
    }
  });
}

// Enlace de la página de la cita para la clienta (cita.html)
export function enlaceCita(cita) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}cita.html?t=${cita.token}${db.modo === 'demo' ? '&demo' : ''}`;
}

// ¿Preparar el mensaje al guardar una cita nueva? (por dispositivo; sí por defecto)
const CLAVE_AL_CREAR = 'mb_mensaje_al_crear_v1';
export function mensajeAlCrear() { try { return localStorage.getItem(CLAVE_AL_CREAR) !== 'no'; } catch { return true; } }
export function fijarMensajeAlCrear(si) { try { localStorage.setItem(CLAVE_AL_CREAR, si ? 'si' : 'no'); } catch { /* */ } }

// Próximas citas activas de una clienta (para el botón WhatsApp de su ficha)
export function proximasCitas(citas) {
  const hoy = hoyISO();
  return citas.filter((x) => x.fecha >= hoy && ['pendiente', 'confirmada'].includes(x.estado))
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)).slice(0, 5);
}

// ¿Se le puede escribir o videollamar por WhatsApp? (sin dato = sí)
export function tieneWhatsApp(c) {
  return !!c && c.whatsapp !== false && !!telefonoWhatsApp(c.telefono);
}

// Videollamada: WhatsApp no deja que otra app empiece la llamada sola.
// Se abre el chat de la clienta y allí se toca el icono de la cámara.
const CLAVE_VIDEO = 'mb_videollamada_explicada_v1';
export function abrirVideollamada(clienta) {
  const tel = telefonoWhatsApp(clienta?.telefono);
  if (!tieneWhatsApp(clienta)) return aviso('Esta clienta no tiene WhatsApp.', 'error');
  const abrir = () => window.open(`https://wa.me/${tel}`, '_blank', 'noopener');
  let explicado = false;
  try { explicado = !!localStorage.getItem(CLAVE_VIDEO); } catch { /* */ }
  if (explicado) { abrir(); return aviso('En el chat, toca la cámara 📹 de arriba para la videollamada'); }
  const { el, cerrar } = abrirHoja(`
    <div class="hoja-cuerpo">
      <h2 class="hoja-titulo">Videollamada por WhatsApp</h2>
      <p>Se abrirá el chat de <strong>${esc(nombreCompleto(clienta))}</strong> en WhatsApp. Para empezar la videollamada, toca el icono de la <strong>cámara 📹</strong> arriba a la derecha (el del teléfono 📞 es para una llamada de voz).</p>
      <p class="texto-suave">WhatsApp no permite que otra app empiece la llamada sola: hace falta ese toque.</p>
      <div class="hoja-pie sin-borde">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button type="button" class="btn btn-whatsapp" data-abrir>Abrir WhatsApp</button>
      </div>
    </div>`, { ancho: 'estrecha' });
  el.querySelector('[data-abrir]').addEventListener('click', () => {
    try { localStorage.setItem(CLAVE_VIDEO, '1'); } catch { /* */ }
    cerrar(); abrir();
  });
}

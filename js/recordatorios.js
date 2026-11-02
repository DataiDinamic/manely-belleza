// Recordatorios a las clientas:
//  - «Añadir aviso»: la app avisa (con sonido) a la hora elegida con el
//    mensaje ya preparado, para mandarlo con un toque.
//  - Varias clientas a la vez (por ejemplo, todas las de la semana).
//  - «Recordatorios de mañana»: cada día, al empezar la jornada, la lista
//    de clientas de mañana con su recordatorio listo para enviar.
import * as db from './db.js';
import { esc, nombreCompleto, abrirHoja, aviso, errorAviso, cargando } from './util.js';
import { hoyISO, sumarDias, textoDiaLargo, desdeISO, aMinutos, horaCorta } from './fechas.js';
import { leerAjustes } from './ajustes.js';
import { abrirMensajeWhatsApp, tieneWhatsApp, rellenar, leerMensaje, enlaceCita, abrirEnvio, HUECOS } from './mensajes.js';

const pad = (n) => String(n).padStart(2, '0');
const aInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const momentoCita = (c) => { const [y, m, d] = c.fecha.split('-').map(Number); const [h, mi] = horaCorta(c.hora || c.hora_inicio).split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
const lineaEnlace = (c) => (c?.token ? `\n\nConfirma si vienes y guárdala en tu calendario aquí: ${enlaceCita(c)}` : '');
export const textoFechaHora = (d) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
const cambio = () => window.dispatchEvent(new Event('mb:datos'));

// Cuándo avisar respecto a la cita
const CUANDO = {
  h24: { texto: '24 h antes de la cita', calc: (c) => new Date(momentoCita(c).getTime() - 24 * 36e5) },
  h48: { texto: '2 días antes', calc: (c) => new Date(momentoCita(c).getTime() - 48 * 36e5) },
  apertura: { texto: 'El día antes, al abrir', calc: (c) => { const d = momentoCita(c); d.setDate(d.getDate() - 1); const [h, m] = leerAjustes().apertura.split(':').map(Number); d.setHours(h, m || 0, 0, 0); return d; } },
};
// Si la hora ya ha pasado, avisa enseguida
const noAntesDeAhora = (d) => (d.getTime() < Date.now() ? new Date(Date.now() + 60000) : d);

// ---------------------------------------------------------------------
// Programar (o editar) un mensaje para una clienta
// ---------------------------------------------------------------------
export function programarMensaje({ clienta, cita = null, texto, medio = 'whatsapp', programado = null, alGuardar }) {
  const editar = !!programado;
  let cuando = editar ? 'manual' : cita ? 'h24' : 'manual';
  const inicial = editar ? new Date(programado.avisar_en) : cita ? noAntesDeAhora(CUANDO.h24.calc(cita)) : new Date(Date.now() + 36e5);
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <div><h2 class="hoja-titulo">${editar ? 'Editar aviso' : 'Añadir aviso'}</h2>
          <p class="texto-suave">Para ${esc(nombreCompleto(clienta))}${cita ? ` · cita del ${esc(textoDiaLargo(cita.fecha).toLowerCase())} a las ${esc(cita.hora || horaCorta(cita.hora_inicio))}` : ''}</p></div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <label class="campo"><span>Mensaje</span><textarea name="texto" rows="6">${esc(texto)}</textarea></label>
        <div class="campo"><span>¿Cuándo te aviso para mandarlo?</span>
          ${cita ? `<div class="segmentos cuando-aviso" role="radiogroup">
            ${Object.entries(CUANDO).map(([k, v]) => `<button type="button" data-cuando="${k}">${v.texto}</button>`).join('')}
            <button type="button" data-cuando="manual">Otra hora</button>
          </div>` : ''}
          <input type="datetime-local" name="avisar_en" value="${aInput(inicial)}">
        </div>
        <p class="nota-cuando texto-suave"></p>
        <p class="texto-suave">A esa hora la app sonará y te enseñará el mensaje: con un toque se abre ${medio === 'sms' ? 'el SMS' : 'WhatsApp'} con el texto escrito y solo queda enviarlo. La app tiene que estar abierta (aunque sea en segundo plano); si está cerrada, el aviso sale al abrirla.</p>
      </div>
      <footer class="hoja-pie">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-lila">${editar ? 'Guardar cambios' : 'Guardar aviso'}</button>
      </footer>
    </form>`, { ancho: 'normal' });
  const f = el.querySelector('form');
  const nota = el.querySelector('.nota-cuando');
  const pintar = () => {
    el.querySelectorAll('[data-cuando]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cuando === cuando)));
    if (cita && CUANDO[cuando]) {
      const d = CUANDO[cuando].calc(cita);
      f.elements.avisar_en.value = aInput(noAntesDeAhora(d));
      nota.textContent = d.getTime() < Date.now() ? 'Esa hora ya ha pasado: te avisará enseguida.' : `Te avisará el ${textoFechaHora(d)}.`;
    } else nota.textContent = '';
  };
  el.querySelector('.cuando-aviso')?.addEventListener('click', (e) => { const b = e.target.closest('[data-cuando]'); if (b) { cuando = b.dataset.cuando; pintar(); } });
  f.elements.avisar_en.addEventListener('input', () => { cuando = 'manual'; pintar(); });
  pintar();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = f.elements.texto.value.trim();
    const v = f.elements.avisar_en.value;
    if (!t) return aviso('Escribe el mensaje.', 'error');
    if (!v) return aviso('Elige cuándo avisar.', 'error');
    const d = new Date(v);
    try {
      cargando(true);
      await db.guardarProgramado({ id: programado?.id, clienta_id: clienta.id, cita_id: cita?.id || null, texto: t, medio,
        avisar_en: d.toISOString(), activo: true, enviado_en: null });
      aviso(`Aviso guardado: ${textoFechaHora(d)}`);
      cerrar(); cambio(); alGuardar?.();
    } catch (err) { errorAviso(err, /mensajes_programados/.test(err.message) ? 'Falta ejecutar supabase/010_programados.sql' : 'No se pudo guardar el aviso'); }
    finally { cargando(false); }
  });
}

// ---------------------------------------------------------------------
// Avisos para varias clientas a la vez (sus próximas citas)
// ---------------------------------------------------------------------
export async function programarVarias(alGuardar) {
  const hoy = hoyISO();
  let desde = sumarDias(hoy, 1), hasta = sumarDias(hoy, 7);
  let cuando = 'h24';
  let citas = [], pendientes = [];
  const { el, cerrar } = abrirHoja(`
    <form novalidate class="form-varias">
      <header class="hoja-cabecera">
        <div><h2 class="hoja-titulo">Añadir avisos</h2>
          <p class="texto-suave">Elige las citas: para cada una la app te avisará con su recordatorio listo para enviar.</p></div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <div class="fila-2">
          <label class="campo"><span>Citas desde</span><input type="date" name="desde" value="${desde}"></label>
          <label class="campo"><span>hasta</span><input type="date" name="hasta" value="${hasta}"></label>
        </div>
        <div class="lista-varias"><p class="cargando-texto">Cargando citas…</p></div>
        <div class="campo"><span>¿Cuándo te aviso?</span>
          <div class="segmentos cuando-aviso" role="radiogroup">${Object.entries(CUANDO).map(([k, v]) => `<button type="button" data-cuando="${k}" aria-pressed="${k === cuando}">${v.texto}</button>`).join('')}</div></div>
        <div class="campo"><span>Mensaje (se adapta a cada clienta)</span>
          <div class="huecos">${HUECOS.recordatorio.map((h) => `<button type="button" class="chip-hueco" data-hueco="${h}">${h}</button>`).join('')}</div>
          <textarea name="plantilla" rows="4">${esc(leerMensaje('recordatorio'))}</textarea></div>
        <label class="check"><input type="checkbox" name="enlace" checked> Incluir el enlace para que confirme y la guarde en su calendario</label>
      </div>
      <footer class="hoja-pie">
        <p class="resumen-cita" aria-live="polite"></p>
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-lila">Guardar avisos</button>
      </footer>
    </form>`, { ancho: 'ancha' });
  const f = el.querySelector('form');
  const zona = el.querySelector('.lista-varias');
  const resumen = () => { const n = f.querySelectorAll('[name=cita]:checked').length; el.querySelector('.resumen-cita').textContent = `${n} ${n === 1 ? 'clienta' : 'clientas'}`; };
  async function cargar() {
    zona.innerHTML = '<p class="cargando-texto">Cargando citas…</p>';
    try {
      [citas, pendientes] = await Promise.all([db.citasEntre(desde, hasta), db.listarProgramados({ pendientes: true }).catch(() => [])]);
    } catch (e) { zona.innerHTML = ''; return errorAviso(e); }
    citas = citas.filter((c) => ['pendiente', 'confirmada'].includes(c.estado) && c.clienta?.telefono && momentoCita(c) > new Date());
    const conAviso = new Set(pendientes.filter((m) => m.activo).map((m) => m.cita_id));
    zona.innerHTML = citas.length ? `<ul class="lista-elegir">${citas.map((c) => `
      <li><label class="check">
        <input type="checkbox" name="cita" value="${c.id}" ${conAviso.has(c.id) ? '' : 'checked'}>
        <span><b>${esc(textoDiaLargo(c.fecha))} · ${esc(c.hora)}</b> ${esc(nombreCompleto(c.clienta))}
          <small>${esc(c.servicios.map((s) => s.nombre).join(', '))}${tieneWhatsApp(c.clienta) ? '' : ' · por SMS'}${conAviso.has(c.id) ? ' · <em>ya tiene aviso</em>' : ''}${c.respuesta === 'si' ? ' · ✓ ya ha confirmado' : ''}</small></span>
      </label></li>`).join('')}</ul>`
      : '<p class="texto-suave">No hay citas con teléfono en esas fechas.</p>';
    resumen();
  }
  f.addEventListener('change', (e) => {
    if (e.target.name === 'desde' || e.target.name === 'hasta') { desde = f.elements.desde.value || desde; hasta = f.elements.hasta.value || hasta; cargar(); }
    resumen();
  });
  el.querySelector('.cuando-aviso').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cuando]'); if (!b) return;
    cuando = b.dataset.cuando;
    el.querySelectorAll('[data-cuando]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  el.querySelector('.huecos').addEventListener('click', (e) => {
    const h = e.target.closest('[data-hueco]'); if (!h) return;
    const ta = f.elements.plantilla; const i = ta.selectionStart ?? ta.value.length, j = ta.selectionEnd ?? i;
    ta.value = ta.value.slice(0, i) + h.dataset.hueco + ta.value.slice(j); ta.focus();
  });
  cargar();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = [...f.querySelectorAll('[name=cita]:checked')].map((x) => x.value);
    if (!ids.length) return aviso('Elige al menos una cita.', 'error');
    const plantilla = f.elements.plantilla.value.trim() || leerMensaje('recordatorio');
    const lista = ids.map((id) => {
      const c = citas.find((x) => x.id === id);
      return { clienta_id: c.clienta_id, cita_id: c.id, medio: tieneWhatsApp(c.clienta) ? 'whatsapp' : 'sms', activo: true, enviado_en: null,
        texto: rellenar(plantilla, { clienta: c.clienta, cita: c }) + (f.elements.enlace.checked ? lineaEnlace(c) : ''),
        avisar_en: noAntesDeAhora(CUANDO[cuando].calc(c)).toISOString() };
    });
    try {
      cargando(true);
      await db.guardarProgramados(lista);
      aviso(`${lista.length} ${lista.length === 1 ? 'aviso guardado' : 'avisos guardados'}`);
      cerrar(); cambio(); alGuardar?.();
    } catch (err) { errorAviso(err, /mensajes_programados/.test(err.message) ? 'Falta ejecutar supabase/010_programados.sql' : 'No se pudieron guardar'); }
    finally { cargando(false); }
  });
}

// ---------------------------------------------------------------------
// Recordatorios de mañana (próximo día con citas, como mucho en 3 días)
// ---------------------------------------------------------------------
const CLAVE_ENVIADOS = 'mb_recordados_v1';
const enviados = () => { try { return JSON.parse(localStorage.getItem(CLAVE_ENVIADOS) || '{}'); } catch { return {}; } };
function marcarEnviado(id) {
  const e = enviados(); e[id] = hoyISO();
  const limite = sumarDias(hoyISO(), -30);
  for (const [k, v] of Object.entries(e)) if (v < limite) delete e[k];
  try { localStorage.setItem(CLAVE_ENVIADOS, JSON.stringify(e)); } catch { /* */ }
}

export async function recordatoriosDeManana({ automatico = false, alAbrir } = {}) {
  const hoy = hoyISO();
  let citas = [];
  try { citas = await db.citasEntre(sumarDias(hoy, 1), sumarDias(hoy, 3)); } catch (e) { if (!automatico) errorAviso(e); return false; }
  citas = citas.filter((c) => ['pendiente', 'confirmada'].includes(c.estado) && c.clienta?.telefono);
  const dia = citas[0]?.fecha;
  const delDia = citas.filter((c) => c.fecha === dia);
  if (!delDia.length) { if (!automatico) aviso('No hay citas en los próximos días a las que recordar.'); return false; }
  alAbrir?.();
  const etiqueta = dia === sumarDias(hoy, 1) ? 'mañana' : textoDiaLargo(dia).toLowerCase();
  const { el } = abrirHoja(`
    <header class="hoja-cabecera">
      <div><h2 class="hoja-titulo">Recordatorios de ${esc(etiqueta)}</h2>
        <p class="texto-suave">${esc(textoDiaLargo(dia))} · ${delDia.length} ${delDia.length === 1 ? 'clienta' : 'clientas'}. Toca cada una: se abre ${'WhatsApp'} con el recordatorio escrito y solo queda enviarlo.</p></div>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo"><ul class="lista-recordatorios"></ul></div>
    <footer class="hoja-pie"><button type="button" class="btn btn-principal" data-cerrar>Hecho</button></footer>`, { ancho: 'normal' });
  const ul = el.querySelector('.lista-recordatorios');
  const pintar = () => {
    const env = enviados();
    ul.innerHTML = delDia.map((c) => {
      const hecho = !!env[c.id];
      const wa = tieneWhatsApp(c.clienta);
      return `<li class="${hecho ? 'enviado' : ''}">
        <time>${esc(c.hora)}</time>
        <span><strong>${esc(nombreCompleto(c.clienta))}</strong><small>${esc(c.servicios.map((s) => s.nombre).join(', '))}${c.respuesta === 'si' ? ' · ✓ ya ha confirmado' : c.respuesta === 'no' ? ' · ✗ avisó que no vendrá' : ''}</small></span>
        ${hecho ? '<em>Enviado ✓</em>' : ''}
        <button type="button" class="btn btn-mini ${wa ? 'btn-whatsapp' : 'btn-principal'}" data-recordar="${c.id}">${hecho ? 'Otra vez' : wa ? 'WhatsApp' : 'SMS'}</button>
      </li>`;
    }).join('');
  };
  pintar();
  ul.addEventListener('click', (e) => {
    const b = e.target.closest('[data-recordar]'); if (!b) return;
    const c = delDia.find((x) => x.id === b.dataset.recordar);
    abrirMensajeWhatsApp({ clienta: c.clienta, cita: c, tipo: 'recordatorio', alEnviar: () => { marcarEnviado(c.id); pintar(); } });
  });
  return true;
}

// ¿Toca enseñar hoy los recordatorios? (la primera vez del día, dentro del horario)
const CLAVE_DIARIO = 'mb_recordatorio_diario_v1';
export function tocaRecordatorioDiario() {
  const aj = leerAjustes();
  const ahora = new Date();
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  if (min < aMinutos(aj.apertura) || min >= aMinutos(aj.cierre)) return false;
  try { return localStorage.getItem(CLAVE_DIARIO) !== hoyISO(); } catch { return false; }
}
export function apuntarRecordatorioDiario() { try { localStorage.setItem(CLAVE_DIARIO, hoyISO()); } catch { /* */ } }

// Enviar ahora un mensaje programado (desde el aviso o la tabla de tareas)
export async function enviarProgramado(m) {
  abrirEnvio(m.clienta, m.texto, m.medio);
  if (m.cita_id) marcarEnviado(m.cita_id);
  try { await db.cambiarProgramado(m.id, { enviado_en: new Date().toISOString() }); cambio(); }
  catch (e) { errorAviso(e); }
}

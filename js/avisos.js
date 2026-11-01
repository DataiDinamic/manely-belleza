// Avisos: calcula las fechas de los gastos y obligaciones que se repiten
// y avisa con sonido de lo que toca (y de las citas con aviso previo).
// Funciona mientras la app está abierta (también en segundo plano o en otra
// pestaña). Con la app cerrada, el aviso salta al volver a abrirla.
import * as db from './db.js';
import { esc, euros, nombreCompleto } from './util.js';
import { hoyISO, sumarDias, isoDe, textoDiaLargo, horaCorta } from './fechas.js';

// ---------------------------------------------------------------------
// Fechas que se repiten
// ---------------------------------------------------------------------
const diasEntre = (a, b) => Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 864e5);
function ymd(iso) { const [y, m, d] = iso.split('-').map(Number); return [y, m - 1, d]; }

// Suma meses sin pasarse de mes: el día 31 en noviembre es el 30.
// «dia» es el día elegido (el 31 sigue siendo 31 en los meses que lo tienen).
function sumarMesesDia(iso, n, dia) {
  const [y, m, d] = ymd(iso);
  const ultimo = new Date(y, m + n + 1, 0).getDate();
  return isoDe(new Date(y, m + n, Math.min(dia || d, ultimo)));
}

// La k-ésima fecha (0 = la primera)
export function fechaNumero(o, k) {
  const ini = o.fecha_inicio, n = k * (Number(o.cada) || 1);
  switch (o.repeticion) {
    case 'una_vez': return k === 0 ? ini : null;
    case 'dias': return sumarDias(ini, n);
    case 'semanas': return sumarDias(ini, 7 * n);
    case 'anios': return sumarMesesDia(ini, 12 * n, o.dia);
    default: return sumarMesesDia(ini, n, o.dia);
  }
}

// Todas las fechas entre «desde» y «hasta» (incluidas)
export function ocurrencias(o, desde, hasta) {
  if (!o.fecha_inicio) return [];
  const fin = o.fecha_fin && o.fecha_fin < hasta ? o.fecha_fin : hasta;
  const cada = Number(o.cada) || 1;
  let k = 0;
  if (desde > o.fecha_inicio) {
    const d = diasEntre(o.fecha_inicio, desde);
    if (o.repeticion === 'dias') k = Math.floor(d / cada);
    else if (o.repeticion === 'semanas') k = Math.floor(d / (7 * cada));
    else if (o.repeticion === 'meses') k = Math.max(0, Math.floor(d / (31 * cada)) - 1);
    else if (o.repeticion === 'anios') k = Math.max(0, Math.floor(d / (366 * cada)) - 1);
  }
  const lista = [];
  for (let i = 0; i < 1000; i++, k++) {
    const f = fechaNumero(o, k);
    if (!f || f > fin) break;
    if (f >= desde) lista.push(f);
  }
  return lista;
}

export function proximaFecha(o, desde = hoyISO()) {
  return ocurrencias(o, desde, sumarDias(desde, 3700))[0] || null;
}

const UNIDADES_AVISO = { minutos: ['minuto', 'minutos'], horas: ['hora', 'horas'], dias: ['día', 'días'], semanas: ['semana', 'semanas'] };
export function textoAntelacion(cantidad, unidad, recordar) {
  if (cantidad === null || cantidad === undefined || cantidad === '') return 'sin aviso';
  const [s, p] = UNIDADES_AVISO[unidad] || UNIDADES_AVISO.dias;
  const base = Number(cantidad) === 0 ? 'aviso a la hora' : `aviso ${cantidad} ${Number(cantidad) === 1 ? s : p} antes`;
  if (recordar === undefined) return base;
  return `${base} · ${recordar === 'no' ? 'una sola vez' : 'recuerda cada día'}`;
}
export function textoMinutosAntes(min) {
  if (min === null || min === undefined) return 'Sin aviso';
  if (min === 0) return 'A la hora de la cita';
  if (min === 1440) return '24 horas antes';
  if (min % 1440 === 0) return `${min / 1440} días antes`;
  if (min % 60 === 0) return `${min / 60} ${min === 60 ? 'hora' : 'horas'} antes`;
  return `${min} min antes`;
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Periodos de la sección Avisos
export const PERIODOS = {
  anio: { nombre: 'Año', repeticion: 'anios', cada: 1 },
  trimestre: { nombre: 'Trimestre', repeticion: 'meses', cada: 3 },
  mes: { nombre: 'Mes', repeticion: 'meses', cada: 1 },
  semana: { nombre: 'Semana', repeticion: 'semanas', cada: 1 },
  dia: { nombre: 'Día', repeticion: 'dias', cada: 1 },
  puntual: { nombre: 'Puntual', repeticion: 'una_vez', cada: 1 },
};
export function periodoDe(o) {
  const cada = Number(o.cada) || 1;
  for (const [k, p] of Object.entries(PERIODOS)) if (p.repeticion === o.repeticion && (p.repeticion === 'una_vez' || p.cada === cada)) return k;
  return 'otro';
}
export const NOMBRES_MESES = MESES;
export const NOMBRES_DIAS = DIAS_SEMANA;
const TRIMESTRE_MESES = ['enero, abril, julio y octubre', 'febrero, mayo, agosto y noviembre', 'marzo, junio, septiembre y diciembre'];

export function textoRepeticion(o) {
  const [y, m, d0] = ymd(o.fecha_inicio);
  const d = o.dia || d0;
  const cada = Number(o.cada) || 1;
  if (o.repeticion === 'meses' && cada === 3) return `Cada trimestre, el día ${d} (${TRIMESTRE_MESES[m % 3]})`;
  switch (o.repeticion) {
    case 'una_vez': return `Una vez, el ${d} de ${MESES[m]} de ${y}`;
    case 'dias': return cada === 1 ? 'Todos los días' : `Cada ${cada} días`;
    case 'semanas': return `${cada === 1 ? 'Cada semana' : `Cada ${cada} semanas`}, los ${DIAS_SEMANA[new Date(y, m, d).getDay()]}`;
    case 'anios': return `${cada === 1 ? 'Cada año' : `Cada ${cada} años`}, el ${d} de ${MESES[m]}`;
    default: return cada === 1 ? `Cada mes, el día ${d}` : cada === 3 ? `Cada 3 meses (trimestral), el día ${d}` : `Cada ${cada} meses, el día ${d}`;
  }
}

// Momento exacto de una fecha y hora locales, y del aviso previo
function momento(fecha, hora) { const [y, m, d] = ymd(fecha); const [hh, mm] = String(hora || '10:00').split(':').map(Number); return new Date(y, m, d, hh, mm || 0); }
export function momentoAviso(fecha, hora, cantidad, unidad) {
  const t = momento(fecha, hora);
  const n = Number(cantidad) || 0;
  if (unidad === 'minutos') return new Date(t.getTime() - n * 6e4);
  if (unidad === 'horas') return new Date(t.getTime() - n * 36e5);
  t.setDate(t.getDate() - n * (unidad === 'semanas' ? 7 : 1));   // días y semanas: misma hora del reloj
  return t;
}

// ---------------------------------------------------------------------
// Lo pendiente: fechas sin pagar/hacer (atrasadas y próximas)
// ---------------------------------------------------------------------
const ATRAS_DIAS = 90;
export async function pendientes({ dias = 45 } = {}) {
  const hoy = hoyISO();
  const desde = sumarDias(hoy, -ATRAS_DIAS), hasta = sumarDias(hoy, dias);
  const [obs, regs] = await Promise.all([db.listarObligaciones(), db.registrosPrevistos(desde, sumarDias(hoy, 400))]);
  const hechas = new Set(regs.map((r) => `${r.obligacion_id}|${r.fecha_prevista}`));
  const ahora = new Date();
  const lista = [];
  for (const o of obs) {
    if (o.activo === false) continue;
    // Las fechas de antes de apuntarlo en la app no cuentan como atrasadas
    const alta = o.created_at ? isoDe(new Date(o.created_at)) : desde;
    for (const f of ocurrencias(o, alta > desde ? alta : desde, hasta)) {
      if (hechas.has(`${o.id}|${f}`)) continue;
      const vence = momento(f, o.hora);
      const avisa = o.aviso_cantidad === null ? null : momentoAviso(f, o.hora, o.aviso_cantidad, o.aviso_unidad);
      lista.push({ o, fecha: f, vence, avisa, atrasada: f < hoy, hoy: f === hoy, avisando: (!!avisa && avisa <= ahora) || vence <= ahora });
    }
  }
  return lista.sort((a, b) => a.vence - b.vence);
}

// ---------------------------------------------------------------------
// Ajustes de avisos (por dispositivo)
// ---------------------------------------------------------------------
const CLAVE_AJ = 'mb_avisos_ajustes_v1';
const CLAVE_VISTOS = 'mb_avisos_vistos_v1';
export function ajustesAvisos() {
  try { return { activos: true, sonido: true, ...JSON.parse(localStorage.getItem(CLAVE_AJ) || '{}') }; }
  catch { return { activos: true, sonido: true }; }
}
export function guardarAjustesAvisos(cambios) {
  const a = { ...ajustesAvisos(), ...cambios };
  try { localStorage.setItem(CLAVE_AJ, JSON.stringify(a)); } catch { /* */ }
  return a;
}
// vistos[clave] = 'ok' (ya avisado) o un instante (pospuesto hasta entonces)
function leerVistos() { try { return JSON.parse(localStorage.getItem(CLAVE_VISTOS) || '{}'); } catch { return {}; } }
function guardarVistos(v) {
  const limite = Date.now() - 120 * 864e5;
  for (const [k, x] of Object.entries(v)) if (x?.t && x.t < limite) delete v[k];
  try { localStorage.setItem(CLAVE_VISTOS, JSON.stringify(v)); } catch { /* */ }
}
function marcar(clave, hasta = 'ok') { const v = leerVistos(); v[clave] = { h: hasta, t: Date.now() }; guardarVistos(v); }
function toca(v, clave, ahora) { const x = v[clave]; return !x || (typeof x.h === 'number' && x.h <= ahora); }

// ---------------------------------------------------------------------
// Sonido (campanita generada, sin archivos) y vibración
// ---------------------------------------------------------------------
let audio = null;
function prepararAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* sin audio */ }
}
// El navegador solo deja sonar tras un toque: se prepara con el primero
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, prepararAudio, { capture: true, passive: true }));

export function sonar() {
  try { navigator.vibrate?.([250, 120, 250, 120, 400]); } catch { /* */ }
  if (!ajustesAvisos().sonido) return;
  prepararAudio();
  if (!audio) return;
  const t0 = audio.currentTime + 0.05;
  const nota = (frec, t, dur = 1.4, vol = 0.32) => {
    for (const [mult, v] of [[1, 1], [2.76, 0.28], [5.4, 0.1]]) {   // parciales de campana
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = frec * mult;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * v, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / mult ** 0.3);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + dur + 0.1);
    }
  };
  nota(1318.5, t0); nota(1046.5, t0 + 0.32); nota(1318.5, t0 + 0.95); nota(1046.5, t0 + 1.27);
}

// ---------------------------------------------------------------------
// Notificaciones del sistema (cuando la app está en segundo plano)
// ---------------------------------------------------------------------
export const notificacionesPosibles = () => 'Notification' in window;
export async function pedirPermisoNotificaciones() {
  if (!notificacionesPosibles()) return 'no';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}
async function notificar(titulo, cuerpo, clave) {
  if (!notificacionesPosibles() || Notification.permission !== 'granted') return;
  const opciones = { body: cuerpo, tag: clave, icon: 'iconos/icon-192.png', badge: 'iconos/icon-192.png', requireInteraction: true, renotify: true, data: { url: location.pathname + '#avisos' } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(titulo, opciones);
    new Notification(titulo, opciones);   // eslint-disable-line no-new
  } catch { /* */ }
}

// ---------------------------------------------------------------------
// Motor: revisa cada 20 segundos qué toca avisar
// ---------------------------------------------------------------------
let datos = { items: [], citas: [], cargado: 0 };
let reloj = null, recarga = null, activo = false;
let enPantalla = new Map();   // clave -> aviso mostrado
let repiques = 0, temporizadorRepique = null;

export function iniciar() {
  if (activo) return;
  activo = true;
  refrescar();
  reloj = setInterval(revisar, 20000);
  recarga = setInterval(refrescar, 5 * 60000);
  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener('mb:datos', refrescarPronto);
  window.addEventListener('hashchange', pintarInsignia);
  // Al bloquear o desbloquear con el PIN cambian los botones de los avisos
  observador ||= new MutationObserver(() => { if (enPantalla.size) pintarAlarmas(); });
  observador.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
let observador = null;
export function parar() {
  activo = false;
  clearInterval(reloj); clearInterval(recarga);
  document.removeEventListener('visibilitychange', alVolver);
  window.removeEventListener('mb:datos', refrescarPronto);
  observador?.disconnect();
  document.querySelector('.alarmas')?.remove();
  enPantalla.clear();
}
function alVolver() { if (!document.hidden) refrescar(); }
let pronto = null;
function refrescarPronto() { clearTimeout(pronto); pronto = setTimeout(refrescar, 400); }

export async function refrescar() {
  if (!activo) return;
  try {
    const hoy = hoyISO();
    const [items, citas] = await Promise.all([
      pendientes({ dias: 60 }).catch(() => []),   // si falta el SQL 005, sin gastos
      db.citasEntre(hoy, sumarDias(hoy, 31)),
    ]);
    datos = { items, citas: citas.filter((c) => c.aviso_min !== null && c.aviso_min !== undefined && ['pendiente', 'confirmada'].includes(c.estado)), cargado: Date.now() };
  } catch (e) { console.warn('Avisos:', e); }
  revisar();
}

// Lo que toca avisar ahora mismo
function porAvisar() {
  const ahora = Date.now();
  const v = leerVistos();
  const lista = [];
  for (const c of datos.citas) {
    const inicio = momento(c.fecha, c.hora);
    const avisa = inicio.getTime() - c.aviso_min * 6e4;
    if (ahora < avisa || ahora > inicio.getTime() + 15 * 60000) continue;   // ya pasó la cita: no molestar
    const clave = `c:${c.id}:${c.fecha}T${c.hora}:${c.aviso_min}`;
    if (toca(v, clave, ahora)) lista.push({ clave, tipo: 'cita', c, inicio });
  }
  const hoy = hoyISO();
  for (const it of datos.items) {
    const o = it.o;
    if (o.aviso_cantidad === null || !it.avisa || it.avisa.getTime() > ahora) continue;
    if (o.recordar === 'no') {
      // Un solo aviso, con la antelación elegida
      const clave = `o:${o.id}:${it.fecha}`;
      if (toca(v, clave, ahora)) lista.push({ clave, tipo: 'ob', it });
      continue;
    }
    // Recordar cada día (a su hora) hasta que se marque como hecho
    const primerDia = isoDe(it.avisa);
    const cuando = primerDia === hoy ? it.avisa.getTime() : momento(hoy, o.hora).getTime();
    const clave = `o:${o.id}:${it.fecha}:d${hoy}`;
    if (ahora >= cuando && toca(v, clave, ahora)) lista.push({ clave, tipo: 'ob', it });
  }
  return lista;
}

function textoCuando(fecha, hora) {
  const hoy = hoyISO();
  const dias = diasEntre(hoy, fecha);
  if (dias === 0) return `hoy a las ${horaCorta(hora)}`;
  if (dias === 1) return `mañana a las ${horaCorta(hora)}`;
  if (dias === -1) return 'ayer';
  if (dias < 0) return `hace ${-dias} días (${textoDiaLargo(fecha).toLowerCase()})`;
  if (dias < 7) return `${textoDiaLargo(fecha).toLowerCase()}, en ${dias} días`;
  return `el ${textoDiaLargo(fecha).toLowerCase()}, en ${dias} días`;
}
function faltan(inicio) {
  const min = Math.round((inicio - Date.now()) / 60000);
  if (min <= 0) return 'ahora';
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (min < 1440) return `en ${h} h${m ? ` ${m} min` : ''}`;
  return `en ${Math.round(min / 1440)} días`;
}

export function describir(a) {
  if (a.tipo === 'prueba') return { icono: '🔔', titulo: 'Aviso de prueba', texto: 'Así sonarán y se verán los avisos.', extra: '' };
  if (a.tipo === 'cita') {
    const c = a.c;
    return { icono: '💅', titulo: `Cita ${faltan(a.inicio)} · ${c.hora}`,
      texto: `${nombreCompleto(c.clienta)} · ${c.servicios.map((s) => s.nombre).join(', ')}`, extra: c.clienta?.preferencias || '' };
  }
  const { o, fecha } = a.it;
  const atrasada = fecha < hoyISO();
  const extra = `${o.importe ? ` · ${euros(o.importe)}` : ''}${o.proveedor ? ` · ${o.proveedor}` : ''}`;
  return {
    icono: o.importe ? '💶' : '📋',
    titulo: o.nombre,
    texto: `${atrasada ? `Pendiente desde ${textoCuando(fecha, o.hora)}` : `Toca ${textoCuando(fecha, o.hora)}`}${extra}`,
    extra: o.notas || '',
  };
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function revisar() {
  pintarInsignia();
  if (!activo || !ajustesAvisos().activos) return;
  const nuevos = porAvisar().filter((a) => !enPantalla.has(a.clave));
  if (!nuevos.length) return;
  for (const a of nuevos) enPantalla.set(a.clave, a);
  pintarAlarmas();
  repiques = 0;
  repicar();
  if (document.hidden) for (const a of nuevos) { const d = describir(a); notificar(d.titulo, d.texto, a.clave); }
}

// Suena hasta 3 veces (cada 20 s) mientras nadie toque el aviso
function repicar() {
  clearTimeout(temporizadorRepique);
  if (!enPantalla.size || repiques >= 3) return;
  repiques++;
  sonar();
  temporizadorRepique = setTimeout(repicar, 20000);
}

function pintarAlarmas() {
  let caja = document.querySelector('.alarmas');
  if (!enPantalla.size) { caja?.remove(); clearTimeout(temporizadorRepique); return; }
  if (!caja) {
    caja = document.createElement('section');
    caja.className = 'alarmas';
    caja.setAttribute('role', 'alert');
    caja.setAttribute('aria-label', 'Avisos');
    document.body.appendChild(caja);
    caja.addEventListener('click', alPulsar);
  }
  const bloqueada = document.body.classList.contains('bloqueada');
  caja.innerHTML = `<header><span>🔔 ${enPantalla.size === 1 ? 'Aviso' : `${enPantalla.size} avisos`}</span>
      ${enPantalla.size > 1 ? '<button class="enlace" data-todos>Vale a todos</button>' : ''}</header>`
    + [...enPantalla.values()].map((a) => {
      const d = describir(a);
      return `<article class="alarma alarma-${a.tipo}" data-clave="${esc(a.clave)}">
        <span class="alarma-icono" aria-hidden="true">${d.icono}</span>
        <div class="alarma-texto"><strong>${esc(d.titulo)}</strong><p>${esc(d.texto)}</p>${d.extra ? `<small>${esc(d.extra)}</small>` : ''}</div>
        <div class="alarma-botones">
          <button class="btn btn-mini" data-posponer="10">10 min más</button>
          ${!bloqueada && a.tipo === 'ob' && a.it.o.id ? `<button class="btn btn-mini" data-hecho>${a.it.o.importe ? 'Pagado' : 'Hecho'}</button>` : ''}
          ${!bloqueada && a.tipo === 'cita' ? '<button class="btn btn-mini" data-ver>Ver cita</button>' : ''}
          <button class="btn btn-mini btn-principal" data-vale>Vale</button>
        </div>
      </article>`;
    }).join('');
}

async function alPulsar(e) {
  const b = e.target.closest('button');
  if (!b) return;
  clearTimeout(temporizadorRepique);
  if (b.hasAttribute('data-todos')) {
    for (const k of enPantalla.keys()) marcar(k);
    enPantalla.clear(); return pintarAlarmas();
  }
  const art = b.closest('[data-clave]');
  if (!art) return;
  const clave = art.dataset.clave;
  const a = enPantalla.get(clave);
  enPantalla.delete(clave);
  if (b.dataset.posponer) marcar(clave, Date.now() + Number(b.dataset.posponer) * 60000);
  else marcar(clave);
  pintarAlarmas();
  if (b.hasAttribute('data-ver')) {
    const { abrirDetalleCita } = await import('./citas.js');
    abrirDetalleCita(a.c.id, () => window.dispatchEvent(new Event('mb:datos')));
  }
  if (b.hasAttribute('data-hecho')) {
    const { apuntarHecho } = await import('./vistas/secretaria.js');
    apuntarHecho(a.it.o, a.it.fecha, () => { window.dispatchEvent(new Event('mb:datos')); if (location.hash.startsWith('#avisos')) window.dispatchEvent(new HashChangeEvent('hashchange')); });
  }
}

// Número en el menú: cuántas cosas están avisando (atrasadas o con el aviso ya activo)
function pintarInsignia() {
  const enlace = document.querySelector('[data-seccion="avisos"]');
  if (!enlace) return;
  const n = datos.items.filter((it) => (it.avisa && it.avisa <= new Date()) || it.vence <= new Date()).length;
  let b = enlace.querySelector('.insignia-nav');
  if (!n) { b?.remove(); return; }
  if (!b) { b = document.createElement('b'); b.className = 'insignia-nav'; enlace.appendChild(b); }
  b.textContent = n > 9 ? '9+' : String(n);
  b.setAttribute('aria-label', `${n} pendientes`);
}

// Para probar el sonido desde Ajustes
export function probar() {
  prepararAudio();
  const clave = `prueba:${Date.now()}`;
  enPantalla.set(clave, { clave, tipo: 'prueba' });
  pintarAlarmas();
  repiques = 2;   // una sola vez
  repicar();
}

// Lectura de calendarios .ics (lo que exporta Google Calendar) y detección
// de clienta y servicio a partir del título de cada evento.
// Sin dependencias, para poder probarlo también fuera del navegador.

const ZONA = 'Europe/Madrid';
const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------
// Lectura del archivo
// ---------------------------------------------------------------------
function desdoblar(texto) {
  return texto.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function desescapar(v) {
  return String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

function leerPropiedad(linea) {
  const i = linea.indexOf(':');
  if (i < 0) return null;
  const cab = linea.slice(0, i);
  const valor = linea.slice(i + 1);
  const [nombre, ...params] = cab.split(';');
  const p = {};
  for (const x of params) { const [k, v] = x.split('='); p[k.toUpperCase()] = (v || '').replace(/"/g, ''); }
  return { nombre: nombre.toUpperCase(), params: p, valor };
}

// Hora "de pared" en Madrid a partir de un instante UTC
function aMadrid(fechaUTC) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(fechaUTC).map((x) => [x.type, x.value]));
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, min: Number(partes.hour) * 60 + Number(partes.minute) };
}

// Devuelve { fecha: 'AAAA-MM-DD', min: minutos desde 00:00, diaCompleto }
function leerFecha(prop) {
  const v = prop.valor.trim();
  if (prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    return { fecha: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, min: 0, diaCompleto: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  if (m[7]) {
    const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return { ...aMadrid(utc), diaCompleto: false };
  }
  // Con TZID (normalmente Europe/Madrid) o sin zona: se toma tal cual
  return { fecha: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5], diaCompleto: false };
}

function leerDuracion(v) {
  const m = String(v).match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 10080 + (+(m[2] || 0)) * 1440 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}

function isoMas(fecha, dias) {
  const [y, m, d] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1, d + dias));
  return `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())}`;
}
function diaSemana(fecha) { const [y, m, d] = fecha.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function difDias(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// Repeticiones básicas (diaria, semanal, mensual, anual) dentro de [desde, hasta]
function expandir(ev, desde, hasta) {
  if (!ev.rrule) return [ev.inicio.fecha];
  const r = Object.fromEntries(ev.rrule.split(';').map((x) => x.split('=')));
  const intervalo = Number(r.INTERVAL || 1);
  const max = r.COUNT ? Number(r.COUNT) : Infinity;
  let hastaRegla = hasta;
  if (r.UNTIL) {
    const u = leerFecha({ valor: r.UNTIL, params: {} });
    if (u && u.fecha < hastaRegla) hastaRegla = u.fecha;
  }
  const dias = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => dias[d.slice(-2)]).filter((x) => x !== undefined) : null;
  const fechas = [];
  let n = 0;
  const inicio = ev.inicio.fecha;
  for (let d = inicio, guard = 0; d <= hastaRegla && n < max && guard < 4000; d = isoMas(d, 1), guard++) {
    const dif = difDias(inicio, d);
    let vale = false;
    if (r.FREQ === 'DAILY') vale = dif % intervalo === 0;
    else if (r.FREQ === 'WEEKLY') {
      const semana = Math.floor((dif + ((diaSemana(inicio) + 6) % 7)) / 7);
      vale = semana % intervalo === 0 && (byday ? byday.includes(diaSemana(d)) : diaSemana(d) === diaSemana(inicio));
    } else if (r.FREQ === 'MONTHLY') {
      const [y0, m0, d0] = inicio.split('-').map(Number); const [y, m, dd] = d.split('-').map(Number);
      vale = dd === d0 && ((y - y0) * 12 + (m - m0)) % intervalo === 0;
    } else if (r.FREQ === 'YEARLY') {
      vale = d.slice(5) === inicio.slice(5) && (Number(d.slice(0, 4)) - Number(inicio.slice(0, 4))) % intervalo === 0;
    } else return [inicio];
    if (!vale) continue;
    n++;
    if (d >= desde && !ev.excluidas.has(d)) fechas.push(d);
  }
  return fechas;
}

// Devuelve la lista de eventos (ya expandidos) entre dos fechas
export function leerICS(texto, { desde = '1900-01-01', hasta = '2999-12-31' } = {}) {
  const lineas = desdoblar(texto);
  const eventos = [];
  let ev = null;
  for (const linea of lineas) {
    if (linea === 'BEGIN:VEVENT') { ev = { excluidas: new Set() }; continue; }
    if (linea === 'END:VEVENT') { if (ev) eventos.push(ev); ev = null; continue; }
    if (!ev) continue;
    const p = leerPropiedad(linea);
    if (!p) continue;
    if (p.nombre === 'DTSTART') ev.inicio = leerFecha(p);
    else if (p.nombre === 'DTEND') ev.fin = leerFecha(p);
    else if (p.nombre === 'DURATION') ev.duracion = leerDuracion(p.valor);
    else if (p.nombre === 'SUMMARY') ev.titulo = desescapar(p.valor);
    else if (p.nombre === 'DESCRIPTION') ev.descripcion = desescapar(p.valor);
    else if (p.nombre === 'LOCATION') ev.lugar = desescapar(p.valor);
    else if (p.nombre === 'UID') ev.uid = p.valor.trim();
    else if (p.nombre === 'STATUS') ev.estado = p.valor.trim().toUpperCase();
    else if (p.nombre === 'RRULE') ev.rrule = p.valor.trim();
    else if (p.nombre === 'RECURRENCE-ID') ev.recurrencia = leerFecha(p);
    else if (p.nombre === 'EXDATE') p.valor.split(',').forEach((v) => { const f = leerFecha({ valor: v, params: p.params }); if (f) ev.excluidas.add(f.fecha); });
  }

  // Las excepciones (una repetición movida o cambiada) sustituyen a la original
  const excepciones = eventos.filter((e) => e.recurrencia && e.uid);
  for (const ex of excepciones) {
    const madre = eventos.find((e) => e.uid === ex.uid && e.rrule);
    if (madre) madre.excluidas.add(ex.recurrencia.fecha);
  }

  const salida = [];
  for (const e of eventos) {
    if (!e.inicio || e.estado === 'CANCELLED') continue;
    let duracion = e.duracion;
    if (!duracion && e.fin) {
      duracion = e.inicio.diaCompleto ? difDias(e.inicio.fecha, e.fin.fecha) * 1440
        : difDias(e.inicio.fecha, e.fin.fecha) * 1440 + e.fin.min - e.inicio.min;
    }
    if (!duracion || duracion < 0) duracion = e.inicio.diaCompleto ? 1440 : 60;
    for (const fecha of expandir(e, desde, hasta)) {
      if (fecha < desde || fecha > hasta) continue;
      salida.push({
        uid: e.uid || '', fecha, min: e.inicio.min, duracion, diaCompleto: !!e.inicio.diaCompleto,
        titulo: e.titulo || '(sin título)', descripcion: e.descripcion || '', lugar: e.lugar || '',
      });
    }
  }
  return salida.sort((a, b) => (a.fecha + pad(Math.floor(a.min / 60)) + pad(a.min % 60)).localeCompare(b.fecha + pad(Math.floor(b.min / 60)) + pad(b.min % 60)));
}

// ---------------------------------------------------------------------
// Detección de clienta y servicio en el título
// ---------------------------------------------------------------------
export const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'a', 'en', 'cita', 'para', 'sesion', 'reserva', 'mas', 'manos', 'pies',
  'nueva', 'nuevo', 'clienta', 'cliente', 'confirmada', 'confirmado', 'pendiente', 'repaso', 'retoque']);

// Devuelve { servicios: [ids], nombre: 'texto que queda', telefono }
export function interpretar(evento, servicios, clientas) {
  const titulo = normal(String(evento.titulo).replace(/\([^)]*\)/g, ' '));
  let resto = ` ${titulo} `;
  const encontrados = [];
  // Primero los nombres de servicio más largos (para que "manicura semipermanente" gane a "manicura")
  const porLargo = [...servicios].sort((a, b) => normal(b.nombre).length - normal(a.nombre).length);
  for (const s of porLargo) {
    const n = normal(s.nombre);
    if (n && resto.includes(` ${n} `)) { encontrados.push(s.id); resto = resto.replace(` ${n} `, ' '); }
  }
  // Si no hay coincidencia exacta, por palabras clave del servicio (al menos una palabra larga y poco común)
  if (!encontrados.length) {
    let mejor = null, puntos = 0;
    for (const s of servicios) {
      const claves = normal(s.nombre).split(' ').filter((w) => w.length >= 5 && !PALABRAS_VACIAS.has(w));
      const p = claves.filter((w) => resto.includes(` ${w} `) || resto.split(' ').some((x) => x.length >= 4 && w.startsWith(x))).length;
      if (p > puntos) { puntos = p; mejor = s; }
    }
    if (mejor) {
      encontrados.push(mejor.id);
      for (const w of normal(mejor.nombre).split(' ')) resto = resto.replace(new RegExp(` ${w}\\w* `, 'g'), ' ');
      resto = resto.split(' ').filter((x) => !(x.length >= 4 && normal(mejor.nombre).split(' ').some((w) => w.startsWith(x)))).join(' ');
    }
  }
  // Palabras de los servicios (diseño, masaje, lifting…) no forman parte del nombre
  const vocabulario = new Set(servicios.flatMap((s) => normal(s.nombre).split(' ')).filter((w) => w.length >= 5));
  const nombre = resto.split(' ').filter((w) => w && !PALABRAS_VACIAS.has(w) && !vocabulario.has(w) && !/^\d+$/.test(w)).join(' ').trim();

  // Clienta existente: nombre completo, o nombre + inicio del apellido, o solo nombre si es único
  let clientaId = null;
  if (nombre) {
    const completa = (c) => normal([c.nombre, c.apellidos].filter(Boolean).join(' '));
    const exacta = clientas.filter((c) => completa(c) === nombre || normal(c.nombre) === nombre);
    if (exacta.length === 1) clientaId = exacta[0].id;
    else {
      const [pri, seg] = nombre.split(' ');
      const candidatas = clientas.filter((c) => normal(c.nombre).split(' ')[0] === pri
        && (!seg || normal(c.apellidos || '').startsWith(seg) || normal(c.nombre).split(' ')[1] === seg));
      if (candidatas.length === 1) clientaId = candidatas[0].id;
    }
  }
  const tel = (evento.descripcion + ' ' + evento.titulo).match(/(?:\+34\s?)?([6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3})/);
  // Nombre "bonito" para una clienta nueva, a partir del título original
  const original = evento.titulo.split(/\s+/).filter((w) => normal(w) && nombre.split(' ').includes(normal(w))).join(' ');
  return {
    servicios: encontrados,
    nombre: (original || nombre).replace(/(^|\s)\S/g, (x) => x.toUpperCase()),
    clientaId,
    telefono: tel ? tel[1].replace(/[\s.-]/g, '') : '',
  };
}

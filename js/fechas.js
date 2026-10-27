// Fechas siempre en hora local del salón, en formato "AAAA-MM-DD".
// Nunca usar toISOString() para fechas: en España devuelve el día anterior.

const pad = (n) => String(n).padStart(2, '0');

export function isoDe(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hoyISO() {
  return isoDe(new Date());
}

export function desdeISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function sumarDias(iso, n) {
  const d = desdeISO(iso);
  d.setDate(d.getDate() + n);
  return isoDe(d);
}

export function sumarMeses(iso, n) {
  const d = desdeISO(iso);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return isoDe(d);
}

// Lunes de la semana de esa fecha
export function lunesDe(iso) {
  const d = desdeISO(iso);
  const dia = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dia);
  return isoDe(d);
}

export function primeroDeMes(iso) {
  return iso.slice(0, 8) + '01';
}

export function ultimoDeMes(iso) {
  const d = desdeISO(primeroDeMes(iso));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return isoDe(d);
}

// "10:30" -> 630
export function aMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

// 630 -> "10:30"
export function aHora(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function horaCorta(t) {
  return String(t || '').slice(0, 5);
}

export function minutosAhora() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

const fmt = (opts) => new Intl.DateTimeFormat('es-ES', opts);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function textoDiaLargo(iso) {
  return capital(fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(desdeISO(iso)));
}
export function textoDiaCorto(iso) {
  return fmt({ day: 'numeric', month: 'short' }).format(desdeISO(iso));
}
export function textoFecha(iso) {
  return fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(desdeISO(iso));
}
export function textoMes(iso) {
  return capital(fmt({ month: 'long', year: 'numeric' }).format(desdeISO(iso)));
}
export function inicialDia(iso) {
  return capital(fmt({ weekday: 'short' }).format(desdeISO(iso)).replace('.', ''));
}

export function duracionTexto(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

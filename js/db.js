// Capa de datos. Dos modos con la misma interfaz:
//  - "supabase": datos en la nube (lo normal)
//  - "demo": datos solo en este navegador, para probar sin configurar nada
import { CONFIG } from './config.js';
import { hoyISO, sumarDias, aMinutos, horaCorta } from './fechas.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

let sb = null;
let N = null;          // id del negocio
let negocio = null;
export let modo = 'supabase';

function comprobar({ data, error }) {
  if (error) throw new Error(error.message || 'Error de base de datos');
  return data;
}

function normalizarCita(c) {
  const servicios = [...(c.cita_servicios || c.servicios || [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const total = servicios.reduce((s, x) => s + Number(x.precio || 0), 0);
  return {
    ...c,
    hora: horaCorta(c.hora_inicio),
    inicio: aMinutos(c.hora_inicio),
    fin: aMinutos(c.hora_inicio) + Number(c.duracion_min || 0),
    servicios,
    total,
    clienta: c.clientas || c.clienta || null,
  };
}

// =====================================================================
// Arranque y sesión
// =====================================================================
export async function iniciar() {
  const forzarDemo = new URLSearchParams(location.search).has('demo');
  if (forzarDemo || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
    modo = 'demo';
    return modo;
  }
  const { createClient } = await import(SUPABASE_JS);
  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return modo;
}

export async function sesionActual() {
  if (modo === 'demo') return demo.sesion();
  return comprobar(await sb.auth.getSession()).session;
}

export function alCambiarSesion(cb) {
  if (modo === 'demo') return;
  sb.auth.onAuthStateChange((evento, sesion) => cb(evento, sesion));
}

export async function entrar(email, password) {
  if (modo === 'demo') return demo.entrar(email);
  comprobar(await sb.auth.signInWithPassword({ email, password }));
}

export async function recuperarContrasena(email) {
  if (modo === 'demo') return;
  comprobar(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
}

export async function nuevaContrasena(password) {
  if (modo === 'demo') return;
  comprobar(await sb.auth.updateUser({ password }));
}

export async function salir() {
  N = null; negocio = null;
  if (modo === 'demo') return demo.salir();
  await sb.auth.signOut();
}

// =====================================================================
// Negocio
// =====================================================================
export async function cargarNegocio() {
  if (modo === 'demo') { negocio = demo.negocio(); N = negocio.id; return negocio; }
  let filas = comprobar(await sb.from('miembros').select('rol, negocios(*)').limit(1));
  if (!filas.length) {
    comprobar(await sb.rpc('crear_negocio', { p_nombre: CONFIG.NOMBRE_NEGOCIO }));
    filas = comprobar(await sb.from('miembros').select('rol, negocios(*)').limit(1));
  }
  negocio = { ...filas[0].negocios, rol: filas[0].rol };
  N = negocio.id;
  return negocio;
}

export function negocioActual() { return negocio; }

export async function guardarNegocio(datos) {
  if (modo === 'demo') { negocio = demo.guardarNegocio(datos); return negocio; }
  const { id, rol, created_at, updated_at, ...resto } = datos;
  const fila = comprobar(await sb.from('negocios').update(resto).eq('id', N).select().single());
  negocio = { ...fila, rol: negocio.rol };
  return negocio;
}

// =====================================================================
// Clientas
// =====================================================================
const CAMPOS_CLIENTA = ['nombre', 'apellidos', 'telefono', 'email', 'nif', 'direccion', 'cp', 'poblacion',
  'fecha_nacimiento', 'color', 'preferencias', 'notas', 'notas_salud', 'consentimiento_datos',
  'consentimiento_salud', 'consentimiento_comunicaciones', 'consentimiento_fecha', 'archivada'];

function limpiar(obj, campos) {
  const o = {};
  for (const k of campos) if (k in obj) o[k] = obj[k] === '' ? null : obj[k];
  return o;
}

export async function listarClientas({ archivadas = false } = {}) {
  if (modo === 'demo') return demo.listar('clientas').filter((c) => !!c.archivada === archivadas)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return comprobar(await sb.from('clientas').select('*').eq('negocio_id', N)
    .eq('archivada', archivadas).order('nombre'));
}

export async function obtenerClienta(id) {
  if (modo === 'demo') return demo.obtener('clientas', id);
  return comprobar(await sb.from('clientas').select('*').eq('id', id).single());
}

export async function guardarClienta(datos) {
  const fila = limpiar(datos, CAMPOS_CLIENTA);
  if (!fila.nombre) throw new Error('Falta el nombre');
  if (!fila.consentimiento_salud) fila.notas_salud = null;
  if (modo === 'demo') return demo.guardar('clientas', { ...fila, id: datos.id });
  if (datos.id) return comprobar(await sb.from('clientas').update(fila).eq('id', datos.id).select().single());
  return comprobar(await sb.from('clientas').insert({ ...fila, negocio_id: N }).select().single());
}

// =====================================================================
// Servicios
// =====================================================================
const CAMPOS_SERVICIO = ['nombre', 'categoria', 'duracion_min', 'precio', 'iva_pct', 'descripcion', 'activo', 'orden'];

export async function listarServicios({ todos = false } = {}) {
  let filas;
  if (modo === 'demo') filas = demo.listar('servicios');
  else {
    let q = sb.from('servicios').select('*').eq('negocio_id', N);
    if (!todos) q = q.eq('activo', true);
    filas = comprobar(await q.order('orden').order('nombre'));
  }
  if (!todos) filas = filas.filter((s) => s.activo !== false);
  return filas.sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '', 'es')
    || (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

export async function guardarServicio(datos) {
  const fila = limpiar(datos, CAMPOS_SERVICIO);
  if (!fila.nombre) throw new Error('Falta el nombre');
  fila.duracion_min = parseInt(fila.duracion_min, 10) || 30;
  fila.precio = Number(String(fila.precio ?? 0).replace(',', '.')) || 0;
  if (fila.iva_pct != null) fila.iva_pct = Number(fila.iva_pct) || 21;
  if (modo === 'demo') return demo.guardar('servicios', { activo: true, iva_pct: 21, ...fila, id: datos.id });
  if (datos.id) return comprobar(await sb.from('servicios').update(fila).eq('id', datos.id).select().single());
  return comprobar(await sb.from('servicios').insert({ ...fila, negocio_id: N }).select().single());
}

// Cuántas citas usan este servicio (si es 0 se puede eliminar sin más)
export async function usosServicio(id) {
  if (modo === 'demo') return demo.leer().citas.filter((c) => (c.cita_servicios || []).some((l) => l.servicio_id === id)).length;
  const { count, error } = await sb.from('cita_servicios').select('id', { count: 'exact', head: true }).eq('servicio_id', id);
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function eliminarServicio(id) {
  if (modo === 'demo') {
    const d = demo.leer();
    d.servicios = d.servicios.filter((s) => s.id !== id);
    demo.escribir(d);
    return;
  }
  comprobar(await sb.from('servicios').delete().eq('id', id));
}

// =====================================================================
// Citas
// =====================================================================
const SELECT_CITA = '*, cita_servicios(*), clientas(id, nombre, apellidos, color, telefono, preferencias, notas)';

export async function citasEntre(desde, hasta) {
  let filas;
  if (modo === 'demo') filas = demo.citasEntre(desde, hasta);
  else filas = comprobar(await sb.from('citas').select(SELECT_CITA).eq('negocio_id', N)
    .gte('fecha', desde).lte('fecha', hasta).order('fecha').order('hora_inicio'));
  return filas.map(normalizarCita);
}

export async function citasDeClienta(clientaId) {
  let filas;
  if (modo === 'demo') filas = demo.citasDeClienta(clientaId);
  else filas = comprobar(await sb.from('citas').select(SELECT_CITA).eq('clienta_id', clientaId)
    .order('fecha', { ascending: false }).order('hora_inicio', { ascending: false }));
  return filas.map(normalizarCita);
}

export async function obtenerCita(id) {
  let fila;
  if (modo === 'demo') fila = demo.cita(id);
  else fila = comprobar(await sb.from('citas').select(SELECT_CITA).eq('id', id).single());
  return normalizarCita(fila);
}

// cita: { id?, clienta_id, fecha, hora_inicio, duracion_min, estado?, notas }
// servicios: [{ servicio_id, nombre, precio, iva_pct, duracion_min }]
export async function guardarCita(cita, servicios) {
  if (!cita.clienta_id) throw new Error('Elige una clienta');
  if (!servicios.length) throw new Error('Añade al menos un servicio');
  if (modo === 'demo') return demo.guardarCita(cita, servicios);
  return comprobar(await sb.rpc('guardar_cita', { p_negocio: N, p_cita: cita, p_servicios: servicios }));
}

export async function cambiarEstadoCita(id, estado, motivo = null) {
  const cambios = { estado, motivo_anulacion: estado === 'anulada' ? motivo : null };
  if (modo === 'demo') return demo.actualizar('citas', id, cambios);
  comprobar(await sb.from('citas').update(cambios).eq('id', id));
}

// Citas que se pisan con [inicio, fin) ese día (sin contar anuladas ni la propia)
export async function solapes(fecha, inicio, fin, excluirId) {
  const delDia = await citasEntre(fecha, fecha);
  return delDia.filter((c) => c.id !== excluirId && !['anulada', 'no_presentada'].includes(c.estado)
    && c.inicio < fin && inicio < c.fin);
}

// =====================================================================
// Modo demostración (localStorage)
// =====================================================================
const CLAVE_DEMO = 'mb_demo_v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

const demo = {
  leer() {
    try {
      const d = JSON.parse(localStorage.getItem(CLAVE_DEMO));
      if (d) return d;
    } catch { /* vacío */ }
    const d = semilla();
    this.escribir(d);
    return d;
  },
  escribir(d) {
    try { localStorage.setItem(CLAVE_DEMO, JSON.stringify(d)); } catch { /* sin almacenamiento */ }
  },
  sesion() { return this.leer().sesion; },
  entrar(email) { const d = this.leer(); d.sesion = { user: { email: email || 'demo@local' } }; this.escribir(d); },
  salir() { const d = this.leer(); d.sesion = null; this.escribir(d); },
  negocio() { return { ...this.leer().negocio, rol: 'propietaria' }; },
  guardarNegocio(datos) { const d = this.leer(); d.negocio = { ...d.negocio, ...datos }; this.escribir(d); return this.negocio(); },
  listar(t) { return structuredClone(this.leer()[t]); },
  obtener(t, id) { const f = this.leer()[t].find((x) => x.id === id); if (!f) throw new Error('No encontrado'); return structuredClone(f); },
  guardar(t, fila) {
    const d = this.leer();
    const ahora = new Date().toISOString();
    if (fila.id) {
      const i = d[t].findIndex((x) => x.id === fila.id);
      d[t][i] = { ...d[t][i], ...fila, updated_at: ahora };
      this.escribir(d);
      return structuredClone(d[t][i]);
    }
    const nueva = { ...fila, id: uid(), created_at: ahora, updated_at: ahora };
    d[t].push(nueva);
    this.escribir(d);
    return structuredClone(nueva);
  },
  actualizar(t, id, cambios) {
    const d = this.leer();
    const f = d[t].find((x) => x.id === id);
    Object.assign(f, cambios, { updated_at: new Date().toISOString() });
    this.escribir(d);
  },
  unir(d, c) {
    return { ...c, clientas: d.clientas.find((x) => x.id === c.clienta_id) || null };
  },
  citasEntre(desde, hasta) {
    const d = this.leer();
    return structuredClone(d.citas.filter((c) => c.fecha >= desde && c.fecha <= hasta)
      .sort((a, b) => (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio))
      .map((c) => this.unir(d, c)));
  },
  citasDeClienta(id) {
    const d = this.leer();
    return structuredClone(d.citas.filter((c) => c.clienta_id === id)
      .sort((a, b) => (b.fecha + b.hora_inicio).localeCompare(a.fecha + a.hora_inicio))
      .map((c) => this.unir(d, c)));
  },
  cita(id) { const d = this.leer(); return structuredClone(this.unir(d, d.citas.find((c) => c.id === id))); },
  guardarCita(cita, servicios) {
    const d = this.leer();
    const dur = Number(cita.duracion_min) || servicios.reduce((s, x) => s + Number(x.duracion_min || 0), 0) || 30;
    const lineas = servicios.map((s, i) => ({ id: uid(), ...s, precio: Number(s.precio) || 0, orden: i }));
    const ahora = new Date().toISOString();
    if (cita.id) {
      const c = d.citas.find((x) => x.id === cita.id);
      Object.assign(c, { ...cita, estado: cita.estado || c.estado, duracion_min: dur, cita_servicios: lineas, updated_at: ahora });
      this.escribir(d);
      return c.id;
    }
    const id = uid();
    d.citas.push({ ...cita, id, estado: cita.estado || 'pendiente', duracion_min: dur, cita_servicios: lineas, created_at: ahora, updated_at: ahora });
    this.escribir(d);
    return id;
  },
};

function semilla() {
  const s = (nombre, categoria, duracion_min, precio, orden) => ({ id: uid(), nombre, categoria, duracion_min, precio, iva_pct: 21, activo: true, orden });
  const servicios = [
    s('Manicura semipermanente', 'Manos', 45, 20, 1),
    s('Manicura rusa', 'Manos', 75, 30, 2),
    s('Uñas acrílicas nuevas', 'Manos', 120, 45, 3),
    s('Relleno acrílico', 'Manos', 90, 32, 4),
    s('Retirada de esmalte', 'Manos', 15, 5, 5),
    s('Diseño por uña', 'Manos', 10, 2, 6),
    s('Pedicura completa', 'Pies', 60, 30, 1),
    s('Pedicura semipermanente', 'Pies', 45, 22, 2),
    s('Lifting de pestañas', 'Mirada', 60, 35, 1),
    s('Diseño de cejas', 'Mirada', 20, 10, 2),
  ];
  const c = (nombre, apellidos, telefono, color, preferencias, notas = '') => ({
    id: uid(), nombre, apellidos, telefono, color, preferencias, notas, archivada: false,
    consentimiento_datos: true, consentimiento_fecha: new Date().toISOString(),
  });
  const clientas = [
    c('Rocío', 'Benítez Ruiz', '612 345 678', '#C2185B', 'Siempre rojo cereza. Forma almendra, largo medio.'),
    c('Carmen', 'Ortega', '655 111 222', '#7FB7A4', 'Tonos nude. No le gusta la purpurina.', 'Prefiere citas a primera hora.'),
    c('Lucía', 'Moreno Gil', '699 876 543', '#9C89B8', 'Francesa clásica en pies.'),
    c('Inma', 'Castro', '622 908 070', '#D4A373', 'Lima suave, cutícula sensible.'),
  ];
  const hoy = hoyISO();
  const linea = (sv) => ({ id: uid(), servicio_id: sv.id, nombre: sv.nombre, precio: sv.precio, iva_pct: 21, duracion_min: sv.duracion_min, orden: 0 });
  const cita = (cl, fecha, hora, svs, estado = 'confirmada') => ({
    id: uid(), clienta_id: cl.id, fecha, hora_inicio: hora + ':00',
    duracion_min: svs.reduce((a, x) => a + x.duracion_min, 0), estado, notas: '',
    cita_servicios: svs.map((x, i) => ({ ...linea(x), orden: i })),
  });
  return {
    sesion: null,
    negocio: { id: 'demo', nombre: CONFIG.NOMBRE_NEGOCIO, poblacion: 'Chiclana de la Frontera', provincia: 'Cádiz' },
    servicios,
    clientas,
    citas: [
      cita(clientas[0], hoy, '10:00', [servicios[0], servicios[5]]),
      cita(clientas[1], hoy, '11:15', [servicios[6]]),
      cita(clientas[2], hoy, '12:30', [servicios[8]], 'pendiente'),
      cita(clientas[3], hoy, '17:00', [servicios[3]]),
      cita(clientas[1], sumarDias(hoy, 1), '09:30', [servicios[0]], 'pendiente'),
      cita(clientas[0], sumarDias(hoy, 3), '16:00', [servicios[2]], 'pendiente'),
      cita(clientas[2], sumarDias(hoy, -6), '10:00', [servicios[7]], 'realizada'),
    ],
  };
}

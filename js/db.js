// Capa de datos. Dos modos con la misma interfaz:
//  - "supabase": datos en la nube (lo normal)
//  - "demo": datos solo en este navegador, para probar sin configurar nada
import { CONFIG } from './config.js';
import { hoyISO, sumarDias, aMinutos, horaCorta, desdeISO, isoDe } from './fechas.js';

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
    cobrada: (c.cobros || []).some((x) => !x.anulado),
  };
}

function normalizarCobro(c) {
  const lineas = [...(c.cobro_lineas || [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const pagos = [...(c.cobro_pagos || [])];
  return {
    ...c,
    hora: horaCorta(c.hora),
    total: Number(c.total), subtotal: Number(c.subtotal), descuento: Number(c.descuento || 0),
    lineas, pagos,
    clienta: c.clientas || null,
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
// Productos
// =====================================================================
const CAMPOS_PRODUCTO = ['nombre', 'marca', 'categoria', 'codigo', 'precio', 'iva_pct', 'coste', 'stock', 'activo'];
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.')));

export async function listarProductos({ todos = false } = {}) {
  let filas;
  if (modo === 'demo') filas = demo.listar('productos');
  else {
    let q = sb.from('productos').select('*').eq('negocio_id', N);
    if (!todos) q = q.eq('activo', true);
    filas = comprobar(await q.order('nombre'));
  }
  if (!todos) filas = filas.filter((x) => x.activo !== false);
  return filas.sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '', 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

export async function guardarProducto(datos) {
  const fila = limpiar(datos, CAMPOS_PRODUCTO);
  if (!fila.nombre) throw new Error('Falta el nombre');
  fila.precio = num(fila.precio) || 0;
  fila.iva_pct = num(fila.iva_pct) ?? 21;
  fila.coste = num(fila.coste);
  fila.stock = fila.stock === null || fila.stock === undefined ? null : parseInt(fila.stock, 10);
  if (Number.isNaN(fila.stock)) fila.stock = null;
  if (modo === 'demo') return demo.guardar('productos', { activo: true, ...fila, id: datos.id });
  if (datos.id) return comprobar(await sb.from('productos').update(fila).eq('id', datos.id).select().single());
  return comprobar(await sb.from('productos').insert({ ...fila, negocio_id: N }).select().single());
}

export async function usosProducto(id) {
  if (modo === 'demo') return demo.leer().cobros.filter((c) => c.cobro_lineas.some((l) => l.producto_id === id)).length;
  const { count, error } = await sb.from('cobro_lineas').select('id', { count: 'exact', head: true }).eq('producto_id', id);
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function eliminarProducto(id) {
  if (modo === 'demo') { const d = demo.leer(); d.productos = d.productos.filter((x) => x.id !== id); demo.escribir(d); return; }
  comprobar(await sb.from('productos').delete().eq('id', id));
}

// =====================================================================
// Cobros y caja
// =====================================================================
const SELECT_COBRO = '*, cobro_lineas(*), cobro_pagos(*), clientas(id, nombre, apellidos, color, telefono)';

export async function cobrosEntre(desde, hasta) {
  let filas;
  if (modo === 'demo') filas = demo.cobrosDonde((c) => c.fecha >= desde && c.fecha <= hasta);
  else filas = comprobar(await sb.from('cobros').select(SELECT_COBRO).eq('negocio_id', N)
    .gte('fecha', desde).lte('fecha', hasta).order('fecha').order('hora'));
  return filas.map(normalizarCobro);
}

export async function cobrosDeClienta(clientaId) {
  let filas;
  if (modo === 'demo') filas = demo.cobrosDonde((c) => c.clienta_id === clientaId).reverse();
  else filas = comprobar(await sb.from('cobros').select(SELECT_COBRO).eq('clienta_id', clientaId)
    .order('fecha', { ascending: false }).order('hora', { ascending: false }));
  return filas.map(normalizarCobro);
}

export async function obtenerCobro(id) {
  let fila;
  if (modo === 'demo') fila = demo.cobrosDonde((c) => c.id === id)[0];
  else fila = comprobar(await sb.from('cobros').select(SELECT_COBRO).eq('id', id).single());
  if (!fila) throw new Error('Cobro no encontrado');
  return normalizarCobro(fila);
}

// El cobro válido (no anulado) de una cita, o null
export async function cobroDeCita(citaId) {
  let filas;
  if (modo === 'demo') filas = demo.cobrosDonde((c) => c.cita_id === citaId && !c.anulado);
  else filas = comprobar(await sb.from('cobros').select(SELECT_COBRO).eq('cita_id', citaId).eq('anulado', false).limit(1));
  return filas.length ? normalizarCobro(filas[0]) : null;
}

// cobro: { fecha, hora, clienta_id?, cita_id?, descuento, notas }
// lineas: [{ tipo, servicio_id?, producto_id?, nombre, cantidad, precio_unit, iva_pct }]
// pagos: [{ metodo, importe }]
export async function registrarCobro(cobro, lineas, pagos) {
  if (!lineas.length) throw new Error('Añade al menos un concepto');
  if (!pagos.length) throw new Error('Elige cómo se ha pagado');
  if (modo === 'demo') return demo.registrarCobro(cobro, lineas, pagos);
  return comprobar(await sb.rpc('registrar_cobro', { p_negocio: N, p_cobro: cobro, p_lineas: lineas, p_pagos: pagos }));
}

export async function anularCobro(id, motivo) {
  if (modo === 'demo') return demo.anularCobro(id, motivo);
  comprobar(await sb.rpc('anular_cobro', { p_cobro: id, p_motivo: motivo || '' }));
}

export async function cierreDe(fecha) {
  if (modo === 'demo') return structuredClone(demo.leer().cierres.find((c) => c.fecha === fecha) || null);
  const filas = comprobar(await sb.from('cierres_caja').select('*').eq('negocio_id', N).eq('fecha', fecha).limit(1));
  return filas[0] || null;
}

export async function guardarCierre(datos) {
  const fila = { ...datos };
  delete fila.id; delete fila.created_at; delete fila.updated_at; delete fila.negocio_id; delete fila.cerrado_por;
  if (modo === 'demo') {
    const d = demo.leer();
    const i = d.cierres.findIndex((c) => c.fecha === fila.fecha);
    const nuevo = { ...(i >= 0 ? d.cierres[i] : { id: uid() }), ...fila, updated_at: new Date().toISOString() };
    if (i >= 0) d.cierres[i] = nuevo; else d.cierres.push(nuevo);
    demo.escribir(d);
    return structuredClone(nuevo);
  }
  return comprobar(await sb.from('cierres_caja').upsert({ ...fila, negocio_id: N }, { onConflict: 'negocio_id,fecha' }).select().single());
}

export async function reabrirCaja(fecha) {
  if (modo === 'demo') { const d = demo.leer(); d.cierres = d.cierres.filter((c) => c.fecha !== fecha); demo.escribir(d); return; }
  comprobar(await sb.from('cierres_caja').delete().eq('negocio_id', N).eq('fecha', fecha));
}

// =====================================================================
// Inventario (material que se gasta y no se cobra)
// =====================================================================
const CAMPOS_CONSUMIBLE = ['nombre', 'marca', 'categoria', 'proveedor', 'unidad', 'contenido_envase', 'precio_envase', 'stock_minimo', 'notas', 'activo'];

export async function listarConsumibles() {
  let filas;
  if (modo === 'demo') filas = demo.listar('consumibles');
  else filas = comprobar(await sb.from('consumibles').select('*').eq('negocio_id', N).order('nombre'));
  return filas.map((c) => ({ ...c, contenido_envase: Number(c.contenido_envase), precio_envase: Number(c.precio_envase),
    stock_actual: Number(c.stock_actual), stock_minimo: Number(c.stock_minimo) }))
    .sort((a, b) => (a.categoria || 'zzz').localeCompare(b.categoria || 'zzz', 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

export async function guardarConsumible(datos, stockInicial = 0) {
  const fila = limpiar(datos, CAMPOS_CONSUMIBLE);
  if (!fila.nombre) throw new Error('Falta el nombre');
  fila.contenido_envase = num(fila.contenido_envase) || 1;
  fila.precio_envase = num(fila.precio_envase) || 0;
  fila.stock_minimo = num(fila.stock_minimo) || 0;
  fila.unidad = fila.unidad || 'ud';
  let guardado;
  if (modo === 'demo') guardado = demo.guardar('consumibles', datos.id ? { ...fila, id: datos.id } : { activo: true, stock_actual: 0, ...fila });
  else if (datos.id) guardado = comprobar(await sb.from('consumibles').update(fila).eq('id', datos.id).select().single());
  else guardado = comprobar(await sb.from('consumibles').insert({ ...fila, negocio_id: N }).select().single());
  const inicial = num(stockInicial) || 0;
  if (!datos.id && inicial > 0) {
    await registrarMovimiento({ consumible_id: guardado.id, fecha: hoyISO(), tipo: 'ajuste', cantidad: inicial, coste: 0, notas: 'Stock inicial' });
  }
  return guardado;
}

export async function eliminarConsumible(id) {
  if (modo === 'demo') {
    const d = demo.leer();
    d.consumibles = d.consumibles.filter((x) => x.id !== id);
    d.movimientos = d.movimientos.filter((x) => x.consumible_id !== id);
    demo.escribir(d); return;
  }
  comprobar(await sb.from('consumibles').delete().eq('id', id));
}

export async function movimientosInventario({ desde, hasta, consumibleId } = {}) {
  let filas;
  if (modo === 'demo') {
    filas = demo.listar('movimientos').filter((m) => (!desde || m.fecha >= desde) && (!hasta || m.fecha <= hasta)
      && (!consumibleId || m.consumible_id === consumibleId));
    filas.sort((a, b) => (b.fecha + b.created_at).localeCompare(a.fecha + a.created_at));
  } else {
    let q = sb.from('consumible_movimientos').select('*').eq('negocio_id', N);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    if (consumibleId) q = q.eq('consumible_id', consumibleId);
    filas = comprobar(await q.order('fecha', { ascending: false }).order('created_at', { ascending: false }));
  }
  return filas.map((m) => ({ ...m, cantidad: Number(m.cantidad), coste: m.coste === null ? null : Number(m.coste) }));
}

// mov: { consumible_id, fecha, tipo: 'compra'|'uso'|'ajuste', cantidad (+ entra / − sale), envases?, coste?, proveedor?, notas? }
export async function registrarMovimiento(mov) {
  if (modo === 'demo') return demo.movimiento(mov);
  comprobar(await sb.from('consumible_movimientos').insert({ ...mov, negocio_id: N }));
}

export async function borrarMovimiento(id) {
  if (modo === 'demo') return demo.borrarMovimiento(id);
  comprobar(await sb.from('consumible_movimientos').delete().eq('id', id));
}

// =====================================================================
// Secretaria: gastos fijos y obligaciones que se repiten
// =====================================================================
const CAMPOS_OBLIGACION = ['nombre', 'tipo', 'categoria', 'proveedor', 'importe', 'repeticion', 'cada', 'fecha_inicio', 'fecha_fin',
  'hora', 'aviso_cantidad', 'aviso_unidad', 'notas', 'activo', 'dia', 'recordar'];

function normalizarObligacion(o) {
  return { ...o, importe: o.importe === null || o.importe === undefined ? null : Number(o.importe), cada: Number(o.cada) || 1,
    hora: horaCorta(o.hora || '10:00'), dia: o.dia ? Number(o.dia) : null, recordar: o.recordar === 'no' ? 'no' : 'cada_dia', aviso_cantidad: o.aviso_cantidad === null || o.aviso_cantidad === undefined ? null : Number(o.aviso_cantidad) };
}

export async function listarObligaciones() {
  let filas;
  if (modo === 'demo') filas = demo.listar('obligaciones');
  else filas = comprobar(await sb.from('obligaciones').select('*').eq('negocio_id', N).order('nombre'));
  return filas.map(normalizarObligacion)
    .sort((a, b) => (a.categoria || 'zzz').localeCompare(b.categoria || 'zzz', 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

export async function guardarObligacion(datos) {
  const fila = limpiar(datos, CAMPOS_OBLIGACION);
  if (!fila.nombre) throw new Error('Falta el nombre');
  if (!fila.fecha_inicio) throw new Error('Falta la fecha');
  fila.tipo = fila.tipo === 'tarea' ? 'tarea' : 'gasto';
  fila.importe = num(fila.importe);
  fila.dia = num(fila.dia);
  fila.recordar = fila.recordar === 'no' ? 'no' : 'cada_dia';
  fila.cada = Math.max(1, Math.round(num(fila.cada) || 1));
  fila.repeticion = fila.repeticion || 'meses';
  fila.fecha_fin = fila.fecha_fin || null;
  fila.hora = fila.hora || '10:00';
  fila.aviso_cantidad = num(fila.aviso_cantidad);
  fila.aviso_unidad = fila.aviso_unidad || 'dias';
  if (modo === 'demo') return normalizarObligacion(demo.guardar('obligaciones', datos.id ? { ...fila, id: datos.id } : { activo: true, ...fila }));
  if (datos.id) return normalizarObligacion(comprobar(await sb.from('obligaciones').update(fila).eq('id', datos.id).select().single()));
  return normalizarObligacion(comprobar(await sb.from('obligaciones').insert({ ...fila, negocio_id: N }).select().single()));
}

// Se borra si no tiene pagos apuntados; si los tiene, se deja de usar (para no perder el historial)
export async function eliminarObligacion(id) {
  const regs = await registrosObligaciones({ obligacionId: id });
  if (regs.length) {
    if (modo === 'demo') demo.actualizar('obligaciones', id, { activo: false });
    else comprobar(await sb.from('obligaciones').update({ activo: false }).eq('id', id));
    return 'desactivada';
  }
  if (modo === 'demo') { const d = demo.leer(); d.obligaciones = d.obligaciones.filter((x) => x.id !== id); demo.escribir(d); }
  else comprobar(await sb.from('obligaciones').delete().eq('id', id));
  return 'eliminada';
}

export async function registrosObligaciones({ desde, hasta, obligacionId } = {}) {
  let filas;
  if (modo === 'demo') {
    filas = demo.listar('registros').filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)
      && (!obligacionId || r.obligacion_id === obligacionId));
  } else {
    let q = sb.from('obligacion_registros').select('*').eq('negocio_id', N);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    if (obligacionId) q = q.eq('obligacion_id', obligacionId);
    filas = comprobar(await q);
  }
  return filas.map((r) => ({ ...r, importe: r.importe === null || r.importe === undefined ? null : Number(r.importe) }))
    .sort((a, b) => (b.fecha + b.fecha_prevista).localeCompare(a.fecha + a.fecha_prevista));
}

// Registros de unas fechas previstas concretas (para saber qué está hecho)
export async function registrosPrevistos(desde, hasta) {
  if (modo === 'demo') return demo.listar('registros').filter((r) => r.fecha_prevista >= desde && r.fecha_prevista <= hasta);
  return comprobar(await sb.from('obligacion_registros').select('id, obligacion_id, fecha_prevista, estado, fecha, importe')
    .eq('negocio_id', N).gte('fecha_prevista', desde).lte('fecha_prevista', hasta));
}

// reg: { obligacion_id, fecha_prevista, fecha, estado: 'hecho'|'omitido', importe?, notas? }
export async function registrarObligacion(reg) {
  const fila = { obligacion_id: reg.obligacion_id, fecha_prevista: reg.fecha_prevista, fecha: reg.fecha || hoyISO(),
    estado: reg.estado === 'omitido' ? 'omitido' : 'hecho', importe: reg.estado === 'omitido' ? null : num(reg.importe), notas: reg.notas || null };
  if (modo === 'demo') {
    const d = demo.leer();
    if (d.registros.some((r) => r.obligacion_id === fila.obligacion_id && r.fecha_prevista === fila.fecha_prevista)) throw new Error('Esa fecha ya estaba apuntada');
    d.registros.push({ id: uid(), ...fila, created_at: new Date().toISOString() });
    demo.escribir(d); return;
  }
  comprobar(await sb.from('obligacion_registros').insert({ ...fila, negocio_id: N }));
}

export async function borrarRegistro(id) {
  if (modo === 'demo') { const d = demo.leer(); d.registros = d.registros.filter((x) => x.id !== id); demo.escribir(d); return; }
  comprobar(await sb.from('obligacion_registros').delete().eq('id', id));
}

// =====================================================================
// Copia de seguridad: descargar todo y volver a introducirlo
// =====================================================================
export const TABLAS_COPIA = ['clientas', 'servicios', 'productos', 'citas', 'cita_servicios', 'cobros', 'cobro_lineas', 'cobro_pagos',
  'facturas', 'cierres_caja', 'consumibles', 'consumible_movimientos', 'obligaciones', 'obligacion_registros'];
// En el modo demostración algunas tablas se guardan con otro nombre o dentro de otras
const DEMO_NOMBRE = { cierres_caja: 'cierres', consumible_movimientos: 'movimientos', obligacion_registros: 'registros' };

async function todasLasFilas(tabla) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const parte = comprobar(await sb.from(tabla).select('*').eq('negocio_id', N).order('id').range(desde, desde + 999));
    filas.push(...parte);
    if (parte.length < 1000) return filas;
  }
}

// Devuelve { app, version, creada, negocio, <tabla>: [filas]… } y la lista de tablas que no se pudieron leer
export async function exportarDatos(version) {
  const copia = { app: 'Manely Belleza', version, creada: new Date().toISOString(), modo };
  const faltan = [];
  if (modo === 'demo') {
    const d = demo.leer();
    copia.negocio = { ...d.negocio };
    for (const t of TABLAS_COPIA) copia[t] = [];
    for (const t of ['clientas', 'servicios', 'productos', 'facturas', 'consumibles', 'obligaciones']) copia[t] = structuredClone(d[t] || []);
    for (const t of ['cierres_caja', 'consumible_movimientos', 'obligacion_registros']) copia[t] = structuredClone(d[DEMO_NOMBRE[t]] || []);
    for (const c of d.citas || []) {
      const { cita_servicios: cs = [], ...cita } = c;
      copia.citas.push(cita);
      copia.cita_servicios.push(...cs.map((x) => ({ ...x, cita_id: c.id })));
    }
    for (const c of d.cobros || []) {
      const { cobro_lineas: l = [], cobro_pagos: pg = [], ...cobro } = c;
      copia.cobros.push(cobro);
      copia.cobro_lineas.push(...l.map((x) => ({ ...x, cobro_id: c.id })));
      copia.cobro_pagos.push(...pg.map((x) => ({ ...x, cobro_id: c.id })));
    }
    return { copia, faltan };
  }
  const { id, rol, ...datosNegocio } = negocio || {};
  copia.negocio = datosNegocio;
  for (const t of TABLAS_COPIA) {
    try { copia[t] = await todasLasFilas(t); }
    catch (e) { console.warn('Copia, tabla', t, e); copia[t] = []; faltan.push(t); }
  }
  return { copia, faltan };
}

// Añade lo que falte de una copia (lo que ya existe no se toca). Devuelve cuántas filas ha añadido por tabla.
export async function restaurarDatos(copia) {
  if (copia?.app !== 'Manely Belleza') throw new Error('El archivo no es una copia de Manely Belleza');
  if (modo !== 'demo') return comprobar(await sb.rpc('restaurar_copia', { p_negocio: N, p_datos: copia }));
  const d = demo.leer();
  const r = {};
  const anadir = (clave, filas) => {
    d[clave] ||= [];
    const hay = new Set(d[clave].map((x) => x.id));
    const nuevas = (filas || []).filter((x) => x?.id && !hay.has(x.id));
    d[clave].push(...structuredClone(nuevas));
    return nuevas.length;
  };
  for (const t of ['clientas', 'servicios', 'productos', 'facturas', 'consumibles', 'obligaciones']) r[t] = anadir(t, copia[t]);
  for (const t of ['cierres_caja', 'consumible_movimientos', 'obligacion_registros']) r[t] = anadir(DEMO_NOMBRE[t], copia[t]);
  const porPadre = (filas, campo) => { const m = {}; for (const x of filas || []) (m[x[campo]] ||= []).push(x); return m; };
  const cs = porPadre(copia.cita_servicios, 'cita_id');
  const antes = new Set((d.citas || []).map((x) => x.id));
  r.citas = anadir('citas', (copia.citas || []).map((c) => ({ ...c, cita_servicios: cs[c.id] || [] })));
  r.cita_servicios = (copia.citas || []).filter((c) => !antes.has(c.id)).reduce((a, c) => a + (cs[c.id] || []).length, 0);
  const li = porPadre(copia.cobro_lineas, 'cobro_id'), pg = porPadre(copia.cobro_pagos, 'cobro_id');
  r.cobros = anadir('cobros', (copia.cobros || []).map((c) => ({ ...c, cobro_lineas: li[c.id] || [], cobro_pagos: pg[c.id] || [] })));
  if (copia.negocio) for (const k of ['razon_social', 'nif', 'direccion', 'cp', 'poblacion', 'provincia', 'telefono', 'email']) if (!d.negocio[k] && copia.negocio[k]) d.negocio[k] = copia.negocio[k];
  demo.escribir(d);
  return r;
}

// =====================================================================
// Facturas
// =====================================================================
export async function emitirFactura(cobroId, tipo, receptor = {}) {
  if (modo === 'demo') return demo.emitirFactura(cobroId, tipo, receptor);
  return comprobar(await sb.rpc('emitir_factura', { p_cobro: cobroId, p_tipo: tipo, p_receptor: receptor }));
}

export async function obtenerFactura(id) {
  if (modo === 'demo') { const f = demo.leer().facturas.find((x) => x.id === id); if (!f) throw new Error('Factura no encontrada'); return structuredClone(f); }
  return comprobar(await sb.from('facturas').select('*').eq('id', id).single());
}

export async function facturaDeCobro(cobroId) {
  if (modo === 'demo') return structuredClone(demo.leer().facturas.find((x) => x.cobro_id === cobroId) || null);
  const filas = comprobar(await sb.from('facturas').select('*').eq('cobro_id', cobroId).limit(1));
  return filas[0] || null;
}

// =====================================================================
// Citas
// =====================================================================
const SELECT_CITA = '*, cita_servicios(*), clientas(id, nombre, apellidos, color, telefono, preferencias, notas), cobros(id, total, anulado)';

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

export async function cambiarAvisoCita(id, avisoMin) {
  const cambios = { aviso_min: avisoMin === '' || avisoMin === null || avisoMin === undefined ? null : Number(avisoMin) };
  if (modo === 'demo') return demo.actualizar('citas', id, cambios);
  comprobar(await sb.from('citas').update(cambios).eq('id', id));
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
      if (d) {
        // Datos de demostración de la versión anterior: añadir lo de la caja
        if (!d.productos) { d.productos = semillaProductos(); d.cobros = []; d.cierres = []; this.escribir(d); }
        if (!d.facturas) { d.facturas = []; this.escribir(d); }
        if (!d.consumibles) { const s = semillaInventario(); d.consumibles = s.consumibles; d.movimientos = s.movimientos; this.escribir(d); }
        if (!d.obligaciones) { const s = semillaSecretaria(); d.obligaciones = s.obligaciones; d.registros = s.registros; this.escribir(d); }
        return d;
      }
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
    return {
      ...c,
      clientas: d.clientas.find((x) => x.id === c.clienta_id) || null,
      cobros: (d.cobros || []).filter((x) => x.cita_id === c.id).map((x) => ({ id: x.id, total: x.total, anulado: x.anulado })),
    };
  },
  cobrosDonde(filtro) {
    const d = this.leer();
    return structuredClone(d.cobros.filter(filtro)
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
      .map((c) => ({ ...c, clientas: d.clientas.find((x) => x.id === c.clienta_id) || null })));
  },
  registrarCobro(cobro, lineas, pagos) {
    const d = this.leer();
    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    const sub = r2(lineas.reduce((a, l) => a + r2((Number(l.cantidad) || 1) * Number(l.precio_unit)), 0));
    const desc = r2(cobro.descuento || 0);
    if (desc < 0 || desc > sub) throw new Error('El descuento no puede ser mayor que el importe');
    const total = r2(sub - desc);
    const pagado = r2(pagos.reduce((a, p) => a + Number(p.importe), 0));
    if (Math.abs(pagado - total) > 0.009) throw new Error(`Los pagos (${pagado} €) no suman el total (${total} €)`);
    let clienta = cobro.clienta_id || null;
    if (cobro.cita_id) {
      if (d.cobros.some((c) => c.cita_id === cobro.cita_id && !c.anulado)) throw new Error('Esta cita ya está cobrada');
      const cita = d.citas.find((c) => c.id === cobro.cita_id);
      clienta = clienta || cita?.clienta_id || null;
      if (cita && ['pendiente', 'confirmada'].includes(cita.estado)) cita.estado = 'realizada';
    }
    const id = uid();
    d.cobros.push({
      id, fecha: cobro.fecha, hora: (cobro.hora || '00:00').slice(0, 5) + ':00', clienta_id: clienta, cita_id: cobro.cita_id || null,
      subtotal: sub, descuento: desc, total, notas: cobro.notas || null, anulado: false, created_at: new Date().toISOString(),
      cobro_lineas: lineas.map((l, i) => ({ id: uid(), ...l, cantidad: Number(l.cantidad) || 1, importe: r2((Number(l.cantidad) || 1) * Number(l.precio_unit)), orden: i })),
      cobro_pagos: pagos.filter((p) => Number(p.importe) > 0).map((p) => ({ id: uid(), metodo: p.metodo, importe: r2(p.importe) })),
    });
    for (const l of lineas) {
      const pr = l.producto_id && d.productos.find((x) => x.id === l.producto_id);
      if (pr && pr.stock !== null && pr.stock !== undefined) pr.stock -= Math.round(Number(l.cantidad) || 1);
    }
    this.escribir(d);
    return id;
  },
  emitirFactura(cobroId, tipo, receptor) {
    const d = this.leer();
    const c = d.cobros.find((x) => x.id === cobroId);
    if (!c) throw new Error('Cobro no encontrado');
    if (c.anulado) throw new Error('No se puede facturar un cobro anulado');
    if (d.facturas.some((f) => f.cobro_id === cobroId)) throw new Error('Este cobro ya tiene factura');
    const n = d.negocio;
    if (!n.nif || !(n.razon_social || n.nombre)) throw new Error('Faltan los datos fiscales del centro (titular y NIF) en Ajustes');
    if (tipo === 'completa') {
      if (!n.direccion) throw new Error('Falta la dirección del centro en Ajustes');
      if (!receptor?.nombre || !receptor?.nif || !receptor?.direccion) throw new Error('Para una factura completa hacen falta nombre, NIF y dirección de la clienta');
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    const factor = c.subtotal > 0 ? c.total / c.subtotal : 0;
    let resto = c.total;
    const lineas = c.cobro_lineas.map((l, i, arr) => {
      const imp = i === arr.length - 1 ? r2(resto) : r2(l.importe * factor);
      resto = r2(resto - imp);
      const base = r2(imp / (1 + Number(l.iva_pct) / 100));
      return { nombre: l.nombre, cantidad: l.cantidad, precio_unit: l.precio_unit, importe_bruto: l.importe, importe: imp, iva_pct: Number(l.iva_pct), base, cuota: r2(imp - base) };
    });
    const grupos = {};
    for (const l of lineas) { const g = (grupos[l.iva_pct] ||= { iva_pct: l.iva_pct, base: 0, cuota: 0 }); g.base = r2(g.base + l.base); g.cuota = r2(g.cuota + l.cuota); }
    const hoy = hoyISO();
    const serie = tipo === 'completa' ? 'F' : 'T';
    const anio = Number(hoy.slice(0, 4));
    const numero = d.facturas.filter((f) => f.serie === serie && f.anio === anio).reduce((m, f) => Math.max(m, f.numero), 0) + 1;
    const f = {
      id: uid(), cobro_id: cobroId, tipo, serie, anio, numero, codigo: `${serie}${anio}-${String(numero).padStart(4, '0')}`,
      fecha: hoy, fecha_operacion: c.fecha,
      emisor: { nombre: n.nombre, razon_social: n.razon_social || n.nombre, nif: n.nif, direccion: n.direccion, cp: n.cp, poblacion: n.poblacion, provincia: n.provincia, telefono: n.telefono, email: n.email },
      receptor: tipo === 'completa' ? receptor : null,
      lineas, desglose_iva: Object.values(grupos).sort((a, b) => b.iva_pct - a.iva_pct),
      base_total: r2(lineas.reduce((a, l) => a + l.base, 0)), cuota_total: r2(lineas.reduce((a, l) => a + l.cuota, 0)), total: c.total,
      created_at: new Date().toISOString(),
    };
    d.facturas.push(f);
    this.escribir(d);
    return f.id;
  },
  movimiento(mov) {
    const d = this.leer();
    const c = d.consumibles.find((x) => x.id === mov.consumible_id);
    if (!c) throw new Error('Artículo de inventario no encontrado');
    if ((mov.tipo === 'compra' && !(mov.cantidad > 0)) || (mov.tipo === 'uso' && !(mov.cantidad < 0))) throw new Error('Cantidad no válida');
    const coste = mov.coste ?? (mov.tipo !== 'compra' ? Math.round(Math.abs(mov.cantidad) * c.precio_envase / c.contenido_envase * 100) / 100 : null);
    d.movimientos.push({ id: uid(), ...mov, coste, created_at: new Date().toISOString() });
    c.stock_actual = Math.round((Number(c.stock_actual) + Number(mov.cantidad)) * 1000) / 1000;
    this.escribir(d);
  },
  borrarMovimiento(id) {
    const d = this.leer();
    const m = d.movimientos.find((x) => x.id === id);
    if (!m) return;
    const c = d.consumibles.find((x) => x.id === m.consumible_id);
    if (c) c.stock_actual = Math.round((Number(c.stock_actual) - Number(m.cantidad)) * 1000) / 1000;
    d.movimientos = d.movimientos.filter((x) => x.id !== id);
    this.escribir(d);
  },
  anularCobro(id, motivo) {
    const d = this.leer();
    const c = d.cobros.find((x) => x.id === id);
    if (!c) throw new Error('Cobro no encontrado');
    if (c.anulado) throw new Error('Este cobro ya estaba anulado');
    const fac = (d.facturas || []).find((f) => f.cobro_id === id);
    if (fac) throw new Error(`Este cobro tiene la factura ${fac.codigo}. Para anularlo hace falta una factura rectificativa (aún no disponible): consúltalo con el gestor.`);
    Object.assign(c, { anulado: true, motivo_anulacion: motivo || null, anulado_en: new Date().toISOString() });
    for (const l of c.cobro_lineas) {
      const pr = l.producto_id && d.productos.find((x) => x.id === l.producto_id);
      if (pr && pr.stock !== null && pr.stock !== undefined) pr.stock += Math.round(Number(l.cantidad) || 1);
    }
    this.escribir(d);
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

function semillaInventario() {
  const c = (nombre, marca, categoria, proveedor, unidad, contenido_envase, precio_envase, stock_actual, stock_minimo) =>
    ({ id: uid(), nombre, marca, categoria, proveedor, unidad, contenido_envase, precio_envase, stock_actual, stock_minimo, activo: true });
  const consumibles = [
    c('Acetona pura', 'Marca A', 'Quitaesmalte', 'Peluquería Andrea', 'ml', 500, 6, 380, 250),
    c('Acetona pura', 'Marca B', 'Quitaesmalte', 'Amazon', 'ml', 1000, 9.5, 900, 250),
    c('Algodones', 'Sansoft', 'Desechables', 'Peluquería Andrea', 'ud', 100, 2.5, 60, 50),
    c('Servilletas de papel', '', 'Desechables', 'Mercadona', 'ud', 200, 3, 120, 100),
    c('Guantes de nitrilo talla M', '', 'Desechables', 'Amazon', 'ud', 100, 7, 18, 40),
    c('Toallitas sin pelusa', 'Tiendaesmaltes', 'Desechables', 'Tiendaesmaltes', 'ud', 500, 4, 300, 100),
    c('Crema de masaje', 'Natura', 'Masaje', 'Grupo Vitalia', 'ml', 1000, 18, 650, 300),
  ];
  const movimientos = [];
  const hoy = hoyISO();
  const mov = (ci, dias, tipo, cantidad, coste = null) => {
    const art = consumibles[ci];
    movimientos.push({ id: uid(), consumible_id: art.id, fecha: sumarDias(hoy, -dias), tipo, cantidad, created_at: new Date(Date.now() - dias * 864e5).toISOString(),
      coste: coste ?? Math.round(Math.abs(cantidad) * art.precio_envase / art.contenido_envase * 100) / 100, envases: tipo === 'compra' ? cantidad / art.contenido_envase : null });
  };
  mov(0, 40, 'compra', 500, 6); mov(0, 30, 'uso', -60); mov(0, 18, 'uso', -40); mov(0, 6, 'uso', -20);
  mov(1, 25, 'compra', 1000, 9.5); mov(1, 10, 'uso', -60); mov(1, 3, 'uso', -40);
  mov(2, 20, 'uso', -40); mov(4, 12, 'uso', -50); mov(6, 15, 'uso', -200); mov(6, 2, 'uso', -150);
  return { consumibles, movimientos };
}

function semillaSecretaria() {
  const hoy = hoyISO();
  const mes = (dia, n = 0) => { const d = desdeISO(hoy); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(dia); return isoDe(d); };
  const o = (nombre, importe, proveedor, repeticion, cada, fecha_inicio, dia, aviso_cantidad, aviso_unidad, recordar, notas = '') =>
    ({ id: uid(), nombre, tipo: importe ? 'gasto' : 'tarea', categoria: null, proveedor, importe, repeticion, cada, fecha_inicio, dia, fecha_fin: null,
      hora: '10:00', aviso_cantidad, aviso_unidad, recordar, notas, activo: true });
  const obligaciones = [
    o('Alquiler del local', 250, 'Carolina Marín', 'meses', 1, mes(1, -3), 1, 3, 'dias', 'cada_dia', 'Por transferencia'),
    o('Luz', 60, 'Endesa', 'meses', 1, mes(12, -3), 12, 1, 'semanas', 'no', 'Domiciliada: comprobar el cargo'),
    o('Cuota de autónomos', 230, 'Seguridad Social', 'meses', 1, mes(28, -3), 28, 2, 'dias', 'no'),
    o('Teléfono e internet', 35, 'Movistar', 'meses', 1, mes(20, -3), 20, 2, 'dias', 'no'),
    o('Llevar los papeles al gestor', null, 'Gestoría', 'meses', 3, '2026-01-01', 1, 1, 'semanas', 'cada_dia', 'Facturas, tickets de compra y el informe del trimestre'),
    o('Seguro del local', 180, 'Mapfre', 'anios', 1, '2026-03-15', 15, 2, 'semanas', 'cada_dia'),
    o('Lámpara de mesa', 45.9, 'Ikea', 'una_vez', 1, mes(Math.max(1, Number(hoy.slice(8)) - 1)), null, null, 'dias', 'no'),
  ];
  const registros = [];
  const pagado = (ob, n, importe) => registros.push({ id: uid(), obligacion_id: ob.id, fecha_prevista: mes(Number(ob.fecha_inicio.slice(8)), n),
    fecha: mes(Number(ob.fecha_inicio.slice(8)), n), estado: 'hecho', importe, notas: null, created_at: new Date().toISOString() });
  for (const n of [-3, -2, -1]) { pagado(obligaciones[0], n, 250); pagado(obligaciones[2], n, 230); pagado(obligaciones[3], n, 35); }
  pagado(obligaciones[1], -3, 54.2); pagado(obligaciones[1], -2, 61.8); pagado(obligaciones[1], -1, 66.35);
  registros.push({ id: uid(), obligacion_id: obligaciones[6].id, fecha_prevista: obligaciones[6].fecha_inicio, fecha: obligaciones[6].fecha_inicio, estado: 'hecho', importe: 45.9, notas: null, created_at: new Date().toISOString() });
  return { obligaciones, registros };
}

function semillaProductos() {
  const p = (nombre, marca, categoria, precio, stock) => ({ id: uid(), nombre, marca, categoria, precio, iva_pct: 21, stock, activo: true });
  return [
    p('Esmalte semipermanente rojo cereza', 'OPI', 'Esmaltes', 14.5, 6),
    p('Esmalte nude rosado', 'Essie', 'Esmaltes', 11, 4),
    p('Aceite de cutícula', 'CND', 'Cuidado', 9.9, 10),
    p('Crema de manos 75 ml', 'Mavala', 'Cuidado', 12, null),
    p('Lima de cristal', '', 'Accesorios', 6, 2),
  ];
}

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
    productos: semillaProductos(),
    cobros: [],
    cierres: [],
    facturas: [],
    ...semillaInventario(),
    ...semillaSecretaria(),
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

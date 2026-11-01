// Secretaria: gastos fijos y obligaciones del negocio que se repiten
// (luz, alquiler, cuota de autónomos, papeles al gestor…), con sus avisos
// y el registro de lo pagado.
import * as db from '../db.js';
import { esc, euros, abrirHoja, aviso, errorAviso, cargando, datosFormulario, confirmar } from '../util.js';
import { hoyISO, sumarDias, primeroDeMes, ultimoDeMes, sumarMeses, textoMes, textoDiaCorto, textoDiaLargo, desdeISO } from '../fechas.js';
import { confirmarConPin } from '../pin.js';
import { pendientes, ocurrencias, proximaFecha, textoRepeticion, textoAntelacion, momentoAviso } from '../avisos.js';

const numero = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const coma = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const avisarCambio = () => window.dispatchEvent(new Event('mb:datos'));

const PLANTILLAS = [
  { nombre: 'Luz', tipo: 'gasto', categoria: 'Suministros', repeticion: 'meses', cada: 1, aviso_cantidad: 1, aviso_unidad: 'semanas' },
  { nombre: 'Agua', tipo: 'gasto', categoria: 'Suministros', repeticion: 'meses', cada: 2, aviso_cantidad: 1, aviso_unidad: 'semanas' },
  { nombre: 'Alquiler del local', tipo: 'gasto', categoria: 'Local', repeticion: 'meses', cada: 1, aviso_cantidad: 3, aviso_unidad: 'dias' },
  { nombre: 'Cuota de autónomos', tipo: 'gasto', categoria: 'Impuestos y cuotas', proveedor: 'Seguridad Social', repeticion: 'meses', cada: 1, aviso_cantidad: 2, aviso_unidad: 'dias' },
  { nombre: 'Teléfono e internet', tipo: 'gasto', categoria: 'Suministros', repeticion: 'meses', cada: 1, aviso_cantidad: 2, aviso_unidad: 'dias' },
  { nombre: 'Seguro', tipo: 'gasto', categoria: 'Seguros', repeticion: 'anios', cada: 1, aviso_cantidad: 2, aviso_unidad: 'semanas' },
  { nombre: 'Llevar los papeles al gestor', tipo: 'tarea', categoria: 'Gestoría', proveedor: 'Gestoría', repeticion: 'meses', cada: 3, aviso_cantidad: 1, aviso_unidad: 'semanas' },
  { nombre: 'Cita con el gestor', tipo: 'tarea', categoria: 'Gestoría', proveedor: 'Gestoría', repeticion: 'una_vez', cada: 1, aviso_cantidad: 1, aviso_unidad: 'dias' },
];
const CATEGORIAS = ['Local', 'Suministros', 'Impuestos y cuotas', 'Gestoría', 'Seguros', 'Formación', 'Publicidad', 'Material y herramientas', 'Otros'];
const REPETICIONES = { una_vez: 'No se repite', dias: 'días', semanas: 'semanas', meses: 'meses', anios: 'años' };

let pestanaMes = null;   // mes que se mira en «Pagado»

export async function render(el, sub) {
  const pestana = ['todo', 'pagado'].includes(sub) ? sub : 'proximo';
  el.innerHTML = `
    <section class="secretaria" aria-labelledby="tituloSec">
      <header class="barra">
        <h1 id="tituloSec" class="barra-titulo">Secretaria</h1>
        <button class="btn" data-suelto>Apuntar gasto suelto</button>
        <button class="btn btn-principal" data-nuevo>Nuevo gasto u obligación</button>
      </header>
      <p class="texto-suave intro">Gastos y obligaciones del negocio que no tienen que ver con las clientas: alquiler, luz, cuota de autónomos, papeles al gestor… La app avisa con la antelación que elijas y guarda lo pagado para el informe del trimestre.</p>
      <div class="sec-cuerpo"><p class="cargando-texto">Cargando…</p></div>
    </section>`;
  const zona = el.querySelector('.sec-cuerpo');
  const recargar = () => { avisarCambio(); render(el, sub); };

  let obs, items, regsMes;
  const hoy = hoyISO();
  const iniMes = primeroDeMes(hoy), finMes = ultimoDeMes(hoy);
  try {
    [obs, items, regsMes] = await Promise.all([db.listarObligaciones(), pendientes({ dias: 45 }), db.registrosObligaciones({ desde: iniMes, hasta: finMes })]);
  } catch (e) {
    console.error(e);
    zona.innerHTML = `<div class="tarjeta aviso-instalar"><h2>Falta un paso en Supabase</h2>
      <p>Para usar la Secretaria hay que ejecutar una vez el archivo <strong>supabase/005_secretaria.sql</strong> en el SQL Editor de Supabase.</p>
      <p class="texto-suave">${esc(e.message)}</p></div>`;
    return;
  }

  // Cifras del mes
  const previstoMes = obs.filter((o) => o.activo !== false && o.tipo === 'gasto' && o.importe)
    .reduce((a, o) => a + ocurrencias(o, iniMes, finMes).length * o.importe, 0);
  const pagadoMes = regsMes.filter((r) => r.estado === 'hecho').reduce((a, r) => a + (r.importe || 0), 0);
  const porPagarMes = items.filter((it) => it.o.tipo === 'gasto' && it.fecha >= iniMes && it.fecha <= finMes).reduce((a, it) => a + (it.o.importe || 0), 0);
  const atrasadas = items.filter((it) => it.atrasada);

  zona.innerHTML = `
    <div class="inv-resumen">
      <div><dt>Gastos fijos del mes</dt><dd>${euros(previstoMes)}</dd><small>aproximado, ${esc(textoMes(hoy).toLowerCase())}</small></div>
      <div><dt>Pagado este mes</dt><dd>${euros(pagadoMes)}</dd><small>${((n) => `${n} ${n === 1 ? 'apunte' : 'apuntes'}`)(regsMes.filter((r) => r.estado === 'hecho').length)}</small></div>
      <div><dt>Falta por pagar</dt><dd>${euros(porPagarMes)}</dd><small>hasta fin de mes</small></div>
      <div class="${atrasadas.length ? 'alerta' : ''}"><dt>Atrasado</dt><dd>${atrasadas.length}</dd><small>${atrasadas.length ? 'sin marcar como hecho' : 'todo al día'}</small></div>
    </div>
    <nav class="pestanas" aria-label="Secretaria">
      <a href="#secretaria" ${pestana === 'proximo' ? 'aria-current="page"' : ''}>Próximo</a>
      <a href="#secretaria/todo" ${pestana === 'todo' ? 'aria-current="page"' : ''}>Todo</a>
      <a href="#secretaria/pagado" ${pestana === 'pagado' ? 'aria-current="page"' : ''}>Pagado</a>
    </nav>
    <div class="sec-pestana"></div>`;
  const cuerpo = zona.querySelector('.sec-pestana');

  if (pestana === 'proximo') pintarProximo(cuerpo, items, obs);
  else if (pestana === 'todo') pintarTodo(cuerpo, obs, items);
  else await pintarPagado(cuerpo, obs, recargar);

  el.querySelector('[data-nuevo]').addEventListener('click', () => formulario(null, obs, recargar));
  el.querySelector('[data-suelto]').addEventListener('click', () => gastoSuelto(obs, recargar));
  cuerpo.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const o = obs.find((x) => x.id === (b.dataset.hecho || b.dataset.ficha));
    if (b.dataset.hecho) return apuntarHecho(o, b.dataset.fecha, recargar);
    if (b.dataset.ficha) return ficha(o, obs, recargar);
  });
}

// ---------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------
function filaFecha(it) {
  const o = it.o;
  const d = desdeISO(it.fecha);
  const avisando = (it.avisa && it.avisa <= new Date()) || it.atrasada || it.hoy;
  return `<li class="fila-sec ${it.atrasada ? 'atrasada' : ''} ${it.hoy ? 'es-hoy' : ''}">
    <span class="sec-fecha" aria-hidden="true"><b>${d.getDate()}</b><small>${new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(d).replace('.', '')}</small></span>
    <button class="sec-info" data-ficha="${o.id}">
      <strong>${avisando ? '<span class="campanita" title="Avisando">🔔</span> ' : ''}${esc(o.nombre)}</strong>
      <small>${esc(textoDiaLargo(it.fecha))} · ${esc(o.hora)}${o.proveedor ? ` · ${esc(o.proveedor)}` : ''}</small>
      <small class="sec-regla">${esc(textoRepeticion(o))} · ${esc(textoAntelacion(o.aviso_cantidad, o.aviso_unidad))}</small>
    </button>
    <span class="sec-importe">${o.tipo === 'gasto' ? (o.importe ? `~${euros(o.importe)}` : '—') : '<em>tarea</em>'}</span>
    <button class="btn btn-mini ${it.atrasada || it.hoy ? 'btn-principal' : ''}" data-hecho="${o.id}" data-fecha="${it.fecha}">${o.tipo === 'gasto' ? 'Pagado' : 'Hecho'}</button>
  </li>`;
}

function pintarProximo(cuerpo, items, obs) {
  const hoy = hoyISO(), semana = sumarDias(hoy, 7);
  const grupos = [
    ['Atrasado', items.filter((it) => it.atrasada), 'grupo-atrasado'],
    ['Hoy', items.filter((it) => it.hoy), ''],
    ['Próximos 7 días', items.filter((it) => it.fecha > hoy && it.fecha <= semana), ''],
    ['Más adelante', items.filter((it) => it.fecha > semana), ''],
  ].filter(([, l]) => l.length);
  cuerpo.innerHTML = grupos.length ? grupos.map(([t, l, cls]) => `
    <section class="grupo-servicios ${cls}"><h2>${t}</h2><ul class="lista-sec">${l.map(filaFecha).join('')}</ul></section>`).join('')
    : `<div class="vacio"><p>${obs.length ? 'No hay nada pendiente en las próximas semanas.' : 'Apunta los gastos y obligaciones del negocio (alquiler, luz, cuota de autónomos, papeles al gestor…) y la app te avisará antes de cada fecha.'}</p></div>`;
}

function pintarTodo(cuerpo, obs, items) {
  // Los gastos sueltos (una sola vez, ya pagados) solo salen en «Pagado»
  const visibles = obs.filter((o) => !(o.repeticion === 'una_vez' && (o.activo === false || !proximaFecha(o))));
  const activas = visibles.filter((o) => o.activo !== false), viejas = visibles.filter((o) => o.activo === false);
  const grupos = {};
  for (const o of activas) (grupos[o.categoria || 'Sin categoría'] ||= []).push(o);
  const fila = (o) => {
    // La próxima fecha sin pagar (o, si no hay ninguna pendiente cerca, la siguiente del calendario)
    const pend = items.find((it) => it.o.id === o.id);
    const prox = o.activo === false ? null : pend ? pend.fecha : proximaFecha(o, sumarDias(hoyISO(), 46));
    return `<li class="fila-sec ${o.activo === false ? 'inactivo' : ''}">
      <button class="sec-info" data-ficha="${o.id}">
        <strong>${esc(o.nombre)}</strong>
        <small>${esc(textoRepeticion(o))} · ${esc(textoAntelacion(o.aviso_cantidad, o.aviso_unidad))}</small>
        <small class="sec-regla">${prox ? `Próxima: ${esc(textoDiaLargo(prox))}` : o.activo === false ? 'Ya no se usa' : 'Sin más fechas'}${o.proveedor ? ` · ${esc(o.proveedor)}` : ''}</small>
      </button>
      <span class="sec-importe">${o.tipo === 'gasto' ? (o.importe ? `~${euros(o.importe)}` : '—') : '<em>tarea</em>'}</span>
    </li>`;
  };
  cuerpo.innerHTML = (Object.keys(grupos).length ? Object.entries(grupos).map(([cat, l]) => `
    <section class="grupo-servicios"><h2>${esc(cat)}</h2><ul class="lista-sec">${l.map(fila).join('')}</ul></section>`).join('')
    : '<div class="vacio"><p>Todavía no hay gastos ni obligaciones. Pulsa «Nuevo gasto u obligación».</p></div>')
    + (viejas.length ? `<section class="grupo-servicios"><h2>Ya no se usan</h2><ul class="lista-sec">${viejas.map(fila).join('')}</ul></section>` : '');
}

async function pintarPagado(cuerpo, obs, recargar) {
  pestanaMes ||= primeroDeMes(hoyISO());
  const mes = pestanaMes;
  const trimIni = `${mes.slice(0, 4)}-${String(Math.floor((Number(mes.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  const trimFin = ultimoDeMes(sumarMeses(trimIni, 2));
  let regs = [], regsTrim = [];
  try { [regs, regsTrim] = await Promise.all([db.registrosObligaciones({ desde: mes, hasta: ultimoDeMes(mes) }), db.registrosObligaciones({ desde: trimIni, hasta: trimFin })]); }
  catch (e) { return errorAviso(e); }
  const nombre = (id) => obs.find((o) => o.id === id);
  const total = regs.filter((r) => r.estado === 'hecho').reduce((a, r) => a + (r.importe || 0), 0);
  const totalTrim = regsTrim.filter((r) => r.estado === 'hecho').reduce((a, r) => a + (r.importe || 0), 0);
  const nTrim = Math.floor((Number(mes.slice(5, 7)) - 1) / 3) + 1;
  cuerpo.innerHTML = `
    <div class="sec-mes">
      <button class="btn-icono" data-mes="-1" aria-label="Mes anterior">‹</button>
      <h2>${esc(textoMes(mes))}</h2>
      <button class="btn-icono" data-mes="1" aria-label="Mes siguiente">›</button>
    </div>
    <p class="sec-totales"><span>Total del mes: <strong>${euros(total)}</strong></span><span>${nTrim}.º trimestre de ${mes.slice(0, 4)}: <strong>${euros(totalTrim)}</strong></span></p>
    ${regs.length ? `<ul class="lista-movs lista-pagos">${regs.map((r) => {
      const o = nombre(r.obligacion_id);
      return `<li class="${r.estado === 'omitido' ? 'omitido' : ''}">
        <time>${esc(textoDiaCorto(r.fecha))}</time>
        <span><strong>${esc(o?.nombre || 'Gasto')}</strong><small>${esc([o?.categoria, r.estado === 'omitido' ? 'Saltado' : o?.tipo === 'tarea' ? 'Hecho' : null, r.notas].filter(Boolean).join(' · '))}</small></span>
        <b>${r.estado === 'hecho' && r.importe !== null ? euros(r.importe) : ''}</b>
        <button class="btn-icono mov-borrar" data-borrar-reg="${r.id}" aria-label="Borrar este apunte">✕</button>
      </li>`;
    }).join('')}</ul>` : '<div class="vacio"><p>No hay nada apuntado este mes.</p></div>'}`;
  cuerpo.onclick = async (e) => {
    const m = e.target.closest('[data-mes]');
    if (m) { pestanaMes = sumarMeses(mes, Number(m.dataset.mes)); return pintarPagado(cuerpo, obs, recargar); }
    const b = e.target.closest('[data-borrar-reg]');
    if (b && await confirmar('¿Borrar este apunte?', { detalle: 'Esa fecha volverá a aparecer como pendiente.', si: 'Borrar', peligro: true })) {
      try { await db.borrarRegistro(b.dataset.borrarReg); aviso('Apunte borrado'); recargar(); } catch (err) { errorAviso(err); }
    }
  };
}

// ---------------------------------------------------------------------
// Marcar como pagado / hecho (también se usa desde el aviso)
// ---------------------------------------------------------------------
export function apuntarHecho(o, fechaPrevista, alHacer) {
  const gasto = o.tipo === 'gasto';
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <div><h2 class="hoja-titulo">${gasto ? 'Pagado' : 'Hecho'}: ${esc(o.nombre)}</h2>
          <p class="texto-suave">Tocaba el ${esc(textoDiaLargo(fechaPrevista).toLowerCase())}</p></div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <div class="fila-2">
          <label class="campo"><span>${gasto ? 'Pagado el' : 'Hecho el'}</span><input type="date" name="fecha" value="${hoyISO()}"></label>
          ${gasto ? `<label class="campo"><span>Importe pagado (€)</span><input name="importe" inputmode="decimal" value="${esc(coma(o.importe))}" autofocus></label>` : '<div></div>'}
        </div>
        <label class="campo"><span>Nota (opcional)</span><input name="notas" placeholder="${gasto ? 'Ej.: nº de factura, domiciliado…' : ''}"></label>
      </div>
      <footer class="hoja-pie">
        <button type="button" class="btn pie-izquierda" data-saltar>Saltar esta vez</button>
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${gasto ? 'Apuntar pago' : 'Marcar hecho'}</button>
      </footer>
    </form>`, { ancho: 'estrecha' });
  const f = el.querySelector('form');
  const guardar = async (estado) => {
    if (estado === 'hecho' && gasto && !(numero(f.elements.importe.value) >= 0 && f.elements.importe.value.trim())) return aviso('Escribe el importe pagado.', 'error');
    try {
      cargando(true);
      await db.registrarObligacion({ obligacion_id: o.id, fecha_prevista: fechaPrevista, fecha: f.elements.fecha.value || hoyISO(),
        estado, importe: gasto ? f.elements.importe.value : null, notas: f.elements.notas.value.trim() });
      aviso(estado === 'omitido' ? 'Saltado: no se pagará esta vez' : gasto ? 'Pago apuntado' : 'Hecho');
      cerrar(); alHacer?.();
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); guardar('hecho'); });
  el.querySelector('[data-saltar]').addEventListener('click', () => guardar('omitido'));
}

// ---------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------
async function ficha(o, obs, alCambiar) {
  let regs = [];
  try { regs = await db.registrosObligaciones({ obligacionId: o.id }); } catch (e) { return errorAviso(e); }
  const hoy = hoyISO();
  const proximas = o.activo === false ? [] : ocurrencias(o, hoy, sumarDias(hoy, 800)).slice(0, 3);
  const pagados = regs.filter((r) => r.estado === 'hecho' && r.importe !== null);
  const media = pagados.length ? pagados.slice(0, 6).reduce((a, r) => a + r.importe, 0) / Math.min(6, pagados.length) : null;
  const totalAnio = pagados.filter((r) => r.fecha.slice(0, 4) === hoy.slice(0, 4)).reduce((a, r) => a + r.importe, 0);
  const avisoProx = proximas[0] && o.aviso_cantidad !== null ? momentoAviso(proximas[0], o.hora, o.aviso_cantidad, o.aviso_unidad) : null;
  const { el, cerrar } = abrirHoja(`
    <header class="hoja-cabecera">
      <div><h2 class="hoja-titulo">${esc(o.nombre)}</h2>
        <p class="texto-suave">${[o.tipo === 'gasto' ? 'Gasto' : 'Tarea', o.categoria, o.proveedor].filter(Boolean).map(esc).join(' · ')}</p></div>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo">
      <dl class="cifras inv-cifras">
        <div><dt>Se repite</dt><dd class="dd-texto">${esc(textoRepeticion(o))}</dd><small>a las ${esc(o.hora)}${o.fecha_fin ? ` · hasta ${esc(textoDiaCorto(o.fecha_fin))}` : ''}</small></div>
        <div><dt>Aviso</dt><dd class="dd-texto">${esc(textoAntelacion(o.aviso_cantidad, o.aviso_unidad).replace(/^aviso /, ''))}</dd><small>${avisoProx ? `el próximo: ${esc(new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(avisoProx))}` : '&nbsp;'}</small></div>
        ${o.tipo === 'gasto' ? `<div><dt>Importe</dt><dd>${o.importe ? `~${euros(o.importe)}` : '—'}</dd><small>${media !== null ? `media real ${euros(media)}` : 'aproximado'}</small></div>
        <div><dt>Pagado en ${hoy.slice(0, 4)}</dt><dd>${euros(totalAnio)}</dd><small>${pagados.filter((r) => r.fecha.slice(0, 4) === hoy.slice(0, 4)).length} pagos</small></div>` : ''}
      </dl>
      ${o.notas ? `<p class="detalle-notas"><strong>Notas:</strong> ${esc(o.notas)}</p>` : ''}
      ${proximas.length ? `<h3 class="inv-subtitulo">Próximas fechas</h3>
        <ul class="sec-proximas">${proximas.map((f) => `<li>${esc(textoDiaLargo(f))}${regs.some((r) => r.fecha_prevista === f) ? ' · <em>ya apuntado</em>' : ''}</li>`).join('')}</ul>` : ''}
      <h3 class="inv-subtitulo">Historial</h3>
      ${regs.length ? `<ul class="lista-movs lista-pagos">${regs.slice(0, 24).map((r) => `<li class="${r.estado === 'omitido' ? 'omitido' : ''}">
          <time>${esc(textoDiaCorto(r.fecha))}</time>
          <span><small>${r.estado === 'omitido' ? 'Saltado' : 'Tocaba'} el ${esc(textoDiaCorto(r.fecha_prevista))}${r.notas ? ` · ${esc(r.notas)}` : ''}</small></span>
          <b>${r.estado === 'hecho' && r.importe !== null ? euros(r.importe) : r.estado === 'hecho' ? 'Hecho' : ''}</b>
          <button class="btn-icono mov-borrar" data-borrar-reg="${r.id}" aria-label="Borrar este apunte">✕</button></li>`).join('')}</ul>`
        : '<p class="texto-suave">Todavía no hay nada apuntado.</p>'}
    </div>
    <footer class="hoja-pie acciones-cita">
      <button class="btn" data-a="editar">Editar</button>
    </footer>`, { ancho: 'normal' });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-a="editar"]')) { cerrar(); return formulario(o, obs, alCambiar); }
    const b = e.target.closest('[data-borrar-reg]');
    if (b && await confirmar('¿Borrar este apunte?', { detalle: 'Esa fecha volverá a aparecer como pendiente.', si: 'Borrar', peligro: true })) {
      try { await db.borrarRegistro(b.dataset.borrarReg); aviso('Apunte borrado'); cerrar(); alCambiar(); } catch (err) { errorAviso(err); }
    }
  });
}

// ---------------------------------------------------------------------
// Alta / edición
// ---------------------------------------------------------------------
function formulario(o, obs, alGuardar) {
  const nuevo = !o;
  o = o || { tipo: 'gasto', repeticion: 'meses', cada: 1, fecha_inicio: hoyISO(), hora: '10:00', aviso_cantidad: 3, aviso_unidad: 'dias', activo: true };
  const cats = [...new Set([...CATEGORIAS, ...obs.map((x) => x.categoria).filter(Boolean)])];
  const sinAviso = o.aviso_cantidad === null || o.aviso_cantidad === undefined;
  const { el, cerrar } = abrirHoja(`
    <form novalidate class="form-sec">
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">${nuevo ? 'Nuevo gasto u obligación' : 'Editar'}</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        ${nuevo ? `<div class="plantillas" aria-label="Rellenar con un ejemplo">${PLANTILLAS.map((p, i) => `<button type="button" class="chip" data-plantilla="${i}">${esc(p.nombre)}</button>`).join('')}</div>` : ''}
        <div class="segmentos tipo-sec" role="radiogroup" aria-label="Tipo">
          <label><input type="radio" name="tipo" value="gasto" ${o.tipo !== 'tarea' ? 'checked' : ''}><span>Gasto · hay que pagarlo</span></label>
          <label><input type="radio" name="tipo" value="tarea" ${o.tipo === 'tarea' ? 'checked' : ''}><span>Tarea · hay que hacerla</span></label>
        </div>
        <label class="campo"><span>¿Qué es?</span><input name="nombre" required value="${esc(o.nombre || '')}" placeholder="Ej.: Luz, Alquiler, Llevar los papeles al gestor"></label>
        <div class="fila-3">
          <label class="campo"><span>Categoría</span><input name="categoria" list="secCats" value="${esc(o.categoria || '')}">
            <datalist id="secCats">${cats.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
          <label class="campo"><span>A quién / empresa</span><input name="proveedor" value="${esc(o.proveedor || '')}" placeholder="Ej.: Endesa"></label>
          <label class="campo solo-gasto"><span>Importe aproximado (€)</span><input name="importe" inputmode="decimal" value="${esc(coma(o.importe))}"></label>
        </div>
        <div class="fila-2">
          <label class="campo"><span>${nuevo ? 'Primera fecha' : 'Fecha de referencia'}</span><input type="date" name="fecha_inicio" required value="${esc(o.fecha_inicio)}"></label>
          <label class="campo"><span>Hora</span><input type="time" name="hora" step="300" value="${esc(o.hora || '10:00')}"></label>
        </div>
        <div class="fila-2">
          <div class="campo"><span>Se repite</span>
            <div class="repite"><span class="cada-n">cada <input name="cada" type="number" min="1" max="365" inputmode="numeric" value="${esc(o.cada || 1)}" aria-label="Cada cuántos"></span>
            <select name="repeticion" aria-label="Se repite">${Object.entries(REPETICIONES).map(([k, v]) => `<option value="${k}" ${o.repeticion === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
          <div class="campo"><span>Aviso</span>
            <div class="aviso-cuanto">
              <label class="check-mini"><input type="checkbox" name="con_aviso" ${sinAviso ? '' : 'checked'} aria-label="Avisarme"></label>
              <input name="aviso_cantidad" type="number" min="0" max="1000" inputmode="numeric" value="${esc(sinAviso ? 3 : o.aviso_cantidad)}" aria-label="Cuánto antes">
              <select name="aviso_unidad" aria-label="Unidad">${[['minutos', 'minutos'], ['horas', 'horas'], ['dias', 'días'], ['semanas', 'semanas']].map(([k, v]) => `<option value="${k}" ${o.aviso_unidad === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <span>antes</span>
            </div></div>
        </div>
        <p class="resumen-regla" aria-live="polite"></p>
        <div class="fila-2">
          <label class="campo"><span>Hasta (opcional)</span><input type="date" name="fecha_fin" value="${esc(o.fecha_fin || '')}"></label>
          <label class="campo"><span>Notas</span><input name="notas" value="${esc(o.notas || '')}" placeholder="Ej.: domiciliado, nº de contrato…"></label>
        </div>
        ${nuevo ? '' : `<label class="check"><input type="checkbox" name="activo" ${o.activo !== false ? 'checked' : ''}> Sigue vigente</label>`}
      </div>
      <footer class="hoja-pie">
        ${nuevo ? '' : '<button type="button" class="btn btn-peligro-suave pie-izquierda" data-eliminar>Eliminar</button>'}
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${nuevo ? 'Guardar' : 'Guardar cambios'}</button>
      </footer>
    </form>`, { ancho: 'ancha' });
  const f = el.querySelector('form');
  const E = f.elements;
  const leer = () => ({
    tipo: E.tipo.value, repeticion: E.repeticion.value, cada: numero(E.cada.value) || 1, fecha_inicio: E.fecha_inicio.value || hoyISO(),
    aviso_cantidad: E.con_aviso.checked ? Math.round(numero(E.aviso_cantidad.value)) : null, aviso_unidad: E.aviso_unidad.value,
  });
  const actualizar = () => {
    const x = leer();
    f.classList.toggle('es-tarea', x.tipo === 'tarea');
    el.querySelector('.cada-n').hidden = x.repeticion === 'una_vez';
    el.querySelectorAll('.aviso-cuanto > input, .aviso-cuanto > select, .aviso-cuanto > span').forEach((x) => x.classList.toggle('apagado', !E.con_aviso.checked));
    const prox = proximaFecha({ ...x, fecha_fin: E.fecha_fin.value || null });
    el.querySelector('.resumen-regla').textContent = `${textoRepeticion(x)} · ${textoAntelacion(x.aviso_cantidad, x.aviso_unidad)}${prox ? ` · próxima: ${textoDiaLargo(prox).toLowerCase()}` : ''}`;
  };
  f.addEventListener('input', actualizar);
  f.addEventListener('change', actualizar);
  el.querySelector('.plantillas')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-plantilla]'); if (!b) return;
    const p = PLANTILLAS[b.dataset.plantilla];
    E.nombre.value = p.nombre; E.categoria.value = p.categoria; E.proveedor.value = p.proveedor || '';
    f.querySelector(`[name=tipo][value=${p.tipo}]`).checked = true;
    E.repeticion.value = p.repeticion; E.cada.value = p.cada;
    E.con_aviso.checked = true; E.aviso_cantidad.value = p.aviso_cantidad; E.aviso_unidad.value = p.aviso_unidad;
    el.querySelectorAll('.chip').forEach((c) => c.classList.toggle('activo', c === b));
    actualizar();
    (p.tipo === 'gasto' ? E.importe : E.fecha_inicio).focus();
  });
  actualizar();

  el.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
    const ok = await confirmarConPin({ titulo: 'Eliminar', texto: `«${o.nombre}» dejará de avisar. Si ya tiene pagos apuntados, se conservan para los informes. Escribe tu PIN para confirmarlo.` });
    if (!ok) return;
    try { cargando(true); const r = await db.eliminarObligacion(o.id); aviso(r === 'eliminada' ? 'Eliminado' : 'Ya no avisará (se guardan sus pagos)'); cerrar(); alGuardar(); }
    catch (err) { errorAviso(err); } finally { cargando(false); }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(f);
    if (!d.nombre) return aviso('Escribe qué es.', 'error');
    if (!d.fecha_inicio) return aviso('Pon la fecha.', 'error');
    if (d.fecha_fin && d.fecha_fin < d.fecha_inicio) return aviso('La fecha «hasta» es anterior a la primera fecha.', 'error');
    const x = leer();
    const datos = { ...d, ...x, cada: x.repeticion === 'una_vez' ? 1 : x.cada, importe: x.tipo === 'gasto' ? d.importe : null, id: o.id, activo: nuevo ? true : d.activo };
    delete datos.con_aviso;
    try { cargando(true); await db.guardarObligacion(datos); aviso('Guardado'); cerrar(); alGuardar(); }
    catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

// ---------------------------------------------------------------------
// Gasto suelto (una sola vez y ya pagado): una lámpara, un curso…
// ---------------------------------------------------------------------
function gastoSuelto(obs, alGuardar) {
  const cats = [...new Set([...CATEGORIAS, ...obs.map((x) => x.categoria).filter(Boolean)])];
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <div><h2 class="hoja-titulo">Apuntar gasto suelto</h2><p class="texto-suave">Un gasto del negocio que no se repite: una lámpara, un curso, publicidad…</p></div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <label class="campo"><span>Concepto</span><input name="nombre" required autofocus></label>
        <div class="fila-3">
          <label class="campo"><span>Importe (€)</span><input name="importe" inputmode="decimal"></label>
          <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${hoyISO()}"></label>
          <label class="campo"><span>Categoría</span><input name="categoria" list="secCats2" value="Otros">
            <datalist id="secCats2">${cats.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        </div>
        <div class="fila-2">
          <label class="campo"><span>Dónde / a quién</span><input name="proveedor"></label>
          <label class="campo"><span>Nota</span><input name="notas" placeholder="Ej.: nº de factura"></label>
        </div>
      </div>
      <footer class="hoja-pie">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">Apuntar</button>
      </footer>
    </form>`, { ancho: 'normal' });
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(e.target);
    if (!d.nombre) return aviso('Escribe el concepto.', 'error');
    if (!d.importe) return aviso('Escribe el importe.', 'error');
    const fecha = d.fecha || hoyISO();
    try {
      cargando(true);
      const o = await db.guardarObligacion({ nombre: d.nombre, tipo: 'gasto', categoria: d.categoria, proveedor: d.proveedor, importe: d.importe,
        repeticion: 'una_vez', cada: 1, fecha_inicio: fecha, hora: '10:00', aviso_cantidad: null, aviso_unidad: 'dias', notas: null, activo: false });
      await db.registrarObligacion({ obligacion_id: o.id, fecha_prevista: fecha, fecha, estado: 'hecho', importe: d.importe, notas: d.notas });
      aviso('Gasto apuntado'); cerrar(); alGuardar();
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

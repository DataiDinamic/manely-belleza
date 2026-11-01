// Avisos: gastos y obligaciones del negocio que se repiten (luz, alquiler,
// cuota de autónomos, papeles al gestor…) o que son puntuales, con su aviso
// previo y el registro de lo pagado o hecho.
import * as db from '../db.js';
import { esc, euros, abrirHoja, aviso, errorAviso, cargando, datosFormulario, confirmar } from '../util.js';
import { hoyISO, sumarDias, primeroDeMes, ultimoDeMes, sumarMeses, textoMes, textoDiaCorto, textoDiaLargo, desdeISO, isoDe } from '../fechas.js';
import { confirmarConPin } from '../pin.js';
import { pendientes, ocurrencias, proximaFecha, textoRepeticion, textoAntelacion, momentoAviso,
  PERIODOS, periodoDe, NOMBRES_MESES, NOMBRES_DIAS } from '../avisos.js';

const numero = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const coma = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const avisarCambio = () => window.dispatchEvent(new Event('mb:datos'));
const PESTANAS = { total: 'Total', ...Object.fromEntries(Object.entries(PERIODOS).map(([k, p]) => [k, p.nombre])) };
const verbo = (o) => (o.importe ? 'Pagado' : 'Hecho');

export async function render(el, sub) {
  const pestana = PESTANAS[sub] ? sub : 'total';
  el.innerHTML = `
    <section class="secretaria" aria-labelledby="tituloAv">
      <header class="barra"><h1 id="tituloAv" class="barra-titulo">Avisos</h1></header>
      <div class="sec-cuerpo"><p class="cargando-texto">Cargando…</p></div>
    </section>`;
  const zona = el.querySelector('.sec-cuerpo');
  const recargar = () => { avisarCambio(); render(el, sub); };

  let obs, items, regs;
  const hoy = hoyISO();
  const iniMes = primeroDeMes(hoy), finMes = ultimoDeMes(hoy);
  try {
    [obs, items, regs] = await Promise.all([db.listarObligaciones(), pendientes({ dias: 45 }), db.registrosObligaciones()]);
  } catch (e) {
    console.error(e);
    zona.innerHTML = `<div class="tarjeta aviso-instalar"><h2>Falta un paso en Supabase</h2>
      <p>Para usar los Avisos hay que ejecutar una vez el archivo <strong>supabase/005_secretaria.sql</strong> en el SQL Editor de Supabase.</p>
      <p class="texto-suave">${esc(e.message)}</p></div>`;
    return;
  }

  // Cifras del mes
  const regsMes = regs.filter((r) => r.fecha >= iniMes && r.fecha <= finMes && r.estado === 'hecho');
  const previstoMes = obs.filter((o) => o.activo !== false && o.importe && o.repeticion !== 'una_vez')
    .reduce((a, o) => a + ocurrencias(o, iniMes, finMes).length * o.importe, 0);
  const pagadoMes = regsMes.reduce((a, r) => a + (r.importe || 0), 0);
  const porPagarMes = items.filter((it) => it.fecha >= iniMes && it.fecha <= finMes).reduce((a, it) => a + (it.o.importe || 0), 0);
  const atrasadas = items.filter((it) => it.atrasada);

  // Cada aviso con su próxima fecha pendiente y su estado
  const filas = obs.map((o) => {
    const pend = items.find((it) => it.o.id === o.id);
    const hechos = regs.filter((r) => r.obligacion_id === o.id);
    return { o, periodo: periodoDe(o), pend, ultimo: hechos[0] || null,
      prox: pend ? pend.fecha : o.activo === false ? null : proximaFecha(o, sumarDias(hoy, 46)) };
  });
  const enPestana = (f) => pestana === 'total' || f.periodo === pestana;
  const cuenta = (k) => filas.filter((f) => (k === 'total' || f.periodo === k) && (f.o.activo !== false || f.periodo === 'puntual')).length;

  zona.innerHTML = `
    <div class="inv-resumen">
      <div><dt>Gastos fijos del mes</dt><dd>${euros(previstoMes)}</dd><small>aproximado, ${esc(textoMes(hoy).toLowerCase())}</small></div>
      <button class="tile-boton" data-pagado><dt>Pagado este mes</dt><dd>${euros(pagadoMes)}</dd><small>Ver lo pagado ›</small></button>
      <div><dt>Falta por pagar</dt><dd>${euros(porPagarMes)}</dd><small>hasta fin de mes</small></div>
      <div class="${atrasadas.length ? 'alerta' : ''}"><dt>Atrasado</dt><dd>${atrasadas.length}</dd><small>${atrasadas.length ? 'sin marcar como hecho' : 'todo al día'}</small></div>
    </div>
    <nav class="pestanas pestanas-avisos" aria-label="Periodos">
      ${Object.entries(PESTANAS).map(([k, t]) => `<a href="#avisos${k === 'total' ? '' : `/${k}`}" ${pestana === k ? 'aria-current="page"' : ''}>${t}${cuenta(k) ? ` <small>${cuenta(k)}</small>` : ''}</a>`).join('')}
    </nav>
    <div class="av-acciones"><button class="btn btn-principal" data-nuevo>Gasto nuevo</button></div>
    <div class="sec-pestana">${pintarLista(filas.filter(enPestana), pestana)}</div>`;

  el.querySelector('[data-nuevo]').addEventListener('click', () => formulario(null, pestana === 'total' ? 'mes' : pestana, recargar));
  el.querySelector('[data-pagado]').addEventListener('click', () => verPagado(obs, recargar));
  zona.querySelector('.sec-pestana').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const o = obs.find((x) => x.id === (b.dataset.hecho || b.dataset.ficha));
    if (b.dataset.hecho) return apuntarHecho(o, b.dataset.fecha, recargar);
    if (b.dataset.ficha) return ficha(o, recargar);
  });
}

// ---------------------------------------------------------------------
// Lista de una pestaña
// ---------------------------------------------------------------------
function pintarLista(filas, pestana) {
  const hoy = hoyISO();
  const activas = filas.filter((f) => f.o.activo !== false || (f.periodo === 'puntual' && f.ultimo));
  const viejas = filas.filter((f) => !activas.includes(f));
  // Primero lo atrasado, luego por fecha; lo ya hecho (puntual) al final
  const orden = (f) => (f.pend ? f.pend.fecha : f.prox ? `x${f.prox}` : `z${f.ultimo?.fecha || ''}`);
  activas.sort((a, b) => orden(a).localeCompare(orden(b)));
  const fila = (f) => {
    const { o, pend } = f;
    const fecha = pend?.fecha || f.prox;
    const d = fecha ? desdeISO(fecha) : null;
    const avisando = pend && ((pend.avisa && pend.avisa <= new Date()) || pend.atrasada || pend.hoy);
    const hecho = !fecha && f.ultimo;
    return `<li class="fila-sec ${pend?.atrasada ? 'atrasada' : ''} ${pend?.hoy ? 'es-hoy' : ''} ${o.activo === false && !hecho ? 'inactivo' : ''} ${hecho ? 'hecha' : ''}">
      <span class="sec-fecha" aria-hidden="true">${d ? `<b>${d.getDate()}</b><small>${new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(d).replace('.', '')}</small>` : '<b>✓</b>'}</span>
      <button class="sec-info" data-ficha="${o.id}">
        <strong>${avisando ? '<span class="campanita" title="Avisando">🔔</span> ' : ''}${esc(o.nombre)}${pestana === 'total' && PERIODOS[f.periodo] ? ` <em class="etiqueta-periodo">${PERIODOS[f.periodo].nombre}</em>` : ''}</strong>
        <small>${fecha ? `${pend?.atrasada ? 'Atrasado · ' : ''}${esc(textoDiaLargo(fecha))} · ${esc(o.hora)}` : hecho ? `${verbo(o)} el ${esc(textoDiaLargo(f.ultimo.fecha).toLowerCase())}` : 'Sin más fechas'}${o.proveedor ? ` · ${esc(o.proveedor)}` : ''}</small>
        <small class="sec-regla">${esc(textoRepeticion(o))}${hecho ? '' : ` · ${esc(textoAntelacion(o.aviso_cantidad, o.aviso_unidad, o.recordar))}`}</small>
      </button>
      <span class="sec-importe">${hecho && f.ultimo.importe !== null ? euros(f.ultimo.importe) : o.importe ? `${o.repeticion === 'una_vez' ? '' : '~'}${euros(o.importe)}` : ''}</span>
      ${pend ? `<button class="btn btn-mini ${pend.atrasada || pend.hoy || avisando ? 'btn-principal' : ''}" data-hecho="${o.id}" data-fecha="${pend.fecha}">${verbo(o)}</button>` : '<span></span>'}
    </li>`;
  };
  const vacio = pestana === 'total'
    ? 'Todavía no hay avisos. Pulsa «Gasto nuevo» para apuntar el alquiler, la luz, la cuota de autónomos, los papeles del gestor…'
    : `No hay nada en «${PESTANAS[pestana]}». Pulsa «Gasto nuevo» para añadirlo.`;
  return (activas.length ? `<ul class="lista-sec">${activas.map(fila).join('')}</ul>` : `<div class="vacio"><p>${vacio}</p></div>`)
    + (viejas.length ? `<section class="grupo-servicios"><h2>Ya no avisan</h2><ul class="lista-sec">${viejas.map(fila).join('')}</ul></section>` : '');
}

// ---------------------------------------------------------------------
// Lo pagado, mes a mes (con el total del trimestre para el gestor)
// ---------------------------------------------------------------------
function verPagado(obs, alCambiar) {
  let mes = primeroDeMes(hoyISO());
  let cambiado = false;
  const { el } = abrirHoja(`
    <header class="hoja-cabecera"><h2 class="hoja-titulo">Lo pagado</h2>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></header>
    <div class="hoja-cuerpo"></div>`, { ancho: 'normal', alCerrar: () => { if (cambiado) alCambiar(); } });
  const cuerpo = el.querySelector('.hoja-cuerpo');
  const pintar = async () => {
    const trimIni = `${mes.slice(0, 4)}-${String(Math.floor((Number(mes.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    const trimFin = ultimoDeMes(sumarMeses(trimIni, 2));
    let regs = [], regsTrim = [];
    try { [regs, regsTrim] = await Promise.all([db.registrosObligaciones({ desde: mes, hasta: ultimoDeMes(mes) }), db.registrosObligaciones({ desde: trimIni, hasta: trimFin })]); }
    catch (e) { return errorAviso(e); }
    const suma = (l) => l.filter((r) => r.estado === 'hecho').reduce((a, r) => a + (r.importe || 0), 0);
    const nTrim = Math.floor((Number(mes.slice(5, 7)) - 1) / 3) + 1;
    cuerpo.innerHTML = `
      <div class="sec-mes">
        <button class="btn-icono" data-mes="-1" aria-label="Mes anterior">‹</button>
        <h2>${esc(textoMes(mes))}</h2>
        <button class="btn-icono" data-mes="1" aria-label="Mes siguiente">›</button>
      </div>
      <p class="sec-totales"><span>Total del mes: <strong>${euros(suma(regs))}</strong></span><span>${nTrim}.º trimestre de ${mes.slice(0, 4)}: <strong>${euros(suma(regsTrim))}</strong></span></p>
      ${regs.length ? `<ul class="lista-movs lista-pagos">${regs.map((r) => {
        const o = obs.find((x) => x.id === r.obligacion_id);
        return `<li class="${r.estado === 'omitido' ? 'omitido' : ''}">
          <time>${esc(textoDiaCorto(r.fecha))}</time>
          <span><strong>${esc(o?.nombre || 'Gasto')}</strong><small>${esc([r.estado === 'omitido' ? 'Saltado' : !r.importe ? 'Hecho' : null, r.notas].filter(Boolean).join(' · '))}</small></span>
          <b>${r.estado === 'hecho' && r.importe !== null ? euros(r.importe) : ''}</b>
          <button class="btn-icono mov-borrar" data-borrar-reg="${r.id}" aria-label="Borrar este apunte">✕</button>
        </li>`;
      }).join('')}</ul>` : '<p class="texto-suave">No hay nada apuntado este mes.</p>'}`;
  };
  cuerpo.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mes]');
    if (m) { mes = sumarMeses(mes, Number(m.dataset.mes)); return pintar(); }
    const b = e.target.closest('[data-borrar-reg]');
    if (b && await confirmar('¿Borrar este apunte?', { detalle: 'Esa fecha volverá a aparecer como pendiente.', si: 'Borrar', peligro: true })) {
      try { await db.borrarRegistro(b.dataset.borrarReg); aviso('Apunte borrado'); cambiado = true; pintar(); } catch (err) { errorAviso(err); }
    }
  });
  pintar();
}

// ---------------------------------------------------------------------
// Marcar como pagado / hecho (también se usa desde el aviso)
// ---------------------------------------------------------------------
export function apuntarHecho(o, fechaPrevista, alHacer) {
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <div><h2 class="hoja-titulo">${verbo(o)}: ${esc(o.nombre)}</h2>
          <p class="texto-suave">Tocaba el ${esc(textoDiaLargo(fechaPrevista).toLowerCase())}</p></div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <div class="fila-2">
          <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${hoyISO()}"></label>
          <label class="campo"><span>Importe (€, opcional)</span><input name="importe" inputmode="decimal" value="${esc(coma(o.importe))}" ${o.importe ? 'autofocus' : ''}></label>
        </div>
        <label class="campo"><span>Nota (opcional)</span><input name="notas" placeholder="Ej.: nº de factura, domiciliado…"></label>
      </div>
      <footer class="hoja-pie">
        ${o.repeticion !== 'una_vez' ? '<button type="button" class="btn pie-izquierda" data-saltar>Saltar esta vez</button>' : ''}
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${verbo(o)}</button>
      </footer>
    </form>`, { ancho: 'estrecha' });
  const f = el.querySelector('form');
  const guardar = async (estado) => {
    try {
      cargando(true);
      await db.registrarObligacion({ obligacion_id: o.id, fecha_prevista: fechaPrevista, fecha: f.elements.fecha.value || hoyISO(),
        estado, importe: f.elements.importe.value, notas: f.elements.notas.value.trim() });
      aviso(estado === 'omitido' ? 'Saltado esta vez' : o.importe || f.elements.importe.value ? 'Pago apuntado' : 'Hecho');
      cerrar(); alHacer?.();
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); guardar('hecho'); });
  el.querySelector('[data-saltar]')?.addEventListener('click', () => guardar('omitido'));
}

// ---------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------
async function ficha(o, alCambiar) {
  let regs = [];
  try { regs = await db.registrosObligaciones({ obligacionId: o.id }); } catch (e) { return errorAviso(e); }
  const hoy = hoyISO();
  const proximas = o.activo === false ? [] : ocurrencias(o, hoy, sumarDias(hoy, 800)).slice(0, 3);
  const pagados = regs.filter((r) => r.estado === 'hecho' && r.importe !== null);
  const media = pagados.length ? pagados.slice(0, 6).reduce((a, r) => a + r.importe, 0) / Math.min(6, pagados.length) : null;
  const delAnio = pagados.filter((r) => r.fecha.slice(0, 4) === hoy.slice(0, 4));
  const avisoProx = proximas[0] && o.aviso_cantidad !== null ? momentoAviso(proximas[0], o.hora, o.aviso_cantidad, o.aviso_unidad) : null;
  const periodo = periodoDe(o);
  const { el, cerrar } = abrirHoja(`
    <header class="hoja-cabecera">
      <div><h2 class="hoja-titulo">${esc(o.nombre)}</h2>
        <p class="texto-suave">${[PERIODOS[periodo]?.nombre, o.proveedor].filter(Boolean).map(esc).join(' · ')}</p></div>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo">
      <dl class="cifras inv-cifras">
        <div><dt>Cuándo</dt><dd class="dd-texto">${esc(textoRepeticion(o))}</dd><small>a las ${esc(o.hora)}</small></div>
        <div><dt>Aviso</dt><dd class="dd-texto">${esc(textoAntelacion(o.aviso_cantidad, o.aviso_unidad, o.recordar).replace(/^aviso /, ''))}</dd><small>${avisoProx ? `el próximo: ${esc(new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(avisoProx))}` : '&nbsp;'}</small></div>
        ${o.importe || pagados.length ? `<div><dt>Importe</dt><dd>${o.importe ? `${euros(o.importe)}` : '—'}</dd><small>${media !== null && periodo !== 'puntual' ? `media real ${euros(media)}` : periodo === 'puntual' ? '&nbsp;' : 'aproximado'}</small></div>
        <div><dt>Pagado en ${hoy.slice(0, 4)}</dt><dd>${euros(delAnio.reduce((a, r) => a + r.importe, 0))}</dd><small>${delAnio.length} ${delAnio.length === 1 ? 'pago' : 'pagos'}</small></div>` : ''}
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
    if (e.target.closest('[data-a="editar"]')) { cerrar(); return formulario(o, periodo, alCambiar); }
    const b = e.target.closest('[data-borrar-reg]');
    if (b && await confirmar('¿Borrar este apunte?', { detalle: 'Esa fecha volverá a aparecer como pendiente.', si: 'Borrar', peligro: true })) {
      try { await db.borrarRegistro(b.dataset.borrarReg); aviso('Apunte borrado'); cerrar(); alCambiar(); } catch (err) { errorAviso(err); }
    }
  });
}

// ---------------------------------------------------------------------
// Cuándo toca: de los campos del formulario a la primera fecha
// ---------------------------------------------------------------------
const ultimoDia = (y, m) => new Date(y, m + 1, 0).getDate();
function primeraFecha(periodo, c) {
  const hoy = hoyISO();
  const h = desdeISO(hoy);
  const dia = Math.min(31, Math.max(1, Math.round(numero(c.dia)) || 1));
  if (periodo === 'puntual') return c.fecha || hoy;
  if (periodo === 'dia') return hoy;
  if (periodo === 'semana') {
    const d = new Date(h); d.setDate(d.getDate() + ((Number(c.diaSemana) - d.getDay() + 7) % 7)); return isoDe(d);
  }
  // Año, trimestre y mes: el primer mes válido desde este, con el día elegido
  for (let k = 0; k < 25; k++) {
    const y = h.getFullYear() + Math.floor((h.getMonth() + k) / 12), m = (h.getMonth() + k) % 12;
    if (periodo === 'anio' && m !== Number(c.mes)) continue;
    if (periodo === 'trimestre' && m % 3 !== Number(c.mesTrimestre)) continue;
    const f = isoDe(new Date(y, m, Math.min(dia, ultimoDia(y, m))));
    if (f >= hoy) return f;
  }
  return hoy;
}

// ---------------------------------------------------------------------
// Alta / edición
// ---------------------------------------------------------------------
function formulario(o, periodoInicial, alGuardar) {
  const nuevo = !o;
  o = o || { hora: '10:00', aviso_cantidad: 3, aviso_unidad: 'dias', recordar: 'cada_dia', activo: true };
  const ini = o.fecha_inicio ? desdeISO(o.fecha_inicio) : desdeISO(hoyISO());
  const diaElegido = o.dia || ini.getDate();
  const periodo0 = PERIODOS[periodoInicial] ? periodoInicial : 'mes';
  const sinAviso = o.aviso_cantidad === null || o.aviso_cantidad === undefined;
  const { el, cerrar } = abrirHoja(`
    <form novalidate class="form-sec">
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">${nuevo ? 'Gasto nuevo' : 'Editar'}</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <label class="campo"><span>¿Qué es?</span><input name="nombre" required value="${esc(o.nombre || '')}" placeholder="Ej.: Luz, Alquiler, Papeles al gestor" ${nuevo ? 'autofocus' : ''}></label>
        <fieldset class="campo">
          <legend>Cada cuánto</legend>
          <div class="segmentos periodos" role="radiogroup">
            ${Object.entries(PERIODOS).map(([k, p]) => `<label><input type="radio" name="periodo" value="${k}" ${k === periodo0 ? 'checked' : ''}><span>${p.nombre}</span></label>`).join('')}
          </div>
        </fieldset>
        <div class="fila-2 cuando">
          <label class="campo solo-anio"><span>Mes</span><select name="mes">${NOMBRES_MESES.map((n, i) => `<option value="${i}" ${ini.getMonth() === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="campo solo-trimestre"><span>Mes del trimestre</span><select name="mesTrimestre">
            ${['1.º (enero, abril, julio, octubre)', '2.º (febrero, mayo, agosto, noviembre)', '3.º (marzo, junio, septiembre, diciembre)'].map((t, i) => `<option value="${i}" ${(nuevo ? 0 : ini.getMonth() % 3) === i ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="campo con-dia"><span>Día del mes</span><input name="dia" type="number" min="1" max="31" inputmode="numeric" value="${diaElegido}"></label>
          <label class="campo solo-semana"><span>Día de la semana</span><select name="diaSemana">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<option value="${i}" ${ini.getDay() === i ? 'selected' : ''}>${NOMBRES_DIAS[i]}</option>`).join('')}</select></label>
          <label class="campo solo-puntual"><span>Fecha</span><input type="date" name="fecha" value="${esc(o.fecha_inicio || hoyISO())}"></label>
          <label class="campo"><span>Hora</span><input type="time" name="hora" step="300" value="${esc(o.hora || '10:00')}"></label>
        </div>
        <div class="fila-2">
          <div class="campo"><span>Avisar</span>
            <div class="aviso-cuanto">
              <label class="check-mini"><input type="checkbox" name="con_aviso" ${sinAviso ? '' : 'checked'} aria-label="Avisar"></label>
              <input name="aviso_cantidad" type="number" min="0" max="1000" inputmode="numeric" value="${esc(sinAviso ? 3 : o.aviso_cantidad)}" aria-label="Cuánto antes">
              <select name="aviso_unidad" aria-label="Unidad">${[['minutos', 'minutos'], ['horas', 'horas'], ['dias', 'días'], ['semanas', 'semanas']].map(([k, v]) => `<option value="${k}" ${o.aviso_unidad === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <span>antes</span>
            </div></div>
          <label class="campo"><span>Después del primer aviso</span>
            <select name="recordar">
              <option value="cada_dia" ${o.recordar !== 'no' ? 'selected' : ''}>Recordar cada día hasta marcarlo</option>
              <option value="no" ${o.recordar === 'no' ? 'selected' : ''}>No recordar más</option>
            </select></label>
        </div>
        <div class="fila-2">
          <label class="campo"><span>Importe (€, opcional)</span><input name="importe" inputmode="decimal" value="${esc(coma(o.importe))}"></label>
          <label class="campo"><span>A quién / empresa (opcional)</span><input name="proveedor" value="${esc(o.proveedor || '')}" placeholder="Ej.: Endesa, Gestoría"></label>
        </div>
        <label class="check ya-hecho" hidden><input type="checkbox" name="ya_hecho"> Ya está pagado o hecho</label>
        <p class="resumen-regla" aria-live="polite"></p>
        <label class="campo"><span>Notas (opcional)</span><input name="notas" value="${esc(o.notas || '')}" placeholder="Ej.: domiciliado, nº de contrato…"></label>
        ${nuevo ? '' : `<label class="check"><input type="checkbox" name="activo" ${o.activo !== false ? 'checked' : ''}> Sigue avisando</label>`}
      </div>
      <footer class="hoja-pie">
        ${nuevo ? '' : '<button type="button" class="btn btn-peligro-suave pie-izquierda" data-eliminar>Eliminar</button>'}
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${nuevo ? 'Aceptar' : 'Guardar cambios'}</button>
      </footer>
    </form>`, { ancho: 'ancha' });
  const f = el.querySelector('form');
  const E = f.elements;
  const leer = () => {
    const periodo = E.periodo.value;
    const p = PERIODOS[periodo];
    const c = { dia: E.dia.value, mes: E.mes.value, mesTrimestre: E.mesTrimestre.value, diaSemana: E.diaSemana.value, fecha: E.fecha.value };
    return {
      periodo, repeticion: p.repeticion, cada: p.cada, fecha_inicio: primeraFecha(periodo, c),
      dia: ['anio', 'trimestre', 'mes'].includes(periodo) ? Math.min(31, Math.max(1, Math.round(numero(E.dia.value)) || 1)) : null,
      hora: E.hora.value || '10:00',
      aviso_cantidad: E.con_aviso.checked ? Math.round(numero(E.aviso_cantidad.value)) : null, aviso_unidad: E.aviso_unidad.value,
      recordar: E.recordar.value,
    };
  };
  const actualizar = () => {
    const x = leer();
    f.dataset.periodo = x.periodo;
    el.querySelectorAll('.aviso-cuanto > input, .aviso-cuanto > select, .aviso-cuanto > span').forEach((n) => n.classList.toggle('apagado', !E.con_aviso.checked));
    E.recordar.disabled = !E.con_aviso.checked;
    el.querySelector('.ya-hecho').hidden = !(nuevo && x.periodo === 'puntual' && x.fecha_inicio <= hoyISO());
    el.querySelector('.resumen-regla').textContent = `${textoRepeticion(x)} a las ${x.hora} · ${textoAntelacion(x.aviso_cantidad, x.aviso_unidad, x.aviso_cantidad === null ? undefined : x.recordar)}${x.periodo !== 'puntual' ? ` · la próxima: ${textoDiaLargo(x.fecha_inicio).toLowerCase()}` : ''}`;
  };
  f.addEventListener('input', actualizar);
  f.addEventListener('change', actualizar);
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
    const x = leer();
    const datos = { id: o.id, nombre: d.nombre, importe: d.importe, proveedor: d.proveedor, notas: d.notas,
      tipo: d.importe ? 'gasto' : 'tarea', repeticion: x.repeticion, cada: x.cada, fecha_inicio: x.fecha_inicio, dia: x.dia, hora: x.hora,
      aviso_cantidad: x.aviso_cantidad, aviso_unidad: x.aviso_unidad, recordar: x.recordar, fecha_fin: o.fecha_fin || null,
      activo: nuevo ? true : d.activo };
    // Al editar sin cambiar el «cuándo», se conserva la fecha de referencia (para no perder las fechas pendientes)
    if (!nuevo && periodoDe(o) === x.periodo && x.periodo !== 'puntual') {
      const antes = primeraFecha(x.periodo, { dia: o.dia || ini.getDate(), mes: ini.getMonth(), mesTrimestre: ini.getMonth() % 3, diaSemana: ini.getDay(), fecha: o.fecha_inicio });
      if (antes === x.fecha_inicio) datos.fecha_inicio = o.fecha_inicio;
    }
    try {
      cargando(true);
      const g = await db.guardarObligacion(datos);
      if (nuevo && d.ya_hecho && x.periodo === 'puntual') {
        await db.registrarObligacion({ obligacion_id: g.id, fecha_prevista: x.fecha_inicio, fecha: x.fecha_inicio, estado: 'hecho', importe: d.importe, notas: null });
      }
      aviso('Guardado'); cerrar(); alGuardar();
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

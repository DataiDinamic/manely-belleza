// Caja del día: lo cobrado, lo pendiente de cobrar y el cierre de caja
import * as db from '../db.js';
import { esc, euros, nombreCompleto, abrirHoja, aviso, errorAviso, cargando, confirmar } from '../util.js';
import { hoyISO, sumarDias, textoDiaLargo, minutosAhora } from '../fechas.js';
import { abrirCobro, abrirDetalleCobro, METODOS, textoPagos } from '../caja.js';
import { confirmarConPin } from '../pin.js';

let fecha = hoyISO();

export async function render(el) {
  el.innerHTML = `
    <section class="caja" aria-labelledby="tituloCaja">
      <header class="barra">
        <div class="barra-nav">
          <button class="btn-icono" data-ir="-1" aria-label="Día anterior">‹</button>
          <button class="btn btn-mini" data-ir="hoy">Hoy</button>
          <button class="btn-icono" data-ir="1" aria-label="Día siguiente">›</button>
        </div>
        <h1 id="tituloCaja" class="barra-titulo">Caja · ${esc(textoDiaLargo(fecha))}</h1>
        <button class="btn btn-principal" data-venta>Nueva venta</button>
      </header>
      <div class="caja-cuerpo"><p class="cargando-texto">Cargando caja…</p></div>
    </section>`;

  el.querySelector('.barra').addEventListener('click', (e) => {
    const ir = e.target.closest('[data-ir]')?.dataset.ir;
    if (ir) { fecha = ir === 'hoy' ? hoyISO() : sumarDias(fecha, Number(ir)); render(el); }
    if (e.target.closest('[data-venta]')) abrirCobro({ fecha, alCobrar: () => render(el) });
  });

  let cobros, citas, cierre;
  try {
    [cobros, citas, cierre] = await Promise.all([db.cobrosEntre(fecha, fecha), db.citasEntre(fecha, fecha), db.cierreDe(fecha)]);
  } catch (e) {
    el.querySelector('.caja-cuerpo').innerHTML = '<div class="vacio"><p>No se pudo cargar la caja.</p></div>';
    return errorAviso(e, 'Error al cargar');
  }

  const validos = cobros.filter((c) => !c.anulado);
  const tot = { datafono: 0, efectivo: 0, bizum: 0, otro: 0 };
  for (const c of validos) for (const p of c.pagos) tot[p.metodo] = (tot[p.metodo] || 0) + Number(p.importe);
  const total = validos.reduce((a, c) => a + c.total, 0);
  const hoy = hoyISO();
  const porCobrar = citas.filter((c) => !c.cobrada && !['anulada', 'no_presentada'].includes(c.estado)
    && (fecha < hoy || (fecha === hoy && c.inicio <= minutosAhora()) || c.estado === 'realizada'));
  const masTarde = citas.filter((c) => !c.cobrada && !['anulada', 'no_presentada'].includes(c.estado) && !porCobrar.includes(c));
  const cambiosTrasCierre = cierre && (cierre.num_cobros !== validos.length || Math.abs(Number(cierre.total) - total) > 0.009);

  const zona = el.querySelector('.caja-cuerpo');
  zona.innerHTML = `
    <div class="caja-resumen">
      <div class="caja-total">
        <span>Cobrado</span>
        <strong>${euros(total)}</strong>
        <small>${validos.length} ${validos.length === 1 ? 'cobro' : 'cobros'}</small>
      </div>
      <dl class="caja-metodos">
        ${['datafono', 'efectivo', 'bizum'].map((m) => `<div class="cm-${m}"><dt>${METODOS[m]}</dt><dd>${euros(tot[m])}</dd></div>`).join('')}
        ${tot.otro ? `<div><dt>Otro</dt><dd>${euros(tot.otro)}</dd></div>` : ''}
      </dl>
    </div>

    <div class="caja-columnas">
      <div>
        ${porCobrar.length ? `
        <section class="bloque-caja">
          <h2>Por cobrar</h2>
          <ul class="lista-caja">
            ${porCobrar.map((c) => `<li class="fila-caja pendiente" style="--esmalte:${esc(c.clienta?.color || '#B5838D')}">
              <time>${c.hora}</time>
              <span><strong>${esc(nombreCompleto(c.clienta))}</strong><small>${esc(c.servicios.map((s) => s.nombre).join(', '))}</small></span>
              <b>${euros(c.total)}</b>
              <button class="btn btn-principal btn-mini" data-cobrar="${c.id}">Cobrar</button>
            </li>`).join('')}
          </ul>
        </section>` : ''}

        <section class="bloque-caja">
          <h2>Cobros</h2>
          ${cobros.length ? `<ul class="lista-caja">
            ${cobros.map((c) => `<li><button class="fila-caja ${c.anulado ? 'anulado' : ''}" data-cobro="${c.id}">
              <time>${c.hora}</time>
              <span><strong>${c.clienta ? esc(nombreCompleto(c.clienta)) : 'Venta sin clienta'}</strong>
                <small>${esc(c.lineas.map((l) => (Number(l.cantidad) !== 1 ? `${Number(l.cantidad)}× ` : '') + l.nombre).join(', '))}</small></span>
              <em class="chips">${c.anulado ? '<i class="chip chip-anulado">Anulado</i>' : c.pagos.map((p) => `<i class="chip chip-${p.metodo}">${METODOS[p.metodo]}</i>`).join('')}</em>
              <b>${euros(c.total)}</b>
            </button></li>`).join('')}
          </ul>` : '<p class="texto-suave">Todavía no hay cobros este día.</p>'}
        </section>

        ${masTarde.length ? `<p class="texto-suave">${masTarde.length} ${masTarde.length === 1 ? 'cita más tarde' : 'citas más tarde'} sin cobrar todavía.</p>` : ''}
      </div>

      <aside class="bloque-caja cierre">
        <h2>Cierre de caja</h2>
        ${cierre ? `
          <p class="cierre-estado">Caja cerrada</p>
          <dl class="datos">
            <div><dt>Efectivo esperado</dt><dd>${euros(Number(cierre.fondo_inicial) + Number(cierre.total_efectivo))}</dd></div>
            <div><dt>Efectivo contado</dt><dd>${cierre.efectivo_contado === null ? '—' : euros(cierre.efectivo_contado)}</dd></div>
            <div><dt>Diferencia</dt><dd class="${Number(cierre.diferencia) === 0 ? 'ok-texto' : 'aviso-texto'}">${cierre.diferencia === null ? '—' : (Number(cierre.diferencia) > 0 ? '+' : '') + euros(cierre.diferencia)}</dd></div>
          </dl>
          ${cierre.notas ? `<p class="detalle-notas">${esc(cierre.notas)}</p>` : ''}
          ${cambiosTrasCierre ? '<p class="aviso-texto">Hay cobros nuevos o anulados después del cierre. Vuelve a cerrar la caja.</p>' : ''}
          <div class="acciones-form">
            <button class="btn btn-mini ${cambiosTrasCierre ? 'btn-principal' : ''}" data-cerrar-caja>${cambiosTrasCierre ? 'Volver a cerrar' : 'Rehacer cierre'}</button>
            <button class="btn btn-mini btn-peligro-suave" data-reabrir>Reabrir caja</button>
          </div>` : `
          <p class="texto-suave">Al terminar el día, cuenta el efectivo de la caja y compáralo con lo cobrado.</p>
          <button class="btn btn-principal" data-cerrar-caja ${validos.length ? '' : 'disabled'}>Cerrar caja</button>`}
      </aside>
    </div>`;

  const recargar = () => render(el);
  zona.addEventListener('click', async (e) => {
    const cob = e.target.closest('[data-cobrar]');
    if (cob) {
      const cita = citas.find((c) => c.id === cob.dataset.cobrar);
      return abrirCobro({ cita, alCobrar: recargar });
    }
    const det = e.target.closest('[data-cobro]');
    if (det) return abrirDetalleCobro(det.dataset.cobro, recargar);
    if (e.target.closest('[data-cerrar-caja]')) {
      return formularioCierre({ fecha, tot, total, num: validos.length, cierre, alGuardar: recargar });
    }
    if (e.target.closest('[data-reabrir]')) {
      const ok = await confirmar('¿Reabrir la caja de este día?', { detalle: 'Se borra el recuento guardado. Los cobros no cambian.', si: 'Reabrir' });
      if (!ok) return;
      if (!(await confirmarConPin({ titulo: 'Reabrir caja', texto: 'Escribe tu PIN para confirmarlo.' }))) return;
      try { await db.reabrirCaja(fecha); aviso('Caja reabierta'); recargar(); } catch (err) { errorAviso(err); }
    }
  });
}

function formularioCierre({ fecha: dia, tot, total, num, cierre, alGuardar }) {
  const fondo = cierre ? Number(cierre.fondo_inicial) : 0;
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">Cerrar caja</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <p class="texto-suave">${esc(textoDiaLargo(dia))} · ${num} ${num === 1 ? 'cobro' : 'cobros'} · ${euros(total)}</p>
        <dl class="datos cierre-totales">
          <div><dt>Datáfono</dt><dd>${euros(tot.datafono)}</dd></div>
          <div><dt>Bizum</dt><dd>${euros(tot.bizum)}</dd></div>
          <div><dt>Efectivo cobrado</dt><dd>${euros(tot.efectivo)}</dd></div>
        </dl>
        <div class="fila-2">
          <label class="campo"><span>Fondo de caja al empezar (€)</span>
            <input name="fondo" inputmode="decimal" value="${fondo ? String(fondo).replace('.', ',') : ''}" placeholder="0"></label>
          <label class="campo"><span>Efectivo contado ahora (€)</span>
            <input name="contado" inputmode="decimal" autofocus value="${cierre?.efectivo_contado != null ? String(cierre.efectivo_contado).replace('.', ',') : ''}"></label>
        </div>
        <p class="resultado-cierre" aria-live="polite"></p>
        <label class="campo"><span>Notas (opcional)</span>
          <input name="notas" value="${esc(cierre?.notas || '')}" placeholder="Ej.: saqué 20 € para cambio"></label>
      </div>
      <footer class="hoja-pie">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">Guardar cierre</button>
      </footer>
    </form>`, { ancho: 'estrecha' });

  const f = el.querySelector('form');
  const n = (v) => Math.round((Number(String(v || '').replace(',', '.')) || 0) * 100) / 100;
  const calcular = () => {
    const esperado = n(f.elements.fondo.value) + tot.efectivo;
    const out = el.querySelector('.resultado-cierre');
    if (f.elements.contado.value === '') { out.innerHTML = `Deberías tener <strong>${euros(esperado)}</strong> en efectivo.`; return; }
    const dif = Math.round((n(f.elements.contado.value) - esperado) * 100) / 100;
    out.innerHTML = `Esperado ${euros(esperado)} · ` + (dif === 0 ? '<span class="ok-texto">La caja cuadra</span>'
      : dif > 0 ? `<span class="aviso-texto">Sobran ${euros(dif)}</span>` : `<span class="aviso-texto">Faltan ${euros(-dif)}</span>`);
  };
  f.addEventListener('input', calcular);
  calcular();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const esperado = n(f.elements.fondo.value) + tot.efectivo;
    const contado = f.elements.contado.value === '' ? null : n(f.elements.contado.value);
    try {
      cargando(true);
      await db.guardarCierre({
        fecha: dia, fondo_inicial: n(f.elements.fondo.value),
        total_datafono: tot.datafono, total_efectivo: tot.efectivo, total_bizum: tot.bizum, total_otro: tot.otro,
        total, num_cobros: num, efectivo_contado: contado,
        diferencia: contado === null ? null : Math.round((contado - esperado) * 100) / 100,
        notas: f.elements.notas.value.trim() || null,
      });
      aviso('Caja cerrada');
      cerrar();
      alGuardar();
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

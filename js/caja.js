// Cobrar (una cita o una venta suelta) y ver / anular un cobro
import * as db from './db.js';
import { esc, euros, nombreCompleto, abrirHoja, aviso, errorAviso, cargando, pedirTexto, confirmar } from './util.js';
import { hoyISO, aHora, minutosAhora, textoDiaLargo, textoFecha } from './fechas.js';
import { confirmarConPin } from './pin.js';
import { pedirDatosFactura, emitirYEntregar, hacerFactura, entregarFactura } from './factura.js';
import { abrirTPV } from './tpv.js';

export const METODOS = { datafono: 'Datáfono', efectivo: 'Efectivo', bizum: 'Bizum', otro: 'Otro' };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const numero = (v) => Number(String(v ?? '').replace(',', '.')) || 0;

export function textoPagos(pagos) {
  return pagos.map((p) => (pagos.length > 1 ? `${METODOS[p.metodo]} ${euros(p.importe)}` : METODOS[p.metodo])).join(' + ');
}

// ---------------------------------------------------------------------
// Cobrar: en pantallas anchas (tablet, ordenador) se abre el TPV de botones;
// en el móvil, el formulario.
// ---------------------------------------------------------------------
export function abrirCobro(opciones = {}) {
  if (window.matchMedia('(min-width: 700px)').matches) return abrirTPV(opciones);
  return abrirFormularioCobro(opciones);
}

// ---------------------------------------------------------------------
// Resumen antes de cobrar: Cancelar / Cobrar / Factura
// Si pedirDetalle, aquí se indica lo entregado (efectivo) o el reparto (mixto).
// Devuelve { factura: bool, pagos } o null si se cancela.
// ---------------------------------------------------------------------
export function confirmarCobro({ lineas, subtotal, descuento, total, metodo, pagos = null, pedirDetalle = false, titulo = '' }) {
  return new Promise((resolve) => {
    let hecho = false;
    const mixto = { datafono: '', efectivo: '', bizum: '' };
    let entregado = '';
    const { el, cerrar } = abrirHoja(`
      <div class="confirmar-cobro">
        <header class="hoja-cabecera">
          <div>
            <h2 class="hoja-titulo">${metodo === 'mixto' ? 'Pago mixto' : `Cobrar con ${METODOS[metodo]}`}</h2>
            ${titulo ? `<p class="texto-suave">${esc(titulo)}</p>` : ''}
          </div>
        </header>
        <div class="hoja-cuerpo">
          <ul class="detalle-servicios">
            ${lineas.map((l) => `<li><span>${Number(l.cantidad) !== 1 ? `${Number(l.cantidad)} × ` : ''}${esc(l.nombre)}</span><small>${Number(l.cantidad) !== 1 ? euros(l.precio_unit) + '/ud' : ''}</small><b>${euros(r2((Number(l.cantidad) || 1) * Number(l.precio_unit)))}</b></li>`).join('')}
            ${descuento > 0 ? `<li><span>Descuento</span><small></small><b>−${euros(descuento)}</b></li>` : ''}
          </ul>
          <div class="total-cobro"><span>Total</span><strong>${euros(total)}</strong>
            ${pagos && pagos.length > 1 ? `<small>${esc(textoPagos(pagos))}</small>` : ''}</div>
          ${pedirDetalle && metodo === 'efectivo' ? `
            <div class="zona-efectivo">
              <label class="campo"><span>Entregado (opcional, para calcular el cambio)</span>
                <input name="entregado" inputmode="decimal" placeholder="Importe que te da"></label>
              <div class="billetes">${[...new Set([total, ...[5, 10, 20, 50, 100].filter((b) => b > total).slice(0, 3)])].map((b, i) =>
                `<button type="button" class="btn btn-mini" data-billete="${b}">${i === 0 ? 'Exacto' : euros(b)}</button>`).join('')}</div>
              <p class="cambio" aria-live="polite"></p>
            </div>` : ''}
          ${pedirDetalle && metodo === 'mixto' ? `
            <div class="zona-mixto">
              <div class="fila-3">
                <label class="campo"><span>Datáfono</span><input data-mixto="datafono" inputmode="decimal" placeholder="0"></label>
                <label class="campo"><span>Efectivo</span><input data-mixto="efectivo" inputmode="decimal" placeholder="0"></label>
                <label class="campo"><span>Bizum</span><input data-mixto="bizum" inputmode="decimal" placeholder="0"></label>
              </div>
              <p class="pendiente-mixto" aria-live="polite"></p>
            </div>` : ''}
        </div>
        <footer class="hoja-pie pie-confirmar">
          <button type="button" class="btn btn-rojo" data-r="cancelar">Cancelar</button>
          <button type="button" class="btn btn-azul" data-r="factura">Factura</button>
          <button type="button" class="btn btn-verde" data-r="cobrar">Cobrar</button>
        </footer>
      </div>`, { ancho: 'normal', alCerrar: () => { if (!hecho) resolve(null); } });

    const botones = el.querySelectorAll('[data-r="factura"], [data-r="cobrar"]');
    const pagosMixto = () => Object.entries(mixto).map(([m, v]) => ({ metodo: m, importe: r2(numero(v)) })).filter((p) => p.importe > 0);
    const actualizar = () => {
      if (pedirDetalle && metodo === 'efectivo') {
        const cambio = r2(numero(entregado) - total);
        el.querySelector('.cambio').innerHTML = !entregado ? ''
          : cambio >= 0 ? `Cambio: <strong>${euros(cambio)}</strong>` : `<span class="aviso-texto">Faltan ${euros(-cambio)}</span>`;
      }
      if (pedirDetalle && metodo === 'mixto') {
        const falta = r2(total - pagosMixto().reduce((a, p) => a + p.importe, 0));
        el.querySelector('.pendiente-mixto').innerHTML = Math.abs(falta) < 0.01 ? '<span class="ok-texto">Cuadra con el total</span>'
          : falta > 0 ? `Faltan <strong>${euros(falta)}</strong>` : `<span class="aviso-texto">Te pasas ${euros(-falta)}</span>`;
        botones.forEach((b) => { b.disabled = Math.abs(falta) >= 0.01; });
      }
    };
    el.querySelector('[name=entregado]')?.addEventListener('input', (e) => { entregado = e.target.value; actualizar(); });
    el.querySelector('.billetes')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-billete]'); if (!b) return;
      entregado = b.dataset.billete; el.querySelector('[name=entregado]').value = String(entregado).replace('.', ','); actualizar();
    });
    el.querySelectorAll('[data-mixto]').forEach((i) => i.addEventListener('input', () => { mixto[i.dataset.mixto] = i.value; actualizar(); }));
    actualizar();
    if (pedirDetalle && metodo === 'mixto') setTimeout(() => el.querySelector('[data-mixto]')?.focus(), 80);

    el.querySelector('.pie-confirmar').addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (!r) return;
      if (r === 'cancelar') { cerrar(); return; }
      let p = pagos;
      if (!p) p = metodo === 'mixto' ? pagosMixto() : [{ metodo, importe: total }];
      if (!p.length) p = [{ metodo: 'otro', importe: 0 }];
      hecho = true;
      resolve({ factura: r === 'factura', pagos: p });
      cerrar();
    });
  });
}

// Registrar el cobro (y la factura si se pidió). Devuelve el id o null.
export async function finalizarCobro({ cobro, lineas, pagos, factura = false, alCobrar }) {
  let datosFactura = null;
  if (factura) {
    const n = db.negocioActual();
    if (!n?.nif || !(n.razon_social || n.nombre)) {
      const ok = await confirmar('Faltan los datos fiscales del centro', {
        detalle: 'Para hacer facturas hay que poner el titular y el NIF en Ajustes → Datos del centro. ¿Cobrar ahora sin factura? Podrás hacerla después desde el cobro.',
        si: 'Cobrar sin factura', no: 'Cancelar',
      });
      if (!ok) return null;
      factura = false;
    }
  }
  if (factura) {
    datosFactura = await pedirDatosFactura(cobro.clienta_id);
    if (!datosFactura) return null;   // canceló: no se cobra todavía
  }
  let id;
  try {
    cargando(true);
    id = await db.registrarCobro(cobro, lineas, pagos);
    const total = r2(pagos.reduce((a, p) => a + Number(p.importe), 0));
    aviso(`Cobrado ${euros(total)} · ${textoPagos(pagos)}`);
  } catch (err) { errorAviso(err, 'No se pudo cobrar'); return null; }
  finally { cargando(false); }
  if (datosFactura) await emitirYEntregar(id, datosFactura);
  alCobrar?.(id, cobro);
  return id;
}

// ---------------------------------------------------------------------
// Formulario de cobro (móvil)
// ---------------------------------------------------------------------
async function abrirFormularioCobro({ cita = null, fecha = null, alCobrar } = {}) {
  cargando(true);
  let servicios, productos, clientas;
  try {
    [servicios, productos, clientas] = await Promise.all([db.listarServicios(), db.listarProductos(), cita ? [] : db.listarClientas()]);
  } catch (e) { cargando(false); return errorAviso(e, 'No se pudieron cargar los datos'); }
  cargando(false);

  const hoy = hoyISO();
  const st = {
    clientaId: cita?.clienta_id || '',
    lineas: cita ? cita.servicios.map((s) => ({
      tipo: 'servicio', servicio_id: s.servicio_id, producto_id: null, nombre: s.nombre,
      cantidad: 1, precio_unit: Number(s.precio), iva_pct: Number(s.iva_pct ?? 21),
    })) : [],
    descuento: 0, descTipo: 'eur',
    metodo: null,               // datafono | efectivo | bizum | mixto
    mixto: { datafono: '', efectivo: '', bizum: '' },
    entregado: '',
  };
  // Fecha del cobro: la de la cita si ya pasó, si no, hoy
  const fechaCobro = fecha || (cita && cita.fecha <= hoy ? cita.fecha : hoy);
  const horaCobro = fechaCobro === hoy ? aHora(minutosAhora()) : (cita ? aHora(cita.fin) : '12:00');

  const opcionesServicio = servicios.map((s) => `<option value="${s.id}">${esc(s.nombre)} · ${euros(s.precio)}</option>`).join('');
  const opcionesProducto = productos.map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.marca ? ' · ' + esc(p.marca) : ''} · ${euros(p.precio)}${p.stock !== null && p.stock !== undefined ? ` · quedan ${p.stock}` : ''}</option>`).join('');

  const { el, cerrar } = abrirHoja(`
    <form class="form-cobro" novalidate>
      <header class="hoja-cabecera">
        <div>
          <h2 class="hoja-titulo">${cita ? 'Cobrar cita' : 'Nueva venta'}</h2>
          ${cita ? `<p class="texto-suave">${esc(nombreCompleto(cita.clienta))} · ${esc(textoDiaLargo(cita.fecha))} · ${cita.hora}</p>` : ''}
        </div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        ${cita ? '' : `
        <label class="campo"><span>Clienta (opcional)</span>
          <select name="clienta"><option value="">Sin clienta</option>
            ${clientas.map((c) => `<option value="${c.id}">${esc(nombreCompleto(c))}</option>`).join('')}</select></label>`}

        <div class="campo">
          <span>Conceptos</span>
          <ul class="lineas lineas-cobro"></ul>
          <div class="anadir-conceptos">
            ${servicios.length ? `<select data-anadir="servicio" aria-label="Añadir servicio"><option value="">+ Servicio…</option>${opcionesServicio}</select>` : ''}
            ${productos.length ? `<select data-anadir="producto" aria-label="Añadir producto"><option value="">+ Producto…</option>${opcionesProducto}</select>` : ''}
            <button type="button" class="btn btn-mini" data-anadir-otro>+ Otro concepto</button>
          </div>
        </div>

        <div class="fila-descuento">
          <label class="campo"><span>Descuento</span>
            <input name="descuento" inputmode="decimal" placeholder="0"></label>
          <div class="segmentos" role="group" aria-label="Tipo de descuento">
            <button type="button" data-desc="eur" aria-pressed="true">€</button>
            <button type="button" data-desc="pct" aria-pressed="false">%</button>
          </div>
        </div>

        <div class="total-cobro" aria-live="polite">
          <span>Total</span><strong data-total>0,00 €</strong>
          <small data-desglose></small>
        </div>

        <fieldset class="campo">
          <legend>¿Cómo paga?</legend>
          <div class="metodos">
            <button type="button" data-metodo="datafono"><span class="m-icono" aria-hidden="true">▭</span>Datáfono</button>
            <button type="button" data-metodo="efectivo"><span class="m-icono" aria-hidden="true">€</span>Efectivo</button>
            <button type="button" data-metodo="bizum"><span class="m-icono" aria-hidden="true">↔</span>Bizum</button>
            <button type="button" data-metodo="mixto"><span class="m-icono" aria-hidden="true">½</span>Mixto</button>
          </div>
        </fieldset>
        <div class="zona-efectivo" hidden>
          <label class="campo"><span>Entregado</span>
            <input name="entregado" inputmode="decimal" placeholder="Importe que te da"></label>
          <div class="billetes"></div>
          <p class="cambio" aria-live="polite"></p>
        </div>
        <div class="zona-mixto" hidden>
          <div class="fila-3">
            <label class="campo"><span>Datáfono</span><input data-mixto="datafono" inputmode="decimal" placeholder="0"></label>
            <label class="campo"><span>Efectivo</span><input data-mixto="efectivo" inputmode="decimal" placeholder="0"></label>
            <label class="campo"><span>Bizum</span><input data-mixto="bizum" inputmode="decimal" placeholder="0"></label>
          </div>
          <p class="pendiente-mixto" aria-live="polite"></p>
        </div>

        <details class="plegable">
          <summary>Fecha, hora y notas del cobro</summary>
          <div class="fila-2">
            <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${fechaCobro}"></label>
            <label class="campo"><span>Hora</span><input type="time" name="hora" value="${horaCobro}"></label>
          </div>
          <label class="campo"><span>Notas</span><input name="notas" placeholder="Opcional"></label>
        </details>
      </div>
      <footer class="hoja-pie">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal btn-cobrar" disabled>Cobrar</button>
      </footer>
    </form>`, { ancho: 'ancha' });

  const form = el.querySelector('form');
  const ul = el.querySelector('.lineas-cobro');
  const btnCobrar = el.querySelector('.btn-cobrar');

  const subtotal = () => r2(st.lineas.reduce((a, l) => a + r2((numero(l.cantidad) || 1) * numero(l.precio_unit)), 0));
  const descuentoEur = () => {
    const sub = subtotal();
    const d = st.descTipo === 'pct' ? r2(sub * Math.min(100, numero(st.descuento)) / 100) : r2(numero(st.descuento));
    return Math.min(Math.max(d, 0), sub);
  };
  const total = () => r2(subtotal() - descuentoEur());

  function pintarLineas() {
    ul.innerHTML = st.lineas.map((l, i) => {
      const prod = l.producto_id ? productos.find((p) => p.id === l.producto_id) : null;
      const poco = prod && prod.stock !== null && prod.stock !== undefined && numero(l.cantidad) > prod.stock;
      return `<li class="linea linea-cobro">
        <input class="linea-nombre" data-i="${i}" data-k="nombre" value="${esc(l.nombre)}" aria-label="Concepto">
        <label class="linea-num"><input type="number" data-i="${i}" data-k="cantidad" value="${l.cantidad}" min="1" step="1" inputmode="numeric" aria-label="Cantidad"><span>ud</span></label>
        <label class="linea-num"><input data-i="${i}" data-k="precio_unit" value="${l.precio_unit}" inputmode="decimal" aria-label="Precio"><span>€</span></label>
        <button type="button" class="btn-icono" data-quitar="${i}" aria-label="Quitar ${esc(l.nombre)}">✕</button>
        ${poco ? `<p class="aviso-stock">Solo quedan ${prod.stock} en stock</p>` : ''}
      </li>`;
    }).join('') || '<li class="vacio-lineas">Añade lo que se cobra: servicios, productos u otro concepto.</li>';
    actualizar();
  }

  function actualizar() {
    const t = total();
    el.querySelector('[data-total]').textContent = euros(t);
    const d = descuentoEur();
    el.querySelector('[data-desglose]').textContent = d > 0 ? `${euros(subtotal())} − ${euros(d)} de descuento` : '';
    el.querySelectorAll('[data-metodo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metodo === st.metodo)));
    el.querySelector('.zona-efectivo').hidden = st.metodo !== 'efectivo';
    el.querySelector('.zona-mixto').hidden = st.metodo !== 'mixto';

    if (st.metodo === 'efectivo') {
      const opciones = [...new Set([t, ...[5, 10, 20, 50, 100].filter((b) => b > t).slice(0, 3)])];
      el.querySelector('.billetes').innerHTML = opciones.map((b, i) =>
        `<button type="button" class="btn btn-mini" data-billete="${b}">${i === 0 ? 'Exacto' : euros(b)}</button>`).join('');
      const ent = numero(st.entregado);
      const cambio = r2(ent - t);
      el.querySelector('.cambio').innerHTML = !st.entregado ? ''
        : cambio >= 0 ? `Cambio: <strong>${euros(cambio)}</strong>` : `<span class="aviso-texto">Faltan ${euros(-cambio)}</span>`;
    }
    let listo = st.lineas.length > 0 && !!st.metodo && t >= 0;
    if (st.metodo === 'mixto') {
      const suma = r2(Object.values(st.mixto).reduce((a, v) => a + numero(v), 0));
      const falta = r2(t - suma);
      el.querySelector('.pendiente-mixto').innerHTML = Math.abs(falta) < 0.01 ? '<span class="ok-texto">Cuadra con el total</span>'
        : falta > 0 ? `Faltan <strong>${euros(falta)}</strong>` : `<span class="aviso-texto">Te pasas ${euros(-falta)}</span>`;
      listo = listo && Math.abs(falta) < 0.01;
    }
    btnCobrar.disabled = !listo;
    btnCobrar.textContent = st.metodo ? `Cobrar ${euros(t)}` : 'Elige cómo paga';
  }

  // Añadir conceptos
  el.querySelectorAll('[data-anadir]').forEach((sel) => sel.addEventListener('change', () => {
    const id = sel.value; sel.value = '';
    if (!id) return;
    if (sel.dataset.anadir === 'servicio') {
      const s = servicios.find((x) => x.id === id);
      st.lineas.push({ tipo: 'servicio', servicio_id: s.id, producto_id: null, nombre: s.nombre, cantidad: 1, precio_unit: Number(s.precio), iva_pct: Number(s.iva_pct ?? 21) });
    } else {
      const ya = st.lineas.find((l) => l.producto_id === id);
      if (ya) ya.cantidad = numero(ya.cantidad) + 1;
      else {
        const p = productos.find((x) => x.id === id);
        st.lineas.push({ tipo: 'producto', servicio_id: null, producto_id: p.id, nombre: p.marca ? `${p.nombre} (${p.marca})` : p.nombre, cantidad: 1, precio_unit: Number(p.precio), iva_pct: Number(p.iva_pct ?? 21) });
      }
    }
    pintarLineas();
  }));
  el.querySelector('[data-anadir-otro]').addEventListener('click', () => {
    st.lineas.push({ tipo: 'otro', servicio_id: null, producto_id: null, nombre: '', cantidad: 1, precio_unit: 0, iva_pct: 21 });
    pintarLineas();
    ul.querySelector('.linea:last-child .linea-nombre')?.focus();
  });
  ul.addEventListener('input', (e) => {
    const i = e.target.dataset.i;
    if (i == null) return;
    st.lineas[i][e.target.dataset.k] = e.target.value;
    actualizar();
  });
  // Al cambiar una cantidad se repinta (para el aviso de stock), pero fuera del evento
  // para no borrar el campo mientras el navegador aún lo está procesando
  ul.addEventListener('change', (e) => { if (e.target.dataset.k === 'cantidad') setTimeout(pintarLineas, 0); });
  ul.addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (b) { st.lineas.splice(Number(b.dataset.quitar), 1); pintarLineas(); }
  });

  // Descuento
  form.elements.descuento.addEventListener('input', (e) => { st.descuento = e.target.value; actualizar(); });
  el.querySelectorAll('[data-desc]').forEach((b) => b.addEventListener('click', () => {
    st.descTipo = b.dataset.desc;
    el.querySelectorAll('[data-desc]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    actualizar();
  }));

  // Forma de pago
  el.querySelector('.metodos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metodo]');
    if (!b) return;
    st.metodo = b.dataset.metodo;
    actualizar();
    if (st.metodo === 'efectivo') form.elements.entregado.focus();
    if (st.metodo === 'mixto') el.querySelector('[data-mixto="datafono"]').focus();
  });
  form.elements.entregado.addEventListener('input', (e) => { st.entregado = e.target.value; actualizar(); });
  el.querySelector('.billetes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-billete]');
    if (!b) return;
    st.entregado = b.dataset.billete;
    form.elements.entregado.value = String(b.dataset.billete).replace('.', ',');
    actualizar();
  });
  el.querySelectorAll('[data-mixto]').forEach((inp) => inp.addEventListener('input', () => {
    st.mixto[inp.dataset.mixto] = inp.value; actualizar();
  }));

  pintarLineas();

  // Cobrar
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lineas = st.lineas.map((l) => ({ ...l, nombre: String(l.nombre).trim(), cantidad: numero(l.cantidad) || 1, precio_unit: r2(numero(l.precio_unit)) }));
    if (!lineas.length) return aviso('Añade al menos un concepto.', 'error');
    if (lineas.some((l) => !l.nombre)) return aviso('Escribe el nombre de cada concepto.', 'error');
    if (!st.metodo) return aviso('Elige cómo paga.', 'error');
    const t = total();
    const pagos = st.metodo === 'mixto'
      ? Object.entries(st.mixto).map(([metodo, v]) => ({ metodo, importe: r2(numero(v)) })).filter((p) => p.importe > 0)
      : [{ metodo: st.metodo, importe: t }];
    if (t === 0 && !pagos.length) pagos.push({ metodo: 'otro', importe: 0 });
    const cobro = {
      fecha: form.elements.fecha.value || hoy,
      hora: form.elements.hora.value || aHora(minutosAhora()),
      cita_id: cita?.id || null,
      clienta_id: cita?.clienta_id || form.elements.clienta?.value || null,
      descuento: descuentoEur(),
      notas: form.elements.notas.value.trim(),
    };
    const decision = await confirmarCobro({
      lineas, subtotal: subtotal(), descuento: descuentoEur(), total: t, metodo: st.metodo, pagos,
      titulo: cita ? nombreCompleto(cita.clienta) : '',
    });
    if (!decision) return;
    const id = await finalizarCobro({ cobro, lineas, pagos, factura: decision.factura, alCobrar });
    if (id) cerrar();
  });
}

// ---------------------------------------------------------------------
// Detalle de un cobro
// ---------------------------------------------------------------------
export async function abrirDetalleCobro(id, alCambiar) {
  let c, factura = null;
  try { c = await db.obtenerCobro(id); } catch (e) { return errorAviso(e, 'No se pudo abrir el cobro'); }
  try { factura = await db.facturaDeCobro(id); } catch { /* sin factura */ }
  const { el, cerrar } = abrirHoja(`
    <header class="hoja-cabecera">
      <div>
        <p class="detalle-cuando">${esc(textoDiaLargo(c.fecha))} · ${c.hora}</p>
        <h2 class="hoja-titulo">${c.clienta ? `<a href="#clientas/${c.clienta.id}" data-cerrar>${esc(nombreCompleto(c.clienta))}</a>` : (c.cita_id ? 'Cobro de cita' : 'Venta')}</h2>
        ${c.anulado ? '<span class="estado estado-anulada">Anulado</span>' : '<span class="estado estado-realizada">Cobrado</span>'}
      </div>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo">
      <ul class="detalle-servicios">
        ${c.lineas.map((l) => `<li><span>${esc(l.nombre)}</span><small>${Number(l.cantidad) !== 1 ? `${Number(l.cantidad)} × ${euros(l.precio_unit)}` : ''}</small><b>${euros(l.importe)}</b></li>`).join('')}
        ${c.descuento > 0 ? `<li><span>Descuento</span><small></small><b>−${euros(c.descuento)}</b></li>` : ''}
        <li class="total"><span>Total</span><small></small><b>${euros(c.total)}</b></li>
      </ul>
      <p><strong>Pago:</strong> ${esc(textoPagos(c.pagos)) || '—'}</p>
      ${c.notas ? `<p class="detalle-notas"><strong>Notas:</strong> ${esc(c.notas)}</p>` : ''}
      ${factura ? `<button class="cobro-hecho factura-hecha" data-ver-factura>
        <span>Factura <strong>${esc(factura.codigo)}</strong> · ${factura.tipo === 'completa' ? esc(factura.receptor?.nombre || '') : 'simplificada'}</span><em>PDF ›</em></button>` : ''}
      ${c.anulado ? `<p class="detalle-notas aviso-texto">Anulado${c.anulado_en ? ' el ' + esc(textoFecha(c.anulado_en.slice(0, 10))) : ''}${c.motivo_anulacion ? `: ${esc(c.motivo_anulacion)}` : ''}</p>` : ''}
    </div>
    ${c.anulado ? '' : `<footer class="hoja-pie acciones-cita">
      ${factura ? '' : '<button class="btn btn-azul" data-facturar>Hacer factura</button>'}
      <button class="btn btn-peligro-suave" data-anular>Anular cobro</button>
    </footer>`}`);

  el.querySelector('[data-ver-factura]')?.addEventListener('click', () => entregarFactura(factura));
  el.querySelector('[data-facturar]')?.addEventListener('click', async () => {
    cerrar();
    await hacerFactura(c.id, c.clienta_id);
    alCambiar?.();
  });

  el.querySelector('[data-anular]')?.addEventListener('click', async () => {
    if (factura) return aviso(`Este cobro tiene la factura ${factura.codigo}. Para anularlo hará falta una factura rectificativa (aún no disponible): consúltalo con el gestor.`, 'error');
    const motivo = await pedirTexto('Anular este cobro', { etiqueta: '¿Por qué se anula? (p. ej. «me equivoqué de forma de pago»)', boton: 'Continuar', peligro: true });
    if (motivo === null) return;
    const ok = await confirmarConPin({ titulo: 'Anular cobro', texto: `El cobro de ${euros(c.total)} quedará anulado y no contará en la caja. Escribe tu PIN para confirmarlo.` });
    if (!ok) return;
    try {
      cargando(true);
      await db.anularCobro(c.id, motivo);
      aviso('Cobro anulado');
      cerrar();
      alCambiar?.();
    } catch (err) { errorAviso(err, 'No se pudo anular'); } finally { cargando(false); }
  });
}

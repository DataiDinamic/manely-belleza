// TPV de botones (tablet / ordenador): ticket a la izquierda, categorías y
// tratamientos en el centro, teclado numérico a la derecha y formas de pago abajo.
import * as db from './db.js';
import { esc, euros, nombreCompleto, aviso, errorAviso, cargando, confirmar } from './util.js';
import { hoyISO, aHora, minutosAhora, textoDiaLargo, duracionTexto } from './fechas.js';
import { confirmarCobro, finalizarCobro, METODOS } from './caja.js';

const TINTES = ['#EADCF8', '#F9DCE7', '#D9EFE4', '#FBE6CC', '#DCE7F8', '#F0E0D2', '#E6E6F2', '#F5E6F0'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function abrirTPV({ cita = null, fecha = null, alCobrar } = {}) {
  cargando(true);
  let servicios, productos, clientas;
  try {
    [servicios, productos, clientas] = await Promise.all([db.listarServicios(), db.listarProductos(), cita ? [] : db.listarClientas()]);
  } catch (e) { cargando(false); return errorAviso(e, 'No se pudo abrir la caja'); }
  cargando(false);

  // Categorías: las de servicios y productos, en ese orden
  const categorias = [];
  const porNombre = {};
  const meter = (cat, item) => {
    const n = cat || 'Otros';
    if (!porNombre[n]) { porNombre[n] = { nombre: n, items: [], tinte: TINTES[categorias.length % TINTES.length] }; categorias.push(porNombre[n]); }
    porNombre[n].items.push(item);
  };
  servicios.forEach((s) => meter(s.categoria, { tipo: 'servicio', ...s }));
  productos.forEach((p) => meter(p.categoria, { tipo: 'producto', ...p }));

  const hoy = hoyISO();
  const st = {
    lineas: cita ? cita.servicios.map((s) => ({
      tipo: 'servicio', servicio_id: s.servicio_id, producto_id: null, nombre: s.nombre,
      cantidad: 1, precio_unit: Number(s.precio), iva_pct: Number(s.iva_pct ?? 21),
    })) : [],
    descuento: '', descTipo: 'eur',
    categoria: null,
    entrada: '',
    clientaId: cita?.clienta_id || '',
  };
  const fechaCobro = fecha || (cita && cita.fecha <= hoy ? cita.fecha : hoy);
  const horaCobro = () => (fechaCobro === hoy ? aHora(minutosAhora()) : (cita ? aHora(cita.fin) : '12:00'));

  const raiz = document.createElement('div');
  raiz.className = 'tpv';
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'true');
  raiz.setAttribute('aria-label', cita ? 'Cobrar cita' : 'Nueva venta');
  raiz.innerHTML = `
    <header class="tpv-cab">
      <button type="button" class="btn tpv-salir" data-salir>✕ Salir</button>
      <div class="tpv-titulo">
        <strong>${cita ? 'Cobrar cita' : 'Nueva venta'}</strong>
        <span>${cita ? `${esc(nombreCompleto(cita.clienta))} · ${cita.hora}` : esc(textoDiaLargo(fechaCobro))}</span>
      </div>
      ${cita ? '' : `<label class="tpv-clienta"><span class="sr">Clienta</span>
        <select data-clienta><option value="">Sin clienta</option>
          ${clientas.map((c) => `<option value="${c.id}">${esc(nombreCompleto(c))}</option>`).join('')}</select></label>`}
    </header>

    <section class="tpv-ticket" aria-label="Ticket">
      <div class="ticket-cab"><h2>Ticket</h2><button type="button" class="btn btn-mini" data-vaciar>Vaciar</button></div>
      <ul class="ticket-lineas"></ul>
      <div class="ticket-pie">
        <div class="ticket-desc">
          <label><span>Descuento</span><input data-descuento inputmode="decimal" placeholder="0"></label>
          <div class="segmentos" role="group" aria-label="Tipo de descuento">
            <button type="button" data-desc="eur" aria-pressed="true">€</button>
            <button type="button" data-desc="pct" aria-pressed="false">%</button>
          </div>
        </div>
        <p class="ticket-suma" aria-live="polite"></p>
      </div>
    </section>

    <section class="tpv-catalogo" aria-label="Tratamientos y productos">
      <div class="cat-cab"></div>
      <div class="cat-rejilla"></div>
    </section>

    <section class="tpv-teclado" aria-label="Teclado">
      <output class="tecl-pantalla" aria-live="polite">0 €</output>
      <p class="tecl-ayuda">Escribe un importe y pulsa <b>+</b> para añadirlo o <b>−</b> para descontarlo. Para cambiar un precio, escríbelo y toca el precio de la línea.</p>
      <div class="teclas">
        ${['7', '8', '9'].map((n) => `<button type="button" data-tecla="${n}">${n}</button>`).join('')}
        <button type="button" class="t-sec" data-tecla="C" aria-label="Borrar importe">C</button>
        ${['4', '5', '6'].map((n) => `<button type="button" data-tecla="${n}">${n}</button>`).join('')}
        <button type="button" class="t-menos" data-tecla="-" aria-label="Restar como descuento">−</button>
        ${['1', '2', '3'].map((n) => `<button type="button" data-tecla="${n}">${n}</button>`).join('')}
        <button type="button" class="t-mas" data-tecla="+" aria-label="Añadir al ticket">+</button>
        <button type="button" data-tecla="0">0</button>
        <button type="button" data-tecla=",">,</button>
        <button type="button" class="t-sec" data-tecla="B" aria-label="Borrar un número">⌫</button>
      </div>
    </section>

    <footer class="tpv-pagos">
      <div class="pagos-botones">
        <button type="button" data-pagar="datafono"><span aria-hidden="true">▭</span>Datáfono</button>
        <button type="button" data-pagar="efectivo"><span aria-hidden="true">€</span>Efectivo</button>
        <button type="button" data-pagar="bizum"><span aria-hidden="true">↔</span>Bizum</button>
        <button type="button" data-pagar="mixto"><span aria-hidden="true">½</span>Mixto</button>
      </div>
      <div class="tpv-total"><span>Total</span><strong data-total>0,00 €</strong></div>
    </footer>`;
  document.body.appendChild(raiz);
  document.body.classList.add('con-tpv');

  const $ = (sel) => raiz.querySelector(sel);
  const subtotal = () => r2(st.lineas.reduce((a, l) => a + r2(l.cantidad * l.precio_unit), 0));
  const descuentoEur = () => {
    const sub = subtotal();
    const v = Number(String(st.descuento).replace(',', '.')) || 0;
    const d = st.descTipo === 'pct' ? r2(sub * Math.min(100, v) / 100) : r2(v);
    return Math.min(Math.max(d, 0), sub);
  };
  const total = () => r2(subtotal() - descuentoEur());
  const valorEntrada = () => Number(st.entrada.replace(',', '.')) || 0;

  // ---------- Pintado ----------
  function pintarTicket(destacar = -1) {
    $('.ticket-lineas').innerHTML = st.lineas.map((l, i) => `
      <li class="ticket-linea ${i === destacar ? 'recien' : ''}">
        <span class="tl-nombre">${l.tipo === 'otro'
          ? `<input data-nombre="${i}" value="${esc(l.nombre)}" aria-label="Nombre del concepto">`
          : esc(l.nombre)}</span>
        <div class="tl-cant">
          <button type="button" data-menos="${i}" aria-label="Uno menos">−</button>
          <b>${l.cantidad}</b>
          <button type="button" data-mas="${i}" aria-label="Uno más">+</button>
        </div>
        <button type="button" class="tl-precio" data-precio="${i}" aria-label="Precio ${euros(l.precio_unit)}. Escribe otro en el teclado y toca aquí para cambiarlo">${euros(r2(l.cantidad * l.precio_unit))}</button>
        <button type="button" class="tl-quitar" data-quitar="${i}" aria-label="Quitar ${esc(l.nombre)}">✕</button>
      </li>`).join('') || '<li class="ticket-vacio">Toca los tratamientos o productos para añadirlos.</li>';
    if (destacar >= 0) $('.ticket-lineas').children[destacar]?.scrollIntoView({ block: 'nearest' });
    totales();
    pintarCatalogo();
  }

  function totales() {
    const d = descuentoEur();
    $('.ticket-suma').innerHTML = st.lineas.length
      ? `${st.lineas.reduce((a, l) => a + l.cantidad, 0)} conceptos · ${euros(subtotal())}${d > 0 ? ` · <span class="ok-texto">−${euros(d)}</span>` : ''}`
      : '';
    $('[data-total]').textContent = euros(total());
    raiz.querySelectorAll('[data-pagar]').forEach((b) => { b.disabled = !st.lineas.length; });
    raiz.querySelectorAll('[data-desc]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.desc === st.descTipo)));
  }

  function enTicket(item) {
    return st.lineas.filter((l) => (item.tipo === 'servicio' ? l.servicio_id === item.id : l.producto_id === item.id))
      .reduce((a, l) => a + l.cantidad, 0);
  }

  function pintarCatalogo() {
    const cab = $('.cat-cab');
    const rej = $('.cat-rejilla');
    if (!st.categoria) {
      cab.innerHTML = '<h2>Categorías</h2>';
      rej.className = 'cat-rejilla rejilla-categorias';
      rej.innerHTML = categorias.length ? categorias.map((c, i) => {
        const n = c.items.reduce((a, it) => a + enTicket(it), 0);
        return `<button type="button" class="tile tile-cat" style="--tinte:${c.tinte}" data-cat="${i}">
          <strong>${esc(c.nombre)}</strong><small>${c.items.length} ${c.items.length === 1 ? 'opción' : 'opciones'}</small>
          ${n ? `<i class="tile-cuenta">${n}</i>` : ''}</button>`;
      }).join('') : '<p class="texto-suave">Crea servicios y productos en el Catálogo, con su categoría, y aparecerán aquí como botones. Mientras, puedes cobrar escribiendo el importe en el teclado.</p>';
      return;
    }
    const c = categorias[st.categoria];
    cab.innerHTML = `<button type="button" class="btn btn-atras" data-atras>‹ Categorías</button><h2>${esc(c.nombre)}</h2>`;
    rej.className = 'cat-rejilla rejilla-items';
    rej.innerHTML = c.items.map((it, i) => {
      const n = enTicket(it);
      const sub = it.tipo === 'servicio' ? duracionTexto(it.duracion_min)
        : [it.marca, it.stock !== null && it.stock !== undefined ? (it.stock <= 0 ? 'Agotado' : `Quedan ${it.stock}`) : ''].filter(Boolean).join(' · ');
      const agotado = it.tipo === 'producto' && it.stock !== null && it.stock !== undefined && it.stock - n <= 0;
      return `<button type="button" class="tile tile-item ${agotado ? 'agotado' : ''}" style="--tinte:${c.tinte}" data-item="${i}">
        <strong>${esc(it.nombre)}</strong><small>${esc(sub)}</small><b>${euros(it.precio)}</b>
        ${n ? `<i class="tile-cuenta">${n}</i>` : ''}</button>`;
    }).join('');
  }

  function pintarEntrada() {
    $('.tecl-pantalla').textContent = st.entrada ? `${st.entrada} €` : '0 €';
    $('.tecl-pantalla').classList.toggle('con-valor', !!st.entrada);
  }

  // ---------- Acciones ----------
  function anadir(item) {
    const i = st.lineas.findIndex((l) => (item.tipo === 'servicio' ? l.servicio_id === item.id : l.producto_id === item.id));
    if (i >= 0) { st.lineas[i].cantidad += 1; pintarTicket(i); return; }
    st.lineas.push({
      tipo: item.tipo, servicio_id: item.tipo === 'servicio' ? item.id : null, producto_id: item.tipo === 'producto' ? item.id : null,
      nombre: item.tipo === 'producto' && item.marca ? `${item.nombre} (${item.marca})` : item.nombre,
      cantidad: 1, precio_unit: Number(item.precio), iva_pct: Number(item.iva_pct ?? 21),
    });
    pintarTicket(st.lineas.length - 1);
  }

  function tecla(t) {
    if (/^\d$/.test(t)) {
      const [ent, dec] = st.entrada.split(',');
      if (dec !== undefined && dec.length >= 2) return;
      if (dec === undefined && ent.length >= 5) return;
      st.entrada = (st.entrada === '0' ? '' : st.entrada) + t;
    } else if (t === ',') {
      if (!st.entrada.includes(',')) st.entrada = (st.entrada || '0') + ',';
    } else if (t === 'B') {
      st.entrada = st.entrada.slice(0, -1);
    } else if (t === 'C') {
      st.entrada = '';
    } else if (t === '+') {
      const v = valorEntrada();
      if (v > 0) {
        st.lineas.push({ tipo: 'otro', servicio_id: null, producto_id: null, nombre: 'Importe manual', cantidad: 1, precio_unit: r2(v), iva_pct: 21 });
        st.entrada = '';
        pintarTicket(st.lineas.length - 1);
      } else if (st.lineas.length) { st.lineas.at(-1).cantidad += 1; pintarTicket(st.lineas.length - 1); }
    } else if (t === '-') {
      const v = valorEntrada();
      if (v > 0) {
        const actual = st.descTipo === 'eur' ? Number(String(st.descuento).replace(',', '.')) || 0 : descuentoEur();
        st.descTipo = 'eur';
        st.descuento = String(r2(actual + v)).replace('.', ',');
        $('[data-descuento]').value = st.descuento;
        st.entrada = '';
        totales();
      } else if (st.lineas.length) {
        const l = st.lineas.at(-1);
        l.cantidad -= 1;
        if (l.cantidad <= 0) st.lineas.pop();
        pintarTicket(st.lineas.length - 1);
      }
    }
    pintarEntrada();
  }

  async function salir(forzar = false) {
    if (!forzar && st.lineas.length) {
      const ok = await confirmar('¿Salir sin cobrar?', { detalle: 'Se perderá el ticket que estás preparando.', si: 'Salir', peligro: true });
      if (!ok) return;
    }
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('con-tpv');
    raiz.remove();
  }

  async function pagar(metodo) {
    if (!st.lineas.length) return;
    const lineas = st.lineas.map((l) => ({ ...l, nombre: String(l.nombre).trim() || 'Concepto' }));
    const t = total();
    const decision = await confirmarCobro({
      lineas, subtotal: subtotal(), descuento: descuentoEur(), total: t, metodo, pedirDetalle: true,
      titulo: cita ? nombreCompleto(cita.clienta) : (clientas.find((c) => c.id === st.clientaId) ? nombreCompleto(clientas.find((c) => c.id === st.clientaId)) : ''),
    });
    if (!decision) return;
    const cobro = {
      fecha: fechaCobro, hora: horaCobro(), cita_id: cita?.id || null,
      clienta_id: st.clientaId || null, descuento: descuentoEur(), notas: '',
    };
    const id = await finalizarCobro({ cobro, lineas, pagos: decision.pagos, factura: decision.factura, alCobrar });
    if (id) salir(true);
  }

  // ---------- Eventos ----------
  raiz.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.salir !== undefined) return salir();
    if (b.dataset.cat !== undefined) { st.categoria = String(b.dataset.cat); return pintarCatalogo(); }
    if (b.dataset.atras !== undefined) { st.categoria = null; return pintarCatalogo(); }
    if (b.dataset.item !== undefined) return anadir(categorias[st.categoria].items[Number(b.dataset.item)]);
    if (b.dataset.tecla) return tecla(b.dataset.tecla);
    if (b.dataset.pagar) return pagar(b.dataset.pagar);
    if (b.dataset.vaciar !== undefined) { st.lineas = []; st.descuento = ''; $('[data-descuento]').value = ''; return pintarTicket(); }
    if (b.dataset.mas) { st.lineas[b.dataset.mas].cantidad += 1; return pintarTicket(Number(b.dataset.mas)); }
    if (b.dataset.menos) {
      const i = Number(b.dataset.menos);
      st.lineas[i].cantidad -= 1;
      if (st.lineas[i].cantidad <= 0) st.lineas.splice(i, 1);
      return pintarTicket();
    }
    if (b.dataset.quitar) { st.lineas.splice(Number(b.dataset.quitar), 1); return pintarTicket(); }
    if (b.dataset.precio) {
      const v = valorEntrada();
      if (!st.entrada) return aviso('Escribe el precio nuevo en el teclado y vuelve a tocar el precio de la línea.');
      const l = st.lineas[b.dataset.precio];
      l.precio_unit = r2(v / l.cantidad);
      st.entrada = ''; pintarEntrada();
      return pintarTicket(Number(b.dataset.precio));
    }
    if (b.dataset.desc) { st.descTipo = b.dataset.desc; return totales(); }
  });
  raiz.addEventListener('input', (e) => {
    if (e.target.dataset.descuento !== undefined) { st.descuento = e.target.value; totales(); }
    if (e.target.dataset.nombre !== undefined) st.lineas[e.target.dataset.nombre].nombre = e.target.value;
  });
  $('[data-clienta]')?.addEventListener('change', (e) => { st.clientaId = e.target.value; });
  // Teclado físico (en el ordenador)
  const onKey = (e) => {
    if (document.querySelector('.capa, .pantalla-pin') || e.target.matches('input, select, textarea')) return;
    if (/^\d$/.test(e.key)) tecla(e.key);
    else if (e.key === ',' || e.key === '.') tecla(',');
    else if (e.key === 'Backspace') tecla('B');
    else if (e.key === '+' || e.key === 'Enter') tecla('+');
    else if (e.key === '-') tecla('-');
    else if (e.key === 'Escape') salir();
  };
  document.addEventListener('keydown', onKey);

  pintarTicket();
  pintarEntrada();
}

export { METODOS };

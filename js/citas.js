// Formulario de cita y ficha de detalle (se usan desde la agenda y desde la clienta)
import * as db from './db.js';
import { esc, euros, nombreCompleto, abrirHoja, confirmar, pedirTexto, aviso, errorAviso,
  telefonoWhatsApp, esmalteAleatorio, cargando } from './util.js';
import { hoyISO, aMinutos, aHora, textoDiaLargo, duracionTexto, horaCorta } from './fechas.js';
import { abrirCobro, abrirDetalleCobro, textoPagos } from './caja.js';
import { textoMinutosAntes } from './avisos.js';

const OPCIONES_AVISO = [null, 5, 15, 30, 60, 1440];
const cambioDatos = () => window.dispatchEvent(new Event('mb:datos'));

export const ESTADOS = {
  pendiente: 'Pendiente de confirmar',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  no_presentada: 'No vino',
  anulada: 'Anulada',
};

// ---------------------------------------------------------------------
// Formulario (nueva o editar)
// ---------------------------------------------------------------------
export async function abrirFormularioCita({ cita = null, fecha = hoyISO(), hora = '10:00', clientaId = null,
  copiarDe = null, enfocar = null, alGuardar } = {}) {
  cargando(true);
  let clientas, servicios;
  try {
    [clientas, servicios] = await Promise.all([db.listarClientas(), db.listarServicios()]);
  } catch (e) { cargando(false); return errorAviso(e, 'No se pudieron cargar los datos'); }
  cargando(false);

  const base = cita || copiarDe;
  const estado = {
    clienta: clientas.find((c) => c.id === (base?.clienta_id || clientaId)) || base?.clienta || null,
    lineas: base ? base.servicios.map((s) => ({
      servicio_id: s.servicio_id, nombre: s.nombre, precio: Number(s.precio), iva_pct: Number(s.iva_pct ?? 21),
      duracion_min: Number(s.duracion_min),
    })) : [],
    duracionManual: cita ? (cita.duracion_min !== cita.servicios.reduce((a, s) => a + Number(s.duracion_min), 0)) : false,
  };

  const porCategoria = {};
  for (const s of servicios) (porCategoria[s.categoria || 'Otros'] ||= []).push(s);
  const opcionesServicios = Object.entries(porCategoria).map(([cat, lista]) =>
    `<optgroup label="${esc(cat)}">${lista.map((s) =>
      `<option value="${s.id}">${esc(s.nombre)} · ${duracionTexto(s.duracion_min)} · ${euros(s.precio)}</option>`).join('')}</optgroup>`).join('');

  const titulo = cita ? 'Editar cita' : copiarDe ? 'Repetir cita' : 'Nueva cita';
  // Aviso previo: sin aviso salvo que se elija (al repetir una cita se copia el suyo)
  const avisoInicial = (cita || copiarDe)?.aviso_min ?? null;
  const opcionesAviso = OPCIONES_AVISO.includes(avisoInicial) ? OPCIONES_AVISO : [...OPCIONES_AVISO, avisoInicial].sort((a, b) => (a ?? -1) - (b ?? -1));
  const { el, cerrar } = abrirHoja(`
    <form class="form-cita" novalidate>
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">${titulo}</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <div class="campo">
          <span>Clienta</span>
          <div class="selector-clienta"></div>
        </div>

        <div class="fila-2">
          <label class="campo"><span>Día</span>
            <input type="date" name="fecha" required value="${esc(base && cita ? cita.fecha : fecha)}"></label>
          <label class="campo"><span>Hora</span>
            <input type="time" name="hora" required step="300" value="${esc(cita ? cita.hora : hora)}"></label>
        </div>

        <div class="campo">
          <span>Servicios</span>
          <ul class="lineas"></ul>
          <select class="anadir-servicio" aria-label="Añadir servicio">
            <option value="">Añadir servicio…</option>
            ${opcionesServicios}
            <option value="__libre">Otro (escribir a mano)</option>
          </select>
        </div>

        <div class="fila-2">
          <label class="campo"><span>Duración (min)</span>
            <input type="number" name="duracion" min="5" max="720" step="5" inputmode="numeric"></label>
          <label class="campo"><span>Aviso previo</span>
            <select name="aviso_min">${opcionesAviso.map((m) =>
              `<option value="${m ?? ''}" ${m === avisoInicial ? 'selected' : ''}>${textoMinutosAntes(m)}</option>`).join('')}</select></label>
        </div>
        ${cita ? `<label class="campo"><span>Estado</span>
            <select name="estado">${Object.entries(ESTADOS).map(([k, v]) =>
              `<option value="${k}" ${cita.estado === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}

        <label class="campo"><span>Notas de esta cita</span>
          <textarea name="notas" rows="2" placeholder="Ej.: trae foto del diseño">${esc(cita?.notas || '')}</textarea></label>
      </div>
      <footer class="hoja-pie">
        <p class="resumen-cita" aria-live="polite"></p>
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${cita ? 'Guardar cambios' : 'Guardar cita'}</button>
      </footer>
    </form>`, { ancho: 'ancha' });

  const form = el.querySelector('form');
  const inpDur = form.elements.duracion;
  const sumaDur = () => estado.lineas.reduce((a, l) => a + (Number(l.duracion_min) || 0), 0);
  if (cita) inpDur.value = cita.duracion_min;

  // ---- selector de clienta con búsqueda ----
  const zonaClienta = el.querySelector('.selector-clienta');
  function pintarClienta() {
    if (estado.clienta) {
      const c = estado.clienta;
      zonaClienta.innerHTML = `
        <div class="clienta-elegida" style="--esmalte:${esc(c.color || '#B5838D')}">
          <span class="gota" aria-hidden="true"></span>
          <div><strong>${esc(nombreCompleto(c))}</strong>
            ${c.telefono ? `<small>${esc(c.telefono)}</small>` : ''}
            ${c.preferencias ? `<p class="preferencia">${esc(c.preferencias)}</p>` : ''}</div>
          <button type="button" class="btn btn-mini" data-cambiar>Cambiar</button>
        </div>`;
      return;
    }
    zonaClienta.innerHTML = `
      <div class="buscador">
        <input type="search" placeholder="Buscar por nombre o teléfono" autocomplete="off" aria-label="Buscar clienta">
        <ul class="resultados" role="listbox"></ul>
      </div>`;
    const inp = zonaClienta.querySelector('input');
    const ul = zonaClienta.querySelector('.resultados');
    const pintarResultados = () => {
      const q = inp.value.trim().toLowerCase();
      const qTel = q.replace(/\s/g, '');
      const lista = clientas.filter((c) => !q || nombreCompleto(c).toLowerCase().includes(q)
        || (qTel && String(c.telefono || '').replace(/\s/g, '').includes(qTel))).slice(0, 8);
      ul.innerHTML = lista.map((c) => `
        <li><button type="button" data-id="${c.id}" style="--esmalte:${esc(c.color || '#B5838D')}">
          <span class="gota" aria-hidden="true"></span>${esc(nombreCompleto(c))}
          <small>${esc(c.telefono || '')}</small></button></li>`).join('')
        + `<li><button type="button" class="nueva" data-nueva>+ Nueva clienta${q ? `: «${esc(inp.value.trim())}»` : ''}</button></li>`;
    };
    inp.addEventListener('input', pintarResultados);
    pintarResultados();
    if (!cita) setTimeout(() => inp.focus(), 50);
  }
  zonaClienta.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cambiar]')) { estado.clienta = null; pintarClienta(); return; }
    const b = e.target.closest('[data-id]');
    if (b) { estado.clienta = clientas.find((c) => c.id === b.dataset.id); pintarClienta(); return; }
    if (e.target.closest('[data-nueva]')) {
      const escrito = zonaClienta.querySelector('input')?.value.trim() || '';
      const nueva = await altaRapidaClienta(escrito);
      if (nueva) { clientas.push(nueva); estado.clienta = nueva; pintarClienta(); }
    }
  });

  // ---- líneas de servicio ----
  const ul = el.querySelector('.lineas');
  function pintarLineas() {
    ul.innerHTML = estado.lineas.map((l, i) => `
      <li class="linea">
        <input class="linea-nombre" data-i="${i}" data-k="nombre" value="${esc(l.nombre)}" aria-label="Servicio">
        <label class="linea-num"><input type="number" data-i="${i}" data-k="duracion_min" value="${l.duracion_min}" min="0" step="5" inputmode="numeric" aria-label="Minutos"><span>min</span></label>
        <label class="linea-num"><input type="number" data-i="${i}" data-k="precio" value="${l.precio}" min="0" step="0.5" inputmode="decimal" aria-label="Precio"><span>€</span></label>
        <button type="button" class="btn-icono" data-quitar="${i}" aria-label="Quitar ${esc(l.nombre)}">✕</button>
      </li>`).join('') || '<li class="vacio-lineas">Todavía no hay servicios en esta cita.</li>';
    actualizar();
  }
  function actualizar() {
    if (!estado.duracionManual) inpDur.value = sumaDur() || 30;
    const total = estado.lineas.reduce((a, l) => a + (Number(l.precio) || 0), 0);
    const h = form.elements.hora.value;
    const fin = h ? aHora(aMinutos(h) + (Number(inpDur.value) || 0)) : '';
    el.querySelector('.resumen-cita').textContent = h ? `${h}–${fin} · ${euros(total)}` : euros(total);
  }
  ul.addEventListener('input', (e) => {
    const i = e.target.dataset.i;
    if (i == null) return;
    const k = e.target.dataset.k;
    estado.lineas[i][k] = k === 'nombre' ? e.target.value : Number(e.target.value.replace(',', '.'));
    actualizar();
  });
  ul.addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    estado.lineas.splice(Number(b.dataset.quitar), 1);
    pintarLineas();
  });
  el.querySelector('.anadir-servicio').addEventListener('change', (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!v) return;
    if (v === '__libre') estado.lineas.push({ servicio_id: null, nombre: '', precio: 0, iva_pct: 21, duracion_min: 30 });
    else {
      const s = servicios.find((x) => x.id === v);
      estado.lineas.push({ servicio_id: s.id, nombre: s.nombre, precio: Number(s.precio), iva_pct: Number(s.iva_pct ?? 21), duracion_min: s.duracion_min });
    }
    pintarLineas();
    if (v === '__libre') ul.querySelector('.linea:last-child .linea-nombre')?.focus();
  });
  inpDur.addEventListener('input', () => { estado.duracionManual = true; actualizar(); });
  form.elements.hora.addEventListener('input', actualizar);

  pintarClienta();
  pintarLineas();
  if (enfocar) setTimeout(() => form.elements[enfocar]?.focus(), 80);

  // ---- guardar ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    if (!estado.clienta) return aviso('Elige una clienta o crea una nueva.', 'error');
    if (!f.fecha.value || !f.hora.value) return aviso('Pon el día y la hora.', 'error');
    const lineas = estado.lineas.filter((l) => l.nombre.trim());
    if (!lineas.length) return aviso('Añade al menos un servicio.', 'error');

    const duracion = Number(f.duracion.value) || sumaDur() || 30;
    const inicio = aMinutos(f.hora.value);
    const datos = {
      id: cita?.id || null,
      clienta_id: estado.clienta.id,
      fecha: f.fecha.value,
      hora_inicio: f.hora.value,
      duracion_min: duracion,
      estado: f.estado?.value || (cita ? cita.estado : 'pendiente'),
      notas: f.notas.value.trim(),
      aviso_min: f.aviso_min.value === '' ? null : Number(f.aviso_min.value),
    };
    cargando(true);
    try {
      const pisa = await db.solapes(datos.fecha, inicio, inicio + duracion, cita?.id);
      cargando(false);
      if (pisa.length) {
        const quien = pisa.map((c) => `${c.hora} ${nombreCompleto(c.clienta)}`).join(', ');
        const ok = await confirmar('Esa hora se cruza con otra cita', {
          detalle: `Coincide con: ${quien}. ¿Guardarla igualmente?`, si: 'Guardar igualmente', no: 'Elegir otra hora',
        });
        if (!ok) return;
      }
      cargando(true);
      const id = await db.guardarCita(datos, lineas.map((l) => ({ ...l, nombre: l.nombre.trim() })));
      aviso(cita ? 'Cita actualizada' : 'Cita guardada');
      cambioDatos();
      cerrar();
      alGuardar?.(id, datos);
    } catch (err) { errorAviso(err); }
    finally { cargando(false); }
  });
}

async function altaRapidaClienta(textoInicial) {
  return new Promise((resolve) => {
    let hecho = false;
    const soloNumeros = /^[\d\s+]+$/.test(textoInicial);
    const { el, cerrar } = abrirHoja(`
      <form class="hoja-cuerpo">
        <h2 class="hoja-titulo">Nueva clienta</h2>
        <label class="campo"><span>Nombre</span><input name="nombre" required autofocus value="${soloNumeros ? '' : esc(textoInicial)}"></label>
        <label class="campo"><span>Apellidos</span><input name="apellidos"></label>
        <label class="campo"><span>Teléfono</span><input name="telefono" type="tel" inputmode="tel" value="${soloNumeros ? esc(textoInicial) : ''}"></label>
        <label class="check"><input type="checkbox" name="consentimiento_datos"> Acepta que guardemos sus datos para gestionar sus citas</label>
        <p class="texto-suave">Podrás completar la ficha más tarde desde Clientas.</p>
        <div class="hoja-pie sin-borde">
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button class="btn btn-principal">Crear clienta</button>
        </div>
      </form>`, { ancho: 'estrecha', alCerrar: () => { if (!hecho) resolve(null); } });
    const form = el.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      if (!f.nombre.value.trim()) return aviso('Escribe el nombre.', 'error');
      try {
        cargando(true);
        const nueva = await db.guardarClienta({
          nombre: f.nombre.value.trim(), apellidos: f.apellidos.value.trim(), telefono: f.telefono.value.trim(),
          color: esmalteAleatorio(), consentimiento_datos: f.consentimiento_datos.checked,
          consentimiento_fecha: f.consentimiento_datos.checked ? new Date().toISOString() : null,
        });
        hecho = true; resolve(nueva); cerrar();
        aviso('Clienta creada');
      } catch (err) { errorAviso(err); } finally { cargando(false); }
    });
  });
}

// ---------------------------------------------------------------------
// Detalle de una cita con sus acciones
// ---------------------------------------------------------------------
export async function abrirDetalleCita(id, alCambiar) {
  let c;
  try { c = await db.obtenerCita(id); } catch (e) { return errorAviso(e, 'No se pudo abrir la cita'); }
  const cl = c.clienta;
  const negocio = db.negocioActual();
  const tel = telefonoWhatsApp(cl?.telefono);
  const recordatorio = encodeURIComponent(
    `Hola ${cl?.nombre || ''}, te recordamos tu cita en ${negocio?.nombre || 'el centro'} el ${textoDiaLargo(c.fecha).toLowerCase()} a las ${c.hora}. Si no puedes venir, avísanos. ¡Gracias!`);
  const activa = !['anulada', 'realizada', 'no_presentada'].includes(c.estado);
  let cobro = null;
  if (c.cobrada) { try { cobro = await db.cobroDeCita(c.id); } catch { /* se muestra sin detalle */ } }
  const cobrable = !c.cobrada && !['anulada', 'no_presentada'].includes(c.estado);

  const { el, cerrar } = abrirHoja(`
    <header class="hoja-cabecera detalle-cabecera" style="--esmalte:${esc(cl?.color || '#B5838D')}">
      <div>
        <p class="detalle-cuando">${esc(textoDiaLargo(c.fecha))} · ${c.hora}–${aHora(c.fin)}</p>
        <h2 class="hoja-titulo">${cl ? `<a href="#clientas/${cl.id}" data-cerrar>${esc(nombreCompleto(cl))}</a>` : 'Clienta eliminada'}</h2>
        <span class="estado estado-${c.estado}">${ESTADOS[c.estado]}</span>

      </div>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo">
      ${cl?.preferencias ? `<div class="nota-preferencia"><strong>Le gusta</strong><p>${esc(cl.preferencias)}</p></div>` : ''}
      <ul class="detalle-servicios">
        ${c.servicios.map((s) => `<li><span>${esc(s.nombre)}</span><small>${duracionTexto(Number(s.duracion_min))}</small><b>${euros(s.precio)}</b></li>`).join('')}
        <li class="total"><span>Total</span><small>${duracionTexto(c.duracion_min)}</small><b>${euros(c.total)}</b></li>
      </ul>
      ${cobro ? `<button class="cobro-hecho" data-a="ver-cobro">
        <span>Cobrada · <strong>${euros(cobro.total)}</strong> · ${esc(textoPagos(cobro.pagos))}</span><em>Ver cobro ›</em></button>` : ''}
      ${c.notas ? `<p class="detalle-notas"><strong>Notas:</strong> ${esc(c.notas)}</p>` : ''}
      ${cl?.notas ? `<p class="detalle-notas"><strong>Sobre la clienta:</strong> ${esc(cl.notas)}</p>` : ''}
      ${c.estado === 'anulada' && c.motivo_anulacion ? `<p class="detalle-notas"><strong>Motivo de anulación:</strong> ${esc(c.motivo_anulacion)}</p>` : ''}

      ${activa ? `<button type="button" class="btn boton-aviso ${c.aviso_min !== null && c.aviso_min !== undefined ? 'con-aviso' : ''}" data-aviso>
        🔔 Aviso previo: <b>${esc(textoMinutosAntes(c.aviso_min ?? null))}</b></button>` : ''}
      ${cl?.telefono ? `<div class="contacto">
        <a class="btn" href="tel:${esc(cl.telefono.replace(/\s/g, ''))}">Llamar</a>
        ${tel ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${tel}?text=${recordatorio}">Recordar por WhatsApp</a>` : ''}
      </div>` : ''}
    </div>
    <footer class="hoja-pie acciones-cita">
      ${cobrable ? '<button class="btn btn-principal" data-a="cobrar">Cobrar</button>' : ''}
      ${c.estado === 'pendiente' ? '<button class="btn" data-a="confirmada">Confirmar</button>' : ''}
      ${activa ? '<button class="btn" data-a="mover">Cambiar hora</button>' : ''}
      <button class="btn" data-a="editar">Editar</button>
      <button class="btn" data-a="repetir">Repetir</button>
      ${activa ? '<button class="btn" data-a="no_presentada">No vino</button>' : ''}
      ${activa ? '<button class="btn btn-peligro-suave" data-a="anular">Anular</button>' : ''}
      ${!activa && !c.cobrada ? '<button class="btn" data-a="pendiente">Volver a pendiente</button>' : ''}
    </footer>`, { ancho: 'normal' });

  el.querySelector('[data-aviso]')?.addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const elegido = await elegirAviso(c.aviso_min ?? null);
    if (elegido === undefined) return;
    try {
      await db.cambiarAvisoCita(c.id, elegido);
      c.aviso_min = elegido;
      boton.querySelector('b').textContent = textoMinutosAntes(elegido);
      boton.classList.toggle('con-aviso', elegido !== null);
      aviso(elegido === null ? 'Sin aviso previo' : `Avisará ${textoMinutosAntes(elegido).toLowerCase()}`);
      cambioDatos();
    } catch (err) { errorAviso(err, 'No se pudo cambiar el aviso'); }
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    try {
      if (a === 'cobrar') { cerrar(); return abrirCobro({ cita: c, alCobrar: () => alCambiar?.() }); }
      if (a === 'ver-cobro') { cerrar(); return abrirDetalleCobro(cobro.id, () => alCambiar?.()); }
      if (a === 'editar' || a === 'mover') {
        cerrar();
        return abrirFormularioCita({ cita: c, enfocar: a === 'mover' ? 'fecha' : null, alGuardar: alCambiar });
      }
      if (a === 'repetir') {
        cerrar();
        return abrirFormularioCita({ copiarDe: c, fecha: c.fecha, hora: c.hora, alGuardar: alCambiar });
      }
      if (a === 'anular') {
        const motivo = await pedirTexto('Anular la cita', { etiqueta: 'Motivo (opcional)', boton: 'Anular cita', peligro: true });
        if (motivo === null) return;
        await db.cambiarEstadoCita(c.id, 'anulada', motivo || null);
        aviso('Cita anulada');
      } else {
        await db.cambiarEstadoCita(c.id, a);
        aviso({ confirmada: 'Cita confirmada', realizada: 'Cita marcada como hecha', no_presentada: 'Marcada como «No vino»', pendiente: 'Cita pendiente otra vez' }[a]);
      }
      cambioDatos();
      cerrar();
      alCambiar?.();
    } catch (err) { errorAviso(err); }
  });
}

// Elegir el aviso previo de una cita. Devuelve los minutos, null (sin aviso) o undefined (cancelado)
function elegirAviso(actual) {
  return new Promise((resolve) => {
    let hecho = false;
    const { el, cerrar } = abrirHoja(`
      <div class="hoja-cuerpo">
        <h2 class="hoja-titulo">Aviso previo</h2>
        <div class="opciones-aviso">${OPCIONES_AVISO.map((m) => `<button type="button" class="btn ${m === actual ? 'btn-principal' : ''}" data-min="${m ?? ''}">${textoMinutosAntes(m).replace(' antes', '')}</button>`).join('')}</div>
        <div class="hoja-pie sin-borde"><button type="button" class="btn" data-cerrar>Cancelar</button></div>
      </div>`, { ancho: 'estrecha', alCerrar: () => { if (!hecho) resolve(undefined); } });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-min]'); if (!b) return;
      hecho = true; resolve(b.dataset.min === '' ? null : Number(b.dataset.min)); cerrar();
    });
  });
}

export function textoServicios(c) {
  return c.servicios.map((s) => s.nombre).join(', ');
}
export { horaCorta };

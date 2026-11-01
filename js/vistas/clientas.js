// Clientas: listado con buscador, ficha con historial y formulario
import * as db from '../db.js';
import { esc, euros, nombreCompleto, iniciales, abrirHoja, confirmar, aviso, errorAviso, cargando,
  telefonoWhatsApp, ESMALTES, esmalteAleatorio, datosFormulario } from '../util.js';
import { hoyISO, textoFecha, textoDiaCorto } from '../fechas.js';
import { abrirFormularioCita, abrirDetalleCita, ESTADOS, textoServicios } from '../citas.js';
import { abrirDetalleCobro, textoPagos } from '../caja.js';

let filtro = '';
let verArchivadas = false;

export async function render(el, id) {
  if (id) return renderFicha(el, id);
  el.innerHTML = `
    <section aria-labelledby="tituloClientas">
      <header class="barra">
        <h1 id="tituloClientas" class="barra-titulo">Clientas</h1>
        <button class="btn btn-principal" data-nueva>Nueva clienta</button>
      </header>
      <div class="buscar-fila">
        <input type="search" class="buscar" placeholder="Buscar clienta" value="${esc(filtro)}" aria-label="Buscar clientas">
        <label class="check"><input type="checkbox" data-archivadas ${verArchivadas ? 'checked' : ''}> Archivadas</label>
      </div>
      <ul class="lista-clientas"><li class="cargando-texto">Cargando…</li></ul>
    </section>`;

  let clientas = [];
  try { clientas = await db.listarClientas({ archivadas: verArchivadas }); }
  catch (e) { errorAviso(e, 'No se pudieron cargar las clientas'); }

  const ul = el.querySelector('.lista-clientas');
  const pintar = () => {
    const q = filtro.toLowerCase();
    const qTel = q.replace(/\s/g, '');
    const lista = clientas.filter((c) => !q
      || nombreCompleto(c).toLowerCase().includes(q)
      || (qTel && String(c.telefono || '').replace(/\s/g, '').includes(qTel))
      || String(c.preferencias || '').toLowerCase().includes(q));
    if (!clientas.length) {
      ul.innerHTML = `<li class="vacio"><p>${verArchivadas ? 'No hay clientas archivadas.' : 'Aún no hay clientas. Crea la primera con «Nueva clienta» o directamente al apuntar una cita.'}</p></li>`;
      return;
    }
    ul.innerHTML = lista.map((c) => `
      <li><a href="#clientas/${c.id}" class="fila-clienta" style="--esmalte:${esc(c.color || '#B5838D')}">
        <span class="avatar" aria-hidden="true">${esc(iniciales(c))}</span>
        <span class="fc-texto"><strong>${esc(nombreCompleto(c))}</strong>
          <small>${esc(c.telefono || 'Sin teléfono')}</small></span>
        ${c.preferencias ? `<span class="fc-pref">${esc(c.preferencias)}</span>` : ''}
      </a></li>`).join('') || `<li class="vacio"><p>Ninguna clienta coincide con «${esc(filtro)}».</p></li>`;
  };
  pintar();

  el.querySelector('.buscar').addEventListener('input', (e) => { filtro = e.target.value.trim(); pintar(); });
  el.querySelector('[data-archivadas]').addEventListener('change', (e) => { verArchivadas = e.target.checked; render(el); });
  el.querySelector('[data-nueva]').addEventListener('click', () =>
    abrirFormularioClienta(null, (nueva) => { location.hash = `#clientas/${nueva.id}`; }));
}

// ---------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------
async function renderFicha(contenedor, id) {
  // Contenedor nuevo en cada pintado para no acumular manejadores de eventos
  const el = document.createElement('div');
  contenedor.replaceChildren(el);
  el.innerHTML = '<p class="cargando-texto">Cargando ficha…</p>';
  let c, citas, cobros;
  try { [c, citas, cobros] = await Promise.all([db.obtenerClienta(id), db.citasDeClienta(id), db.cobrosDeClienta(id)]); }
  catch (e) {
    el.innerHTML = '<div class="vacio"><p>No se encontró esta clienta.</p><a class="btn" href="#clientas">Volver a clientas</a></div>';
    return errorAviso(e, 'Error');
  }
  const hoy = hoyISO();
  const proximas = citas.filter((x) => x.fecha >= hoy && !['anulada', 'realizada', 'no_presentada'].includes(x.estado)).reverse();
  const pasadas = citas.filter((x) => !proximas.includes(x));
  const hechas = citas.filter((x) => x.estado === 'realizada');
  // Lo gastado sale de los cobros reales (servicios + productos, con descuentos)
  const gastado = cobros.filter((x) => !x.anulado).reduce((a, x) => a + x.total, 0);
  const noVino = citas.filter((x) => x.estado === 'no_presentada').length;
  const tel = telefonoWhatsApp(c.telefono);

  const filaCita = (x) => `
    <li><button data-cita="${x.id}" class="cita-hist estado-${x.estado}">
      <time>${esc(textoDiaCorto(x.fecha))} · ${x.hora}</time>
      <span>${esc(textoServicios(x))}</span>
      <b>${euros(x.total)}</b>
      ${x.estado !== 'confirmada' ? `<em>${esc(ESTADOS[x.estado])}</em>` : ''}
    </button></li>`;

  el.innerHTML = `
    <article class="ficha" style="--esmalte:${esc(c.color || '#B5838D')}">
      <a href="#clientas" class="volver">‹ Clientas</a>
      <header class="ficha-cabecera">
        <span class="avatar grande" aria-hidden="true">${esc(iniciales(c))}</span>
        <div>
          <h1>${esc(nombreCompleto(c))}</h1>
          <p class="texto-suave">${[c.telefono, c.email].filter(Boolean).map(esc).join(' · ') || 'Sin datos de contacto'}</p>
          ${c.archivada ? '<span class="estado estado-anulada">Archivada</span>' : ''}
        </div>
        <div class="ficha-acciones">
          <button class="btn btn-principal" data-a="cita">Nueva cita</button>
          ${c.telefono ? `<a class="btn" href="tel:${esc(c.telefono.replace(/\s/g, ''))}">Llamar</a>` : ''}
          ${tel ? `<a class="btn" href="https://wa.me/${tel}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button class="btn" data-a="editar">Editar ficha</button>
        </div>
      </header>

      <div class="ficha-rejilla">
        <section class="tarjeta preferencias-tarjeta">
          <h2>Le gusta</h2>
          <p>${c.preferencias ? esc(c.preferencias) : '<span class="texto-suave">Apunta aquí sus colores, formas o marcas preferidas desde «Editar ficha».</span>'}</p>
        </section>
        <section class="tarjeta">
          <h2>Resumen</h2>
          <dl class="cifras">
            <div><dt>Visitas</dt><dd>${hechas.length}</dd></div>
            <div><dt>Gastado</dt><dd>${euros(gastado)}</dd></div>
            <div><dt>Última visita</dt><dd>${hechas[0] ? esc(textoFecha(hechas[0].fecha)) : '—'}</dd></div>
            ${noVino ? `<div><dt>No vino</dt><dd>${noVino}</dd></div>` : ''}
          </dl>
        </section>
        ${c.notas ? `<section class="tarjeta"><h2>Notas</h2><p>${esc(c.notas)}</p></section>` : ''}
        ${c.consentimiento_salud && c.notas_salud ? `<section class="tarjeta tarjeta-salud"><h2>Salud y sensibilidad</h2><p>${esc(c.notas_salud)}</p></section>` : ''}
      </div>

      <section class="historial">
        <h2>Próximas citas</h2>
        ${proximas.length ? `<ul>${proximas.map(filaCita).join('')}</ul>` : '<p class="texto-suave">No tiene citas pendientes.</p>'}
        <h2>Historial</h2>
        ${pasadas.length ? `<ul>${pasadas.map(filaCita).join('')}</ul>` : '<p class="texto-suave">Todavía no hay citas anteriores.</p>'}
        <h2>Cobros</h2>
        ${cobros.length ? `<ul>${cobros.slice(0, 15).map((x) => `
          <li><button data-cobro="${x.id}" class="cita-hist ${x.anulado ? 'estado-anulada' : ''}">
            <time>${esc(textoDiaCorto(x.fecha))} · ${x.hora}</time>
            <span>${esc(x.lineas.map((l) => (Number(l.cantidad) !== 1 ? `${Number(l.cantidad)}× ` : '') + l.nombre).join(', '))}</span>
            <b>${euros(x.total)}</b>
            <em>${x.anulado ? 'Anulado' : esc(textoPagos(x.pagos))}</em>
          </button></li>`).join('')}</ul>` : '<p class="texto-suave">Todavía no hay cobros.</p>'}
      </section>

      <section class="tarjeta datos-extra">
        <h2>Datos para facturas y consentimientos</h2>
        <dl class="datos">
          <div><dt>NIF</dt><dd>${esc(c.nif || '—')}</dd></div>
          <div><dt>Dirección</dt><dd>${esc([c.direccion, c.cp, c.poblacion].filter(Boolean).join(', ') || '—')}</dd></div>
          <div><dt>Cumpleaños</dt><dd>${c.fecha_nacimiento ? esc(textoDiaCorto(c.fecha_nacimiento)) : '—'}</dd></div>
          <div><dt>Datos personales</dt><dd>${c.consentimiento_datos ? `Autorizado${c.consentimiento_fecha ? ' el ' + esc(textoFecha(c.consentimiento_fecha.slice(0, 10))) : ''}` : '<span class="aviso-texto">Sin autorización registrada</span>'}</dd></div>
          <div><dt>Datos de salud</dt><dd>${c.consentimiento_salud ? 'Autorizado' : 'No autorizado'}</dd></div>
          <div><dt>Comunicaciones</dt><dd>${c.consentimiento_comunicaciones ? 'Acepta recibir avisos y promociones' : 'No acepta promociones'}</dd></div>
        </dl>
        <button class="btn btn-mini" data-a="archivar">${c.archivada ? 'Recuperar clienta' : 'Archivar clienta'}</button>
      </section>
    </article>`;

  const recargar = () => { if (contenedor.contains(el)) renderFicha(contenedor, id); };
  el.addEventListener('click', async (e) => {
    const citaB = e.target.closest('[data-cita]');
    if (citaB) return abrirDetalleCita(citaB.dataset.cita, recargar);
    const cobroB = e.target.closest('[data-cobro]');
    if (cobroB) return abrirDetalleCobro(cobroB.dataset.cobro, recargar);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'cita') abrirFormularioCita({ clientaId: c.id, alGuardar: recargar });
    if (a === 'editar') abrirFormularioClienta(c, recargar);
    if (a === 'archivar') {
      const ok = c.archivada || await confirmar(`¿Archivar a ${nombreCompleto(c)}?`, {
        detalle: 'Dejará de aparecer en el listado y al buscar clientas. Su historial se conserva y puedes recuperarla cuando quieras.',
        si: 'Archivar',
      });
      if (!ok) return;
      try { await db.guardarClienta({ ...c, archivada: !c.archivada }); aviso(c.archivada ? 'Clienta recuperada' : 'Clienta archivada'); recargar(); }
      catch (err) { errorAviso(err); }
    }
  });
}

// ---------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------
export function abrirFormularioClienta(c, alGuardar) {
  const nueva = !c;
  c = c || { color: esmalteAleatorio() };
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">${nueva ? 'Nueva clienta' : 'Editar ficha'}</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <div class="fila-2">
          <label class="campo"><span>Nombre</span><input name="nombre" required value="${esc(c.nombre || '')}" autofocus></label>
          <label class="campo"><span>Apellidos</span><input name="apellidos" value="${esc(c.apellidos || '')}"></label>
        </div>
        <div class="fila-2">
          <label class="campo"><span>Teléfono</span><input name="telefono" type="tel" inputmode="tel" value="${esc(c.telefono || '')}"></label>
          <label class="campo"><span>Email</span><input name="email" type="email" inputmode="email" value="${esc(c.email || '')}"></label>
        </div>
        <fieldset class="campo">
          <legend>Color en la agenda</legend>
          <div class="esmaltes">
            ${ESMALTES.map((col) => `<label style="--esmalte:${col}"><input type="radio" name="color" value="${col}" ${c.color === col ? 'checked' : ''}><span class="sr">${col}</span></label>`).join('')}
          </div>
        </fieldset>
        <label class="campo"><span>Le gusta (colores, forma, marcas…)</span>
          <textarea name="preferencias" rows="2" placeholder="Ej.: rojo cereza, forma almendra, sin purpurina">${esc(c.preferencias || '')}</textarea></label>
        <label class="campo"><span>Notas internas</span>
          <textarea name="notas" rows="2" placeholder="Ej.: prefiere primera hora, viene con su hija">${esc(c.notas || '')}</textarea></label>

        <details class="plegable" ${c.nif || c.direccion ? 'open' : ''}>
          <summary>Datos para facturas</summary>
          <div class="fila-2">
            <label class="campo"><span>NIF</span><input name="nif" value="${esc(c.nif || '')}" autocapitalize="characters"></label>
            <label class="campo"><span>Fecha de nacimiento</span><input name="fecha_nacimiento" type="date" value="${esc(c.fecha_nacimiento || '')}"></label>
          </div>
          <label class="campo"><span>Dirección</span><input name="direccion" value="${esc(c.direccion || '')}"></label>
          <div class="fila-2">
            <label class="campo"><span>Código postal</span><input name="cp" inputmode="numeric" value="${esc(c.cp || '')}"></label>
            <label class="campo"><span>Población</span><input name="poblacion" value="${esc(c.poblacion || '')}"></label>
          </div>
        </details>

        <fieldset class="campo consentimientos">
          <legend>Consentimientos</legend>
          <label class="check"><input type="checkbox" name="consentimiento_datos" ${c.consentimiento_datos ? 'checked' : ''}> Acepta que guardemos sus datos para gestionar citas y facturas</label>
          <label class="check"><input type="checkbox" name="consentimiento_comunicaciones" ${c.consentimiento_comunicaciones ? 'checked' : ''}> Acepta recibir recordatorios y promociones</label>
          <label class="check"><input type="checkbox" name="consentimiento_salud" ${c.consentimiento_salud ? 'checked' : ''}> Autoriza guardar datos de salud (alergias, sensibilidad…)</label>
          <label class="campo campo-salud" ${c.consentimiento_salud ? '' : 'hidden'}><span>Salud y sensibilidad</span>
            <textarea name="notas_salud" rows="2" placeholder="Ej.: alergia al látex, uñas frágiles">${esc(c.notas_salud || '')}</textarea></label>
        </fieldset>
      </div>
      <footer class="hoja-pie">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${nueva ? 'Crear clienta' : 'Guardar cambios'}</button>
      </footer>
    </form>`, { ancho: 'ancha' });

  const form = el.querySelector('form');
  form.elements.consentimiento_salud.addEventListener('change', (e) => {
    form.querySelector('.campo-salud').hidden = !e.target.checked;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(form);
    if (!d.nombre) return aviso('Escribe el nombre.', 'error');
    if (d.consentimiento_datos && !c.consentimiento_datos) d.consentimiento_fecha = new Date().toISOString();
    if (!d.consentimiento_datos) d.consentimiento_fecha = null;
    try {
      cargando(true);
      const guardada = await db.guardarClienta({ ...c, ...d, id: c.id });
      aviso(nueva ? 'Clienta creada' : 'Ficha guardada');
      cerrar();
      alGuardar?.(guardada);
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

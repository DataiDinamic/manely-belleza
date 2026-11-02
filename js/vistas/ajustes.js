// Ajustes: datos del centro, horario, PIN y sesión
import * as db from '../db.js';
import { esc, aviso, errorAviso, cargando, datosFormulario, confirmar } from '../util.js';
import { leerAjustes, guardarAjustes } from '../ajustes.js';
import { cambiarPin, fijarMinutosBloqueo, bloquearYa } from '../pin.js';
import { elegirArchivo } from '../importar.js';
import { ORIGINALES, TITULOS, HUECOS, leerMensaje, guardarMensajes, mensajeAlCrear, fijarMensajeAlCrear } from '../mensajes.js';
import { descargarCopia, introducirCopia, ultimaCopia, enviarCopia } from '../copia.js';
import { ajustesAvisos, guardarAjustesAvisos, probar, notificacionesPosibles, pedirPermisoNotificaciones } from '../avisos.js';

export async function render(el, { cuenta, alSalir }) {
  const n = db.negocioActual() || {};
  const aj = leerAjustes();
  const av = ajustesAvisos();
  const permiso = notificacionesPosibles() ? Notification.permission : 'no';
  const textoPermiso = { granted: 'Permitidas en este dispositivo.', denied: 'Bloqueadas: se pueden permitir en los ajustes del navegador (candado junto a la dirección → Notificaciones).', default: 'Aún sin permitir.', no: 'Este navegador no las admite.' }[permiso];
  el.innerHTML = `
    <section class="ajustes" aria-labelledby="tituloAjustes">
      <header class="barra"><h1 id="tituloAjustes" class="barra-titulo">Ajustes</h1></header>

      <form class="tarjeta" data-form="negocio" novalidate>
        <h2>Datos del centro</h2>
        <p class="texto-suave">Saldrán en las facturas.</p>
        <div class="fila-2">
          <label class="campo"><span>Nombre comercial</span><input name="nombre" value="${esc(n.nombre || '')}"></label>
          <label class="campo"><span>Titular o razón social</span><input name="razon_social" value="${esc(n.razon_social || '')}"></label>
        </div>
        <div class="fila-2">
          <label class="campo"><span>NIF</span><input name="nif" value="${esc(n.nif || '')}" autocapitalize="characters"></label>
          <label class="campo"><span>Teléfono</span><input name="telefono" type="tel" value="${esc(n.telefono || '')}"></label>
        </div>
        <label class="campo"><span>Dirección</span><input name="direccion" value="${esc(n.direccion || '')}"></label>
        <div class="fila-3">
          <label class="campo"><span>Código postal</span><input name="cp" inputmode="numeric" value="${esc(n.cp || '')}"></label>
          <label class="campo"><span>Población</span><input name="poblacion" value="${esc(n.poblacion || '')}"></label>
          <label class="campo"><span>Provincia</span><input name="provincia" value="${esc(n.provincia || '')}"></label>
        </div>
        <label class="campo"><span>Email</span><input name="email" type="email" value="${esc(n.email || '')}"></label>
        <div class="acciones-form"><button class="btn btn-principal">Guardar datos del centro</button></div>
      </form>

      <form class="tarjeta" data-form="dispositivo">
        <h2>En este dispositivo</h2>
        <div class="fila-2">
          <label class="campo"><span>La agenda empieza a las</span><input type="time" name="apertura" step="1800" value="${esc(aj.apertura)}"></label>
          <label class="campo"><span>y termina a las</span><input type="time" name="cierre" step="1800" value="${esc(aj.cierre)}"></label>
          <label class="campo"><span>Llamadas y SMS</span>
            <select name="llamadas">${[['auto', 'Automático'], ['aqui', 'Desde este dispositivo'], ['qr', 'Con código QR para el móvil']].map(([k, v]) => `<option value="${k}" ${(aj.llamadas || 'auto') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="campo"><span>Bloquear tras</span>
            <select name="bloqueo">${[1, 2, 5, 10, 15, 30].map((m) => `<option value="${m}" ${Number(aj.bloqueo) === m ? 'selected' : ''}>${m} min sin usar</option>`).join('')}</select></label>
        </div>
        <div class="acciones-form">
          <button class="btn btn-principal">Guardar</button>
          <button type="button" class="btn" data-a="pin">Cambiar PIN</button>
          <button type="button" class="btn" data-a="bloquear">Bloquear ahora</button>
        </div>
      </form>


      <form class="tarjeta" data-form="avisos">
        <h2>Avisos</h2>
        <p class="texto-suave">Suenan mientras la app está abierta, aunque esté en segundo plano o con otra pestaña delante. Si está cerrada del todo, el aviso sale al abrirla. Conviene dejarla abierta en la tablet del salón.</p>
        <div class="fila-2">
          <label class="check"><input type="checkbox" name="activos" ${av.activos ? 'checked' : ''}> Avisar en este dispositivo</label>
          <label class="check"><input type="checkbox" name="sonido" ${av.sonido ? 'checked' : ''}> Con sonido</label>
          <label class="check"><input type="checkbox" name="recordatorioDiario" ${av.recordatorioDiario !== false ? 'checked' : ''}> Recordatorios de mañana al empezar la jornada (a la hora de apertura)</label>

        </div>
        <p class="texto-suave">Notificaciones del sistema (para verlas con la app en segundo plano): <strong class="estado-permiso">${textoPermiso}</strong></p>
        <div class="acciones-form">
          <button class="btn btn-principal">Guardar</button>
          <button type="button" class="btn" data-a="probar-aviso">Probar aviso</button>
          <button type="button" class="btn" data-a="recordatorios">Ver recordatorios de mañana</button>
          ${permiso === 'default' ? '<button type="button" class="btn" data-a="notificaciones">Permitir notificaciones</button>' : ''}
        </div>
      </form>

      <form class="tarjeta" data-form="mensajes">
        <h2>Mensajes de WhatsApp</h2>
        <p class="texto-suave">Son los mensajes que salen preparados al pulsar <strong>WhatsApp</strong> en una cita o en la ficha de una clienta. Antes de enviarlo siempre se puede cambiar. Las palabras entre corchetes se cambian solas por los datos de cada clienta y cita: toca una para añadirla donde esté el cursor.</p>
        ${Object.keys(ORIGINALES).map((k) => `
          <div class="campo">
            <span>${esc(TITULOS[k])}</span>
            <div class="huecos">${HUECOS[k].map((h) => `<button type="button" class="chip-hueco" data-hueco="${h}" data-para="${k}">${h}</button>`).join('')}</div>
            <textarea name="${k}" rows="4">${esc(leerMensaje(k))}</textarea>
            <button type="button" class="enlace" data-original="${k}">Volver al original</button>
          </div>`).join('')}
        <label class="check"><input type="checkbox" name="al_crear" ${mensajeAlCrear() ? 'checked' : ''}> Al guardar una cita nueva, preparar el mensaje para la clienta (con el enlace para que confirme si viene y la guarde en su calendario)</label>
        <div class="acciones-form"><button class="btn btn-principal">Guardar mensajes</button></div>
      </form>

      <section class="tarjeta">
        <h2>Pasar citas desde Google Calendar</h2>
        <ol class="pasos-importar">
          <li>En el ordenador, entra en <strong>calendar.google.com</strong> con la cuenta de la agenda.</li>
          <li>Rueda dentada ⚙ → <strong>Configuración</strong> → <strong>Importar y exportar</strong> → <strong>Exportar</strong>. Se descarga un archivo <strong>.zip</strong>.</li>
          <li>Pulsa aquí abajo y elige ese archivo (vale el .zip tal cual o el .ics de dentro).</li>
        </ol>
        <p class="texto-suave">Antes de importar verás la lista para revisar la clienta y el servicio de cada cita. No se duplica lo que ya esté en la agenda.</p>
        <div class="acciones-form"><button type="button" class="btn btn-principal" data-a="importar">Elegir archivo de Google Calendar</button></div>
      </section>

      <section class="tarjeta">
        <h2>Cuenta</h2>
        <p>${db.modo === 'demo' ? 'Modo demostración: los datos son de ejemplo y se guardan solo en este navegador.' : `Has entrado como <strong>${esc(cuenta)}</strong>.`}</p>
        <div class="acciones-form">
          <button class="btn" data-a="salir">Cerrar sesión</button>
          ${db.modo === 'demo' ? '<button class="btn btn-peligro-suave" data-a="reiniciar-demo">Borrar datos de ejemplo</button>' : ''}
        </div>
      </section>
      <section class="tarjeta copia">
        <h2>Copia de seguridad</h2>
        <p>Descarga en un archivo <strong>.zip</strong> todos los datos de la app: citas, clientas, servicios, productos, cobros, facturas, cierres de caja, inventario y avisos. Guárdalo en un sitio seguro (correo, Google Drive, un pendrive…). Si algún día hiciera falta, con <strong>Introducir datos</strong> se recupera todo.</p>
        <p class="texto-suave estado-copia">${(() => {
          const u = ultimaCopia();
          if (!u) return 'Todavía no se ha descargado ninguna copia desde este dispositivo.';
          const dias = Math.floor((Date.now() - new Date(u)) / 864e5);
          return `Última copia desde este dispositivo: ${dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`}.${dias > 30 ? ' <strong>Conviene hacer una nueva.</strong>' : ''}`;
        })()}</p>
        <div class="acciones-form">
          <button type="button" class="btn btn-principal" data-a="descargar-datos">Descargar datos</button>
          <button type="button" class="btn" data-a="introducir-datos">Introducir datos</button>
        </div>
        <p class="texto-suave">Para guardarla fuera de este dispositivo:</p>
        <div class="acciones-form envio-copia">
          <button type="button" class="btn" data-enviar="drive">Enviar a Drive</button>
          <button type="button" class="btn" data-enviar="email">Enviar por email</button>
          <button type="button" class="btn btn-whatsapp" data-enviar="whatsapp">Enviar por WhatsApp</button>
        </div>
      </section>
      <p class="texto-suave version">Manely Belleza · versión alfa 0.10</p>
    </section>`;

  el.querySelector('[data-form="negocio"]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { cargando(true); await db.guardarNegocio(datosFormulario(e.target)); aviso('Datos del centro guardados'); }
    catch (err) { errorAviso(err); } finally { cargando(false); }
  });
  el.querySelector('[data-form="dispositivo"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = datosFormulario(e.target);
    if (d.cierre <= d.apertura) return aviso('La hora de cierre tiene que ser posterior a la de apertura.', 'error');
    guardarAjustes({ apertura: d.apertura, cierre: d.cierre, bloqueo: Number(d.bloqueo), llamadas: d.llamadas });
    fijarMinutosBloqueo(d.bloqueo);
    aviso('Ajustes guardados');
  });
  const fm = el.querySelector('[data-form="mensajes"]');
  fm.addEventListener('click', (e) => {
    const h = e.target.closest('[data-hueco]');
    if (h) {
      const ta = fm.elements[h.dataset.para];
      const i = ta.selectionStart ?? ta.value.length, j = ta.selectionEnd ?? i;
      ta.value = ta.value.slice(0, i) + h.dataset.hueco + ta.value.slice(j);
      ta.focus(); ta.setSelectionRange(i + h.dataset.hueco.length, i + h.dataset.hueco.length);
    }
    const o = e.target.closest('[data-original]');
    if (o) fm.elements[o.dataset.original].value = ORIGINALES[o.dataset.original];
  });
  fm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      cargando(true);
      fijarMensajeAlCrear(fm.elements.al_crear.checked);
      const r = await guardarMensajes(Object.fromEntries(Object.keys(ORIGINALES).map((k) => [k, fm.elements[k].value])));
      aviso(r === 'todos' ? 'Mensajes guardados para todos los dispositivos' : 'Mensajes guardados en este dispositivo (falta ejecutar supabase/007_mensajes.sql para que sean iguales en todos)', r === 'todos' ? 'ok' : 'error');
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  });
  el.querySelector('[data-form="avisos"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = datosFormulario(e.target);
    guardarAjustesAvisos({ activos: d.activos, sonido: d.sonido, recordatorioDiario: d.recordatorioDiario });
    aviso('Avisos guardados');
  });
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'probar-aviso') probar();
    if (a === 'recordatorios') { const r = await import('../recordatorios.js'); r.recordatoriosDeManana({ automatico: false }); }
    if (a === 'descargar-datos') { if (await descargarCopia()) render(el, { cuenta, alSalir }); }
    if (a === 'introducir-datos') introducirCopia();
    const enviar = e.target.closest('[data-enviar]')?.dataset.enviar;
    if (enviar) { await enviarCopia(enviar); render(el, { cuenta, alSalir }); }
    if (a === 'notificaciones') {
      const r = await pedirPermisoNotificaciones();
      aviso(r === 'granted' ? 'Notificaciones permitidas' : 'No se han permitido las notificaciones', r === 'granted' ? 'ok' : 'error');
      return render(el, { cuenta, alSalir });
    }
    if (a === 'pin') { await cambiarPin(cuenta); aviso('PIN cambiado'); }
    if (a === 'importar') elegirArchivo();
    if (a === 'bloquear') bloquearYa();
    if (a === 'salir' && await confirmar('¿Cerrar sesión?', { detalle: 'Para volver a entrar necesitarás el email y la contraseña.', si: 'Cerrar sesión' })) alSalir();
    if (a === 'reiniciar-demo' && await confirmar('¿Borrar los datos de ejemplo?', { detalle: 'Se volverán a crear los datos de ejemplo iniciales.', si: 'Borrar', peligro: true })) {
      try { localStorage.removeItem('mb_demo_v1'); } catch { /* */ }
      location.reload();
    }
  });
}

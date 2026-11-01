// Ajustes: datos del centro, horario, PIN y sesión
import * as db from '../db.js';
import { esc, aviso, errorAviso, cargando, datosFormulario, confirmar } from '../util.js';
import { leerAjustes, guardarAjustes } from '../ajustes.js';
import { cambiarPin, fijarMinutosBloqueo, bloquearYa } from '../pin.js';
import { elegirArchivo } from '../importar.js';
import { ajustesAvisos, guardarAjustesAvisos, probar, notificacionesPosibles, pedirPermisoNotificaciones, textoMinutosAntes } from '../avisos.js';

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
        <div class="fila-3">
          <label class="campo"><span>La agenda empieza a las</span><input type="time" name="apertura" step="1800" value="${esc(aj.apertura)}"></label>
          <label class="campo"><span>y termina a las</span><input type="time" name="cierre" step="1800" value="${esc(aj.cierre)}"></label>
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
        <h2>Avisos de la Secretaria y de las citas</h2>
        <p class="texto-suave">Suenan mientras la app está abierta, aunque esté en segundo plano o con otra pestaña delante. Si está cerrada del todo, el aviso sale al abrirla. Conviene dejarla abierta en la tablet del salón.</p>
        <div class="fila-3">
          <label class="check"><input type="checkbox" name="activos" ${av.activos ? 'checked' : ''}> Avisar en este dispositivo</label>
          <label class="check"><input type="checkbox" name="sonido" ${av.sonido ? 'checked' : ''}> Con sonido</label>
          <label class="campo"><span>Aviso en las citas nuevas</span>
            <select name="citaPorDefecto">${[null, 5, 10, 15, 30, 45, 60, 120, 1440].map((m) => `<option value="${m ?? ''}" ${String(av.citaPorDefecto ?? '') === String(m ?? '') ? 'selected' : ''}>${textoMinutosAntes(m)}</option>`).join('')}</select></label>
        </div>
        <p class="texto-suave">Notificaciones del sistema (para verlas con la app en segundo plano): <strong class="estado-permiso">${textoPermiso}</strong></p>
        <div class="acciones-form">
          <button class="btn btn-principal">Guardar</button>
          <button type="button" class="btn" data-a="probar-aviso">Probar aviso</button>
          ${permiso === 'default' ? '<button type="button" class="btn" data-a="notificaciones">Permitir notificaciones</button>' : ''}
        </div>
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
      <p class="texto-suave version">Manely Belleza · versión alfa 0.6</p>
    </section>`;

  el.querySelector('[data-form="negocio"]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { cargando(true); await db.guardarNegocio({ ...n, ...datosFormulario(e.target) }); aviso('Datos del centro guardados'); }
    catch (err) { errorAviso(err); } finally { cargando(false); }
  });
  el.querySelector('[data-form="dispositivo"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = datosFormulario(e.target);
    if (d.cierre <= d.apertura) return aviso('La hora de cierre tiene que ser posterior a la de apertura.', 'error');
    guardarAjustes({ apertura: d.apertura, cierre: d.cierre, bloqueo: Number(d.bloqueo) });
    fijarMinutosBloqueo(d.bloqueo);
    aviso('Ajustes guardados');
  });
  el.querySelector('[data-form="avisos"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = datosFormulario(e.target);
    guardarAjustesAvisos({ activos: d.activos, sonido: d.sonido, citaPorDefecto: d.citaPorDefecto === '' ? null : Number(d.citaPorDefecto) });
    aviso('Avisos guardados');
  });
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'probar-aviso') probar();
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

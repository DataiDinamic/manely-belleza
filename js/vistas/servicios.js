// Catálogo de servicios
import * as db from '../db.js';
import { esc, euros, abrirHoja, aviso, errorAviso, cargando, datosFormulario, confirmar, campoDuracion, leerDuracion } from '../util.js';
import { confirmarConPin } from '../pin.js';
import { duracionTexto } from '../fechas.js';

export async function render(el) {
  el.innerHTML = `
    <section aria-labelledby="tituloServicios">
      <header class="barra">
        <h1 id="tituloServicios" class="barra-titulo">Servicios</h1>
        <button class="btn btn-principal" data-nuevo>Nuevo servicio</button>
      </header>
      <p class="texto-suave intro">Precios con IVA incluido. Cambiar un precio no modifica las citas ya apuntadas.</p>
      <div class="servicios-lista"><p class="cargando-texto">Cargando…</p></div>
    </section>`;

  let servicios = [];
  try { servicios = await db.listarServicios({ todos: true }); }
  catch (e) { errorAviso(e, 'No se pudieron cargar los servicios'); }

  const categorias = {};
  for (const s of servicios) (categorias[s.categoria || 'Otros'] ||= []).push(s);
  const zona = el.querySelector('.servicios-lista');
  zona.innerHTML = Object.keys(categorias).length ? Object.entries(categorias).map(([cat, lista]) => `
    <section class="grupo-servicios">
      <h2>${esc(cat)}</h2>
      <ul>${lista.map((s) => `
        <li><button class="fila-servicio ${s.activo === false ? 'inactivo' : ''}" data-id="${s.id}">
          <span class="fs-nombre">${esc(s.nombre)}${s.activo === false ? ' <em>(no se ofrece)</em>' : ''}</span>
          <span class="fs-dur">${duracionTexto(s.duracion_min)}</span>
          <span class="fs-precio">${euros(s.precio)}</span>
        </button></li>`).join('')}</ul>
    </section>`).join('')
    : '<div class="vacio"><p>Crea tus servicios con su duración y precio para elegirlos al apuntar citas.</p></div>';

  const cats = Object.keys(categorias);
  el.querySelector('[data-nuevo]').addEventListener('click', () => formulario(null, cats, () => render(el)));
  zona.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) formulario(servicios.find((s) => s.id === b.dataset.id), cats, () => render(el));
  });
}

function formulario(s, categorias, alGuardar) {
  const nuevo = !s;
  s = s || { duracion_min: 30, precio: '', iva_pct: 21, activo: true };
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">${nuevo ? 'Nuevo servicio' : 'Editar servicio'}</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <label class="campo"><span>Nombre</span><input name="nombre" required autofocus value="${esc(s.nombre || '')}"></label>
        <label class="campo"><span>Categoría</span>
          <input name="categoria" list="listaCategorias" value="${esc(s.categoria || '')}" placeholder="Manos, Pies, Mirada…">
          <datalist id="listaCategorias">${categorias.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <div class="fila-3">
          ${campoDuracion('dur', s.duracion_min)}
          <label class="campo"><span>Precio (€)</span><input name="precio" inputmode="decimal" value="${esc(s.precio)}" placeholder="0,00"></label>
          <label class="campo"><span>IVA (%)</span><input name="iva_pct" type="number" min="0" max="21" step="1" value="${esc(s.iva_pct ?? 21)}"></label>
        </div>
        <label class="campo"><span>Descripción (opcional)</span><textarea name="descripcion" rows="2">${esc(s.descripcion || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="activo" ${s.activo !== false ? 'checked' : ''}> Se ofrece actualmente</label>
      </div>
      <footer class="hoja-pie">
        ${nuevo ? '' : '<button type="button" class="btn btn-peligro-suave pie-izquierda" data-eliminar>Eliminar</button>'}
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${nuevo ? 'Crear servicio' : 'Guardar cambios'}</button>
      </footer>
    </form>`);
  const form = el.querySelector('form');

  el.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
    try {
      cargando(true);
      const usos = await db.usosServicio(s.id);
      cargando(false);
      if (usos > 0) {
        // Ya está en citas: no se borra, se propone dejar de ofrecerlo
        const ok = await confirmar('Este servicio no se puede eliminar', {
          detalle: `Aparece en ${usos} ${usos === 1 ? 'cita' : 'citas'}. Puedes dejar de ofrecerlo: no saldrá al crear citas nuevas y el historial no cambia.`,
          si: 'Dejar de ofrecerlo', no: 'Cancelar',
        });
        if (!ok) return;
        cargando(true);
        await db.guardarServicio({ ...s, activo: false });
        aviso('Servicio desactivado');
        cerrar(); alGuardar();
        return;
      }
      const ok = await confirmarConPin({
        titulo: 'Eliminar servicio',
        texto: `«${s.nombre}» se borrará para siempre. Escribe tu PIN para confirmarlo.`,
      });
      if (!ok) return;
      cargando(true);
      await db.eliminarServicio(s.id);
      aviso('Servicio eliminado');
      cerrar(); alGuardar();
    } catch (err) { errorAviso(err, 'No se pudo eliminar'); }
    finally { cargando(false); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(form);
    delete d.dur_h; delete d.dur_m;
    d.duracion_min = leerDuracion(form, 'dur');
    if (!d.nombre) return aviso('Escribe el nombre del servicio.', 'error');
    if (d.duracion_min < 5) return aviso('Pon la duración (horas y minutos).', 'error');
    try {
      cargando(true);
      await db.guardarServicio({ ...s, ...d, id: s.id });
      aviso(nuevo ? 'Servicio creado' : 'Servicio guardado');
      cerrar();
      alGuardar();
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

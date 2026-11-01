// Productos a la venta (esmaltes, cremas…)
import * as db from '../db.js';
import { esc, euros, abrirHoja, aviso, errorAviso, cargando, datosFormulario, confirmar } from '../util.js';
import { confirmarConPin } from '../pin.js';

export async function render(el) {
  el.innerHTML = `
    <section aria-labelledby="tituloProductos">
      <header class="barra">
        <h1 id="tituloProductos" class="barra-titulo">Productos</h1>
        <button class="btn btn-principal" data-nuevo>Nuevo producto</button>
      </header>
      <p class="texto-suave intro">Lo que se vende en el centro. Precios con IVA incluido. Si indicas el stock, la app lo descuenta en cada venta.</p>
      <div class="servicios-lista"><p class="cargando-texto">Cargando…</p></div>
    </section>`;

  let productos = [];
  try { productos = await db.listarProductos({ todos: true }); }
  catch (e) { errorAviso(e, 'No se pudieron cargar los productos'); }

  const categorias = {};
  for (const p of productos) (categorias[p.categoria || 'Otros'] ||= []).push(p);
  const stockTxt = (p) => {
    if (p.stock === null || p.stock === undefined) return '';
    if (p.stock <= 0) return '<span class="stock stock-0">Agotado</span>';
    if (p.stock <= 2) return `<span class="stock stock-bajo">Quedan ${p.stock}</span>`;
    return `<span class="stock">${p.stock} en stock</span>`;
  };
  const zona = el.querySelector('.servicios-lista');
  zona.innerHTML = productos.length ? Object.entries(categorias).map(([cat, lista]) => `
    <section class="grupo-servicios">
      <h2>${esc(cat)}</h2>
      <ul>${lista.map((p) => `
        <li><button class="fila-servicio ${p.activo === false ? 'inactivo' : ''}" data-id="${p.id}">
          <span class="fs-nombre">${esc(p.nombre)}${p.marca ? ` <small class="texto-suave">${esc(p.marca)}</small>` : ''}${p.activo === false ? ' <em>(no se vende)</em>' : ''}</span>
          <span class="fs-dur">${stockTxt(p)}</span>
          <span class="fs-precio">${euros(p.precio)}</span>
        </button></li>`).join('')}</ul>
    </section>`).join('')
    : '<div class="vacio"><p>Añade los productos que vendes para poder cobrarlos junto a las citas o como venta suelta.</p></div>';

  const cats = Object.keys(categorias);
  el.querySelector('[data-nuevo]').addEventListener('click', () => formulario(null, cats, () => render(el)));
  zona.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) formulario(productos.find((p) => p.id === b.dataset.id), cats, () => render(el));
  });
}

function formulario(p, categorias, alGuardar) {
  const nuevo = !p;
  p = p || { precio: '', iva_pct: 21, activo: true, stock: null };
  const controla = p.stock !== null && p.stock !== undefined;
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">${nuevo ? 'Nuevo producto' : 'Editar producto'}</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <label class="campo"><span>Nombre</span><input name="nombre" required autofocus value="${esc(p.nombre || '')}" placeholder="Ej.: Esmalte semipermanente rojo"></label>
        <div class="fila-2">
          <label class="campo"><span>Marca</span><input name="marca" value="${esc(p.marca || '')}"></label>
          <label class="campo"><span>Categoría</span>
            <input name="categoria" list="listaCatProd" value="${esc(p.categoria || '')}" placeholder="Esmaltes, Cuidado…">
            <datalist id="listaCatProd">${categorias.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        </div>
        <div class="fila-3">
          <label class="campo"><span>Precio de venta (€)</span><input name="precio" inputmode="decimal" value="${esc(String(p.precio ?? '').replace('.', ','))}" placeholder="0,00"></label>
          <label class="campo"><span>IVA (%)</span><input name="iva_pct" type="number" min="0" max="21" step="1" value="${esc(p.iva_pct ?? 21)}"></label>
          <label class="campo"><span>Coste (opcional)</span><input name="coste" inputmode="decimal" value="${esc(String(p.coste ?? '').replace('.', ','))}" placeholder="Lo que te cuesta"></label>
        </div>
        <label class="check"><input type="checkbox" name="controla" ${controla ? 'checked' : ''}> Controlar el stock de este producto</label>
        <label class="campo campo-stock" ${controla ? '' : 'hidden'}><span>Unidades en stock</span>
          <input name="stock" type="number" step="1" inputmode="numeric" value="${controla ? p.stock : ''}"></label>
        <label class="campo"><span>Código de barras (opcional)</span><input name="codigo" value="${esc(p.codigo || '')}"></label>
        <label class="check"><input type="checkbox" name="activo" ${p.activo !== false ? 'checked' : ''}> Se vende actualmente</label>
      </div>
      <footer class="hoja-pie">
        ${nuevo ? '' : '<button type="button" class="btn btn-peligro-suave pie-izquierda" data-eliminar>Eliminar</button>'}
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${nuevo ? 'Crear producto' : 'Guardar cambios'}</button>
      </footer>
    </form>`);
  const form = el.querySelector('form');
  form.elements.controla.addEventListener('change', (e) => {
    form.querySelector('.campo-stock').hidden = !e.target.checked;
    if (e.target.checked) form.elements.stock.focus();
  });

  el.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
    try {
      cargando(true);
      const usos = await db.usosProducto(p.id);
      cargando(false);
      if (usos > 0) {
        const ok = await confirmar('Este producto no se puede eliminar', {
          detalle: `Aparece en ${usos} ${usos === 1 ? 'venta' : 'ventas'}. Puedes dejar de venderlo: no saldrá al cobrar y el historial no cambia.`,
          si: 'Dejar de venderlo', no: 'Cancelar',
        });
        if (!ok) return;
        cargando(true);
        await db.guardarProducto({ ...p, activo: false });
        aviso('Producto desactivado'); cerrar(); alGuardar();
        return;
      }
      const ok = await confirmarConPin({ titulo: 'Eliminar producto', texto: `«${p.nombre}» se borrará para siempre. Escribe tu PIN para confirmarlo.` });
      if (!ok) return;
      cargando(true);
      await db.eliminarProducto(p.id);
      aviso('Producto eliminado'); cerrar(); alGuardar();
    } catch (err) { errorAviso(err, 'No se pudo eliminar'); } finally { cargando(false); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(form);
    if (!d.nombre) return aviso('Escribe el nombre del producto.', 'error');
    if (!d.controla) d.stock = null;
    else if (d.stock === '') return aviso('Indica cuántas unidades hay, o desmarca «Controlar el stock».', 'error');
    delete d.controla;
    try {
      cargando(true);
      await db.guardarProducto({ ...p, ...d, id: p.id });
      aviso(nuevo ? 'Producto creado' : 'Producto guardado');
      cerrar(); alGuardar();
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

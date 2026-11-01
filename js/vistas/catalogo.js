// Catálogo: servicios y productos (lo que se vende) e inventario (lo que se gasta)
import * as servicios from './servicios.js';
import * as productos from './productos.js';
import * as inventario from './inventario.js';

export async function render(el, sub) {
  const pestana = ['productos', 'inventario'].includes(sub) ? sub : 'servicios';
  el.innerHTML = `
    <nav class="pestanas" aria-label="Catálogo">
      <a href="#catalogo" ${pestana === 'servicios' ? 'aria-current="page"' : ''}>Servicios</a>
      <a href="#catalogo/productos" ${pestana === 'productos' ? 'aria-current="page"' : ''}>Productos</a>
      <a href="#catalogo/inventario" class="pestana-inv" ${pestana === 'inventario' ? 'aria-current="page"' : ''}>Inventario</a>
    </nav>
    <div class="catalogo-zona"></div>`;
  const zona = el.querySelector('.catalogo-zona');
  if (pestana === 'productos') await productos.render(zona);
  else if (pestana === 'inventario') await inventario.render(zona);
  else await servicios.render(zona);
}

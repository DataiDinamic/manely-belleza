// Catálogo: servicios y productos, con pestañas
import * as servicios from './servicios.js';
import * as productos from './productos.js';

export async function render(el, sub) {
  const esProd = sub === 'productos';
  el.innerHTML = `
    <nav class="pestanas" aria-label="Catálogo">
      <a href="#catalogo" ${esProd ? '' : 'aria-current="page"'}>Servicios</a>
      <a href="#catalogo/productos" ${esProd ? 'aria-current="page"' : ''}>Productos</a>
    </nav>
    <div class="catalogo-zona"></div>`;
  const zona = el.querySelector('.catalogo-zona');
  if (esProd) await productos.render(zona);
  else await servicios.render(zona);
}

// Inventario: material que se gasta y no se cobra (algodones, acetona, guantes…)
import * as db from '../db.js';
import { esc, euros, abrirHoja, aviso, errorAviso, cargando, datosFormulario, confirmar } from '../util.js';
import { hoyISO, sumarDias, primeroDeMes, textoDiaCorto } from '../fechas.js';
import { confirmarConPin } from '../pin.js';

export const UNIDADES = { ud: 'unidades', g: 'gramos', kg: 'kilos', ml: 'mililitros', l: 'litros' };
const CORTA = { ud: 'ud', g: 'g', kg: 'kg', ml: 'ml', l: 'l' };
const numero = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const fmtN = (n, dec = 2) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec }).format(Number(n) || 0);
export const cantidad = (n, u) => `${fmtN(n, u === 'ud' ? 0 : 2)} ${CORTA[u] || u}`;

// Precio comparable entre marcas: €/ud, €/kg o €/l
export function precioBase(c) {
  const porUnidad = c.precio_envase / c.contenido_envase;
  if (c.unidad === 'g') return { valor: porUnidad * 1000, etiqueta: '€/kg', dim: 'peso' };
  if (c.unidad === 'kg') return { valor: porUnidad, etiqueta: '€/kg', dim: 'peso' };
  if (c.unidad === 'ml') return { valor: porUnidad * 1000, etiqueta: '€/l', dim: 'volumen' };
  if (c.unidad === 'l') return { valor: porUnidad, etiqueta: '€/l', dim: 'volumen' };
  return { valor: porUnidad, etiqueta: '€/ud', dim: 'ud' };
}
const textoPrecioBase = (c) => {
  const p = precioBase(c);
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: p.valor < 1 ? 3 : 2 }).format(p.valor)} ${p.etiqueta}`;
};
const bajo = (c) => c.activo !== false && c.stock_actual <= c.stock_minimo;

let filtro = 'todo';
let busqueda = '';

export async function render(el) {
  el.innerHTML = `
    <section aria-labelledby="tituloInv">
      <header class="barra">
        <h1 id="tituloInv" class="barra-titulo">Inventario</h1>
        <button class="btn" data-lista>Lista de la compra</button>
        <button class="btn btn-principal" data-nuevo>Nuevo artículo</button>
      </header>
      <p class="texto-suave intro">Material que se gasta y no se cobra: algodones, acetona, guantes… Apunta lo que usas y lo que compras para saber cuánto gastas y qué marca sale mejor.</p>
      <div class="inv-cuerpo"><p class="cargando-texto">Cargando…</p></div>
    </section>`;

  let articulos = [], movs = [];
  const hoy = hoyISO();
  const hace90 = sumarDias(hoy, -90);
  try { [articulos, movs] = await Promise.all([db.listarConsumibles(), db.movimientosInventario({ desde: hace90 })]); }
  catch (e) { el.querySelector('.inv-cuerpo').innerHTML = '<div class="vacio"><p>No se pudo cargar el inventario.</p></div>'; return errorAviso(e, 'Error'); }

  // Estadísticas
  const mes = primeroDeMes(hoy);
  const esGasto = (m) => m.tipo === 'uso' || (m.tipo === 'ajuste' && m.cantidad < 0);
  const gastoMes = movs.filter((m) => m.fecha >= mes && esGasto(m)).reduce((a, m) => a + (m.coste || 0), 0);
  const comprasMes = movs.filter((m) => m.fecha >= mes && m.tipo === 'compra').reduce((a, m) => a + (m.coste || 0), 0);
  const valorStock = articulos.filter((c) => c.activo !== false).reduce((a, c) => a + Math.max(0, c.stock_actual) * c.precio_envase / c.contenido_envase, 0);
  const porComprar = articulos.filter(bajo);
  const consumo = {};   // por artículo, últimos 90 días
  for (const m of movs) if (esGasto(m)) {
    const x = (consumo[m.consumible_id] ||= { cant: 0, coste: 0, mes: 0 });
    x.cant += Math.abs(m.cantidad); x.coste += m.coste || 0;
    if (m.fecha >= mes) x.mes += m.coste || 0;
  }

  const zona = el.querySelector('.inv-cuerpo');
  function pintar() {
    const q = busqueda.toLowerCase();
    const lista = articulos.filter((c) => (filtro === 'todo' ? c.activo !== false || q : bajo(c))
      && (!q || `${c.nombre} ${c.marca || ''} ${c.categoria || ''} ${c.proveedor || ''}`.toLowerCase().includes(q)));
    const grupos = {};
    for (const c of lista) (grupos[c.categoria || 'Sin categoría'] ||= []).push(c);

    zona.innerHTML = `
      <div class="inv-resumen">
        <div><dt>Gastado este mes</dt><dd>${euros(gastoMes)}</dd><small>material usado</small></div>
        <div><dt>Comprado este mes</dt><dd>${euros(comprasMes)}</dd><small>reposiciones</small></div>
        <div><dt>Valor del stock</dt><dd>${euros(valorStock)}</dd><small>lo que hay en el almacén</small></div>
        <div class="${porComprar.length ? 'alerta' : ''}"><dt>Por comprar</dt><dd>${porComprar.length}</dd><small>${porComprar.length ? 'por debajo del mínimo' : 'todo en orden'}</small></div>
      </div>
      <div class="buscar-fila">
        <input type="search" class="buscar" placeholder="Buscar material" value="${esc(busqueda)}" aria-label="Buscar en el inventario">
        <div class="segmentos" role="group" aria-label="Filtro">
          <button data-filtro="todo" aria-pressed="${filtro === 'todo'}">Todo</button>
          <button data-filtro="comprar" aria-pressed="${filtro === 'comprar'}">Por comprar</button>
        </div>
      </div>
      ${Object.keys(grupos).length ? Object.entries(grupos).map(([cat, arts]) => {
        // Comparativa de marcas: el mismo artículo (mismo nombre) de marcas distintas
        let comparativa = '';
        const nombreBase = (c) => c.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const porArticulo = {};
        for (const c of arts) if (c.activo !== false) (porArticulo[`${nombreBase(c)}|${precioBase(c).dim}`] ||= []).push(c);
        for (const lista2 of Object.values(porArticulo)) {
          if (lista2.length < 2) continue;
          const orden = [...lista2].sort((a, b) => precioBase(a).valor - precioBase(b).valor);
          const mejor = orden[0], peor = orden.at(-1);
          const ahorro = Math.round((1 - precioBase(mejor).valor / precioBase(peor).valor) * 100);
          comparativa += `<p class="comparativa">${esc(mejor.nombre)}: sale más barata <strong>${esc(mejor.marca || 'sin marca')}</strong> (${textoPrecioBase(mejor)})${ahorro > 0 ? `, un ${ahorro}% menos que ${esc(peor.marca || 'la otra')} (${textoPrecioBase(peor)})` : ''}</p>`;
        }
        return `<section class="grupo-servicios">
          <h2>${esc(cat)}</h2>${comparativa}
          <ul class="lista-inv">${arts.map((c) => {
            const pct = c.stock_minimo > 0 ? Math.min(100, Math.max(0, c.stock_actual / (c.stock_minimo * 2) * 100)) : (c.stock_actual > 0 ? 100 : 0);
            const cons = consumo[c.id];
            return `<li class="fila-inv ${bajo(c) ? 'bajo' : ''} ${c.activo === false ? 'inactivo' : ''}">
              <button class="inv-info" data-ficha="${c.id}">
                <strong>${esc(c.nombre)}</strong>
                <small>${[c.marca, c.proveedor].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</small>
                <span class="inv-stock"><b>${cantidad(c.stock_actual, c.unidad)}</b>
                  <i class="barra-stock" aria-hidden="true"><i style="width:${pct}%"></i></i>
                  ${bajo(c) ? '<em>Comprar</em>' : ''}</span>
              </button>
              <div class="inv-datos">
                <span>${textoPrecioBase(c)}</span>
                <small>${cons ? `${cantidad(cons.cant / 3, c.unidad)}/mes` : 'sin consumo aún'}</small>
              </div>
              <div class="inv-acciones">
                <button class="btn btn-mini" data-usar="${c.id}">Usar</button>
                <button class="btn btn-mini" data-comprar="${c.id}">Comprar</button>
              </div>
            </li>`;
          }).join('')}</ul></section>`;
      }).join('') : `<div class="vacio"><p>${filtro === 'comprar' ? 'No falta nada: todo está por encima del mínimo.' : 'Añade el material que usas (algodones, acetona, guantes…) con su envase y precio.'}</p></div>`}`;
  }
  pintar();

  const recargar = () => render(el);
  const art = (id) => articulos.find((c) => c.id === id);
  el.querySelector('[data-nuevo]').addEventListener('click', () => formulario(null, articulos, recargar));
  el.querySelector('[data-lista]').addEventListener('click', () => listaCompra(articulos));
  zona.addEventListener('input', (e) => { if (e.target.classList.contains('buscar')) { busqueda = e.target.value; const pos = e.target.selectionStart; pintar(); const b = zona.querySelector('.buscar'); b.focus(); b.setSelectionRange(pos, pos); } });
  zona.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.filtro) { filtro = b.dataset.filtro; return pintar(); }
    if (b.dataset.usar) return movimiento('uso', art(b.dataset.usar), recargar);
    if (b.dataset.comprar) return movimiento('compra', art(b.dataset.comprar), recargar);
    if (b.dataset.ficha) return ficha(art(b.dataset.ficha), articulos, recargar);
  });
}

// ---------------------------------------------------------------------
// Ficha de un artículo: datos, consumo y movimientos
// ---------------------------------------------------------------------
async function ficha(c, articulos, alCambiar) {
  let movs = [];
  try { movs = await db.movimientosInventario({ consumibleId: c.id }); } catch (e) { return errorAviso(e); }
  const hoy = hoyISO();
  const usos90 = movs.filter((m) => m.fecha >= sumarDias(hoy, -90) && (m.tipo === 'uso' || (m.tipo === 'ajuste' && m.cantidad < 0)));
  const cant90 = usos90.reduce((a, m) => a + Math.abs(m.cantidad), 0);
  const coste90 = usos90.reduce((a, m) => a + (m.coste || 0), 0);
  const diario = cant90 / 90;
  const dias = diario > 0 ? Math.floor(c.stock_actual / diario) : null;
  const TIPOS = { compra: 'Compra', uso: 'Uso', ajuste: 'Recuento' };

  const { el, cerrar } = abrirHoja(`
    <header class="hoja-cabecera">
      <div>
        <h2 class="hoja-titulo">${esc(c.nombre)}</h2>
        <p class="texto-suave">${[c.marca, c.categoria, c.proveedor].filter(Boolean).map(esc).join(' · ')}</p>
      </div>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo">
      <dl class="cifras inv-cifras">
        <div><dt>Queda</dt><dd>${cantidad(c.stock_actual, c.unidad)}</dd><small>${fmtN(c.stock_actual / c.contenido_envase, 1)} envases</small></div>
        <div><dt>Envase</dt><dd>${cantidad(c.contenido_envase, c.unidad)}</dd><small>${euros(c.precio_envase)}</small></div>
        <div><dt>Precio</dt><dd>${textoPrecioBase(c)}</dd><small>para comparar marcas</small></div>
        <div><dt>Consumo</dt><dd>${cant90 ? `${cantidad(cant90 / 3, c.unidad)}/mes` : '—'}</dd><small>${cant90 ? `${euros(coste90 / 3)} al mes` : 'aún sin datos'}</small></div>
      </dl>
      ${dias !== null ? `<p class="${bajo(c) ? 'aviso-texto' : 'texto-suave'}">Al ritmo actual queda para unos <strong>${dias} días</strong>.</p>` : ''}
      ${bajo(c) ? `<p class="aviso-texto">Está por debajo del mínimo (${cantidad(c.stock_minimo, c.unidad)}): aparece en la lista de la compra.</p>` : ''}
      <h3 class="inv-subtitulo">Movimientos</h3>
      ${movs.length ? `<ul class="lista-movs">${movs.slice(0, 40).map((m) => `
        <li><span class="mov-tipo mov-${m.tipo}">${TIPOS[m.tipo]}</span>
          <time>${esc(textoDiaCorto(m.fecha))}</time>
          <b>${m.cantidad > 0 ? '+' : ''}${cantidad(m.cantidad, c.unidad)}</b>
          <span>${m.coste != null && (m.tipo !== 'ajuste' || m.cantidad < 0) ? euros(m.coste) : ''}</span>
          <small>${esc(m.notas || m.proveedor || '')}</small>
          <button class="btn-icono mov-borrar" data-borrar="${m.id}" aria-label="Borrar este movimiento">✕</button></li>`).join('')}</ul>`
        : '<p class="texto-suave">Todavía no hay movimientos.</p>'}
    </div>
    <footer class="hoja-pie acciones-cita">
      <button class="btn btn-principal" data-a="usar">Usar</button>
      <button class="btn" data-a="comprar">Comprar</button>
      <button class="btn" data-a="recontar">Recontar</button>
      <button class="btn" data-a="editar">Editar</button>
    </footer>`, { ancho: 'ancha' });

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) {
      cerrar();
      if (a === 'usar') return movimiento('uso', c, alCambiar);
      if (a === 'comprar') return movimiento('compra', c, alCambiar);
      if (a === 'recontar') return movimiento('ajuste', c, alCambiar);
      if (a === 'editar') return formulario(c, articulos, alCambiar);
    }
    const borrar = e.target.closest('[data-borrar]');
    if (borrar) {
      const ok = await confirmar('¿Borrar este movimiento?', { detalle: 'El stock se recalculará como si no se hubiera apuntado.', si: 'Borrar', peligro: true });
      if (!ok) return;
      try { await db.borrarMovimiento(borrar.dataset.borrar); aviso('Movimiento borrado'); cerrar(); alCambiar(); }
      catch (err) { errorAviso(err); }
    }
  });
}

// ---------------------------------------------------------------------
// Usar / Comprar / Recontar
// ---------------------------------------------------------------------
function movimiento(tipo, c, alGuardar) {
  const u = CORTA[c.unidad];
  const precioUnidad = c.precio_envase / c.contenido_envase;
  const rapidos = tipo === 'uso'
    ? (c.unidad === 'ud' ? [1, 2, 5, 10].map((n) => [n, `${n} ud`]) : [[c.contenido_envase / 4, '¼ envase'], [c.contenido_envase / 2, '½ envase'], [c.contenido_envase, '1 envase']])
    : [];
  const titulo = { uso: 'Apuntar lo usado', compra: 'Apuntar una compra', ajuste: 'Recontar el stock' }[tipo];
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <div><h2 class="hoja-titulo">${titulo}</h2><p class="texto-suave">${esc(c.nombre)}${c.marca ? ` · ${esc(c.marca)}` : ''} · quedan ${cantidad(c.stock_actual, c.unidad)}</p></div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        ${tipo === 'uso' ? `
          <label class="campo"><span>Cantidad usada (${UNIDADES[c.unidad]})</span><input name="cantidad" inputmode="decimal" autofocus></label>
          <div class="billetes">${rapidos.map(([v, t]) => `<button type="button" class="btn btn-mini" data-rapido="${v}">${t}</button>`).join('')}</div>` : ''}
        ${tipo === 'compra' ? `
          <div class="fila-2">
            <label class="campo"><span>Envases comprados</span><input name="envases" inputmode="decimal" value="1" autofocus></label>
            <label class="campo"><span>Total pagado (€)</span><input name="coste" inputmode="decimal" value="${String(c.precio_envase).replace('.', ',')}"></label>
          </div>
          <label class="campo"><span>Proveedor</span><input name="proveedor" value="${esc(c.proveedor || '')}"></label>
          <label class="check campo-precio" hidden><input type="checkbox" name="actualizar" checked> <span></span></label>` : ''}
        ${tipo === 'ajuste' ? `
          <label class="campo"><span>¿Cuánto queda ahora de verdad? (${UNIDADES[c.unidad]})</span><input name="real" inputmode="decimal" autofocus value="${fmtN(c.stock_actual)}"></label>` : ''}
        <p class="resultado-cierre" aria-live="polite"></p>
        <div class="fila-2">
          <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${hoyISO()}"></label>
          <label class="campo"><span>Nota (opcional)</span><input name="notas"></label>
        </div>
      </div>
      <footer class="hoja-pie">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">Guardar</button>
      </footer>
    </form>`, { ancho: 'estrecha' });
  const f = el.querySelector('form');
  const out = el.querySelector('.resultado-cierre');
  const calcular = () => {
    if (tipo === 'uso') {
      const q = numero(f.elements.cantidad.value);
      out.innerHTML = q ? `Coste: <strong>${euros(q * precioUnidad)}</strong> · quedarán ${cantidad(c.stock_actual - q, c.unidad)}` : '';
    } else if (tipo === 'compra') {
      const env = numero(f.elements.envases.value);
      const coste = numero(f.elements.coste.value);
      out.innerHTML = env ? `Entran <strong>${cantidad(env * c.contenido_envase, c.unidad)}</strong> · quedarán ${cantidad(c.stock_actual + env * c.contenido_envase, c.unidad)}` : '';
      const nuevoPrecio = env ? Math.round(coste / env * 100) / 100 : 0;
      const campo = el.querySelector('.campo-precio');
      campo.hidden = !env || Math.abs(nuevoPrecio - c.precio_envase) < 0.005;
      campo.querySelector('span').textContent = `Actualizar el precio del envase de ${euros(c.precio_envase)} a ${euros(nuevoPrecio)}`;
    } else {
      const dif = numero(f.elements.real.value) - c.stock_actual;
      out.innerHTML = Math.abs(dif) < 0.0005 ? 'Coincide con lo apuntado.'
        : dif > 0 ? `Hay <strong>${cantidad(dif, c.unidad)}</strong> más de lo apuntado.`
        : `Faltan <strong>${cantidad(-dif, c.unidad)}</strong> (${euros(-dif * precioUnidad)}) respecto a lo apuntado.`;
    }
  };
  f.addEventListener('input', calcular);
  if (tipo === 'compra') f.elements.envases.addEventListener('input', () => {
    f.elements.coste.value = String(Math.round(numero(f.elements.envases.value) * c.precio_envase * 100) / 100).replace('.', ',');
    calcular();
  });
  el.querySelector('.billetes')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rapido]'); if (!b) return;
    f.elements.cantidad.value = fmtN(Number(b.dataset.rapido), 3).replace(/\./g, ''); calcular();
  });
  calcular();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fecha = f.elements.fecha.value || hoyISO();
    const notas = f.elements.notas.value.trim() || null;
    let mov;
    if (tipo === 'uso') {
      const q = numero(f.elements.cantidad.value);
      if (q <= 0) return aviso('Escribe la cantidad usada.', 'error');
      mov = { consumible_id: c.id, fecha, tipo, cantidad: -q, notas };
    } else if (tipo === 'compra') {
      const env = numero(f.elements.envases.value);
      if (env <= 0) return aviso('Escribe cuántos envases has comprado.', 'error');
      mov = { consumible_id: c.id, fecha, tipo, cantidad: env * c.contenido_envase, envases: env, coste: numero(f.elements.coste.value),
        proveedor: f.elements.proveedor.value.trim() || null, notas };
    } else {
      const dif = Math.round((numero(f.elements.real.value) - c.stock_actual) * 1000) / 1000;
      if (Math.abs(dif) < 0.0005) { cerrar(); return aviso('El stock ya coincidía'); }
      mov = { consumible_id: c.id, fecha, tipo, cantidad: dif, notas: notas || 'Recuento', ...(dif > 0 ? { coste: 0 } : {}) };
    }
    try {
      cargando(true);
      await db.registrarMovimiento(mov);
      if (tipo === 'compra' && !el.querySelector('.campo-precio').hidden && f.elements.actualizar.checked) {
        await db.guardarConsumible({ ...c, precio_envase: Math.round(mov.coste / mov.envases * 100) / 100, proveedor: mov.proveedor || c.proveedor });
      }
      aviso({ uso: 'Uso apuntado', compra: 'Compra apuntada', ajuste: 'Stock corregido' }[tipo]);
      cerrar(); alGuardar();
    } catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

// ---------------------------------------------------------------------
// Alta / edición de un artículo
// ---------------------------------------------------------------------
function formulario(c, articulos, alGuardar) {
  const nuevo = !c;
  c = c || { unidad: 'ud', contenido_envase: '', precio_envase: '', stock_minimo: '', activo: true };
  const cats = [...new Set(articulos.map((a) => a.categoria).filter(Boolean))];
  const provs = [...new Set(articulos.map((a) => a.proveedor).filter(Boolean))];
  const { el, cerrar } = abrirHoja(`
    <form novalidate>
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">${nuevo ? 'Nuevo artículo' : 'Editar artículo'}</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <label class="campo"><span>Nombre</span><input name="nombre" required autofocus value="${esc(c.nombre || '')}" placeholder="Ej.: Acetona pura, Algodones, Guantes de nitrilo"></label>
        <div class="fila-3">
          <label class="campo"><span>Marca</span><input name="marca" value="${esc(c.marca || '')}"></label>
          <label class="campo"><span>Categoría</span><input name="categoria" list="invCats" value="${esc(c.categoria || '')}" placeholder="Desechables, Quitaesmalte…">
            <datalist id="invCats">${cats.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
          <label class="campo"><span>Proveedor</span><input name="proveedor" list="invProvs" value="${esc(c.proveedor || '')}">
            <datalist id="invProvs">${provs.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        </div>
        <fieldset class="campo">
          <legend>Se mide en</legend>
          <div class="segmentos unidades" role="radiogroup">
            ${Object.entries(UNIDADES).map(([k, v]) => `<label><input type="radio" name="unidad" value="${k}" ${c.unidad === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}
          </div>
        </fieldset>
        <div class="fila-3">
          <label class="campo"><span>Contenido de un envase (<b data-u>${CORTA[c.unidad]}</b>)</span><input name="contenido_envase" inputmode="decimal" value="${esc(String(c.contenido_envase ?? '').replace('.', ','))}" placeholder="Ej.: 500"></label>
          <label class="campo"><span>Precio de un envase (€)</span><input name="precio_envase" inputmode="decimal" value="${esc(String(c.precio_envase ?? '').replace('.', ','))}"></label>
          <label class="campo"><span>Stock mínimo (<b data-u>${CORTA[c.unidad]}</b>)</span><input name="stock_minimo" inputmode="decimal" value="${esc(String(c.stock_minimo ?? '').replace('.', ','))}" placeholder="Para la lista de la compra"></label>
        </div>
        ${nuevo ? `<label class="campo"><span>¿Cuánto tienes ahora? (<b data-u>${CORTA[c.unidad]}</b>)</span><input name="stock_inicial" inputmode="decimal" placeholder="0"></label>` : ''}
        <p class="precio-calculado texto-suave" aria-live="polite"></p>
        <label class="campo"><span>Notas</span><input name="notas" value="${esc(c.notas || '')}"></label>
        <label class="check"><input type="checkbox" name="activo" ${c.activo !== false ? 'checked' : ''}> Se sigue usando</label>
      </div>
      <footer class="hoja-pie">
        ${nuevo ? '' : '<button type="button" class="btn btn-peligro-suave pie-izquierda" data-eliminar>Eliminar</button>'}
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn btn-principal">${nuevo ? 'Crear artículo' : 'Guardar cambios'}</button>
      </footer>
    </form>`, { ancho: 'ancha' });
  const f = el.querySelector('form');
  const actualizar = () => {
    const u = f.elements.unidad.value;
    el.querySelectorAll('[data-u]').forEach((b) => { b.textContent = CORTA[u]; });
    const cont = numero(f.elements.contenido_envase.value), pre = numero(f.elements.precio_envase.value);
    el.querySelector('.precio-calculado').textContent = cont && pre ? `Sale a ${textoPrecioBase({ unidad: u, contenido_envase: cont, precio_envase: pre })}` : '';
  };
  f.addEventListener('input', actualizar);
  f.addEventListener('change', actualizar);
  actualizar();

  el.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
    const ok = await confirmarConPin({ titulo: 'Eliminar artículo', texto: `«${c.nombre}» y todos sus movimientos se borrarán. Si ya no lo usas, puedes desmarcar «Se sigue usando» en su lugar. Escribe tu PIN para confirmarlo.` });
    if (!ok) return;
    try { cargando(true); await db.eliminarConsumible(c.id); aviso('Artículo eliminado'); cerrar(); alGuardar(); }
    catch (err) { errorAviso(err); } finally { cargando(false); }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(f);
    if (!d.nombre) return aviso('Escribe el nombre.', 'error');
    if (!(numero(d.contenido_envase) > 0)) return aviso('Indica cuánto trae un envase (por ejemplo 500 ml o 100 unidades).', 'error');
    const inicial = d.stock_inicial; delete d.stock_inicial;
    try { cargando(true); await db.guardarConsumible({ ...c, ...d, id: c.id }, inicial); aviso(nuevo ? 'Artículo creado' : 'Artículo guardado'); cerrar(); alGuardar(); }
    catch (err) { errorAviso(err); } finally { cargando(false); }
  });
}

// ---------------------------------------------------------------------
// Lista de la compra
// ---------------------------------------------------------------------
function listaCompra(articulos) {
  const faltan = articulos.filter(bajo);
  const sugerido = (c) => Math.max(1, Math.ceil((c.stock_minimo * 2 - c.stock_actual) / c.contenido_envase));
  const porProv = {};
  for (const c of faltan) (porProv[c.proveedor || 'Sin proveedor'] ||= []).push(c);
  const total = faltan.reduce((a, c) => a + sugerido(c) * c.precio_envase, 0);
  const texto = `Lista de la compra · ${new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date())}\n\n`
    + Object.entries(porProv).map(([p, l]) => `${p}:\n${l.map((c) => `- ${sugerido(c)} × ${c.nombre}${c.marca ? ` (${c.marca})` : ''} · ${cantidad(c.contenido_envase, c.unidad)}`).join('\n')}`).join('\n\n');
  const { el } = abrirHoja(`
    <header class="hoja-cabecera">
      <div><h2 class="hoja-titulo">Lista de la compra</h2>
        <p class="texto-suave">${faltan.length ? `${faltan.length} ${faltan.length === 1 ? 'artículo' : 'artículos'} por debajo del mínimo · aprox. ${euros(total)}` : 'No falta nada'}</p></div>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo">
      ${faltan.length ? Object.entries(porProv).map(([p, l]) => `
        <h3 class="inv-subtitulo">${esc(p)}</h3>
        <ul class="lista-compra">${l.map((c) => `<li><b>${sugerido(c)} ×</b> <span>${esc(c.nombre)}${c.marca ? ` <small>${esc(c.marca)}</small>` : ''}</span>
          <small>quedan ${cantidad(c.stock_actual, c.unidad)} · envase ${cantidad(c.contenido_envase, c.unidad)} · ${euros(c.precio_envase)}</small></li>`).join('')}</ul>`).join('')
        : '<p class="texto-suave">Todo el material está por encima de su mínimo.</p>'}
    </div>
    ${faltan.length ? `<footer class="hoja-pie">
      <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(texto)}">Enviar por WhatsApp</a>
      <button class="btn btn-principal" data-copiar>Copiar lista</button>
    </footer>` : ''}`, { ancho: 'normal' });
  el.querySelector('[data-copiar]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(texto); aviso('Lista copiada'); } catch { aviso('No se pudo copiar', 'error'); }
  });
}

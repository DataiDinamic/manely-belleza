// Agenda: vista de día (con la semana arriba), de semana y de mes
import * as db from '../db.js';
import { esc, euros, nombreCompleto, errorAviso, aviso, confirmar, cargando } from '../util.js';
import { hoyISO, sumarDias, sumarMeses, lunesDe, primeroDeMes, desdeISO, aMinutos, aHora,
  textoDiaLargo, textoMes, inicialDia, minutosAhora } from '../fechas.js';
import { leerAjustes } from '../ajustes.js';
import { abrirFormularioCita, abrirDetalleCita, ESTADOS, textoServicios } from '../citas.js';

const PPM = 1.6;    // píxeles por minuto en la vista de día
const PPM_S = 1.2;  // en la vista de semana (columnas más bajas para ver más horas)
const NOMBRE_VISTA = { dia: 'día', semana: 'semana', mes: 'mes' };

function tituloSemana(fecha) {
  const l = lunesDe(fecha), d = sumarDias(l, 6);
  const fl = desdeISO(l), fd = desdeISO(d);
  const mes = (f) => new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(f).replace('.', '');
  return fl.getMonth() === fd.getMonth()
    ? `${fl.getDate()} – ${fd.getDate()} ${mes(fd)} ${fd.getFullYear()}`
    : `${fl.getDate()} ${mes(fl)} – ${fd.getDate()} ${mes(fd)} ${fd.getFullYear()}`;
}
const CLAVE = 'mb_agenda_estado';
let st = (() => {
  try { return { fecha: hoyISO(), vista: 'dia', anuladas: false, ...JSON.parse(sessionStorage.getItem(CLAVE) || '{}') }; }
  catch { return { fecha: hoyISO(), vista: 'dia', anuladas: false }; }
})();
let contenedor = null;
let relojLinea = null;

const guardarEstado = () => { try { sessionStorage.setItem(CLAVE, JSON.stringify(st)); } catch { /* */ } };
const cuenta = (c) => !['anulada', 'no_presentada'].includes(c.estado);

export async function render(el) {
  contenedor = el;
  clearInterval(relojLinea);
  el.innerHTML = `
    <section class="agenda" aria-labelledby="tituloAgenda">
      <header class="barra">
        <div class="barra-nav">
          <button class="btn-icono" data-ir="-1" aria-label="${NOMBRE_VISTA[st.vista] === 'semana' ? 'Semana anterior' : (st.vista === 'dia' ? 'Día anterior' : 'Mes anterior')}">‹</button>
          <button class="btn btn-mini" data-ir="hoy">Hoy</button>
          <button class="btn-icono" data-ir="1" aria-label="${NOMBRE_VISTA[st.vista] === 'semana' ? 'Semana siguiente' : (st.vista === 'dia' ? 'Día siguiente' : 'Mes siguiente')}">›</button>
        </div>
        <h1 id="tituloAgenda" class="barra-titulo">${st.vista === 'dia' ? esc(textoDiaLargo(st.fecha)) : st.vista === 'semana' ? esc(tituloSemana(st.fecha)) : esc(textoMes(st.fecha))}</h1>
        <div class="segmentos" role="group" aria-label="Vista">
          <button data-vista="dia" aria-pressed="${st.vista === 'dia'}">Día</button>
          <button data-vista="semana" aria-pressed="${st.vista === 'semana'}">Semana</button>
          <button data-vista="mes" aria-pressed="${st.vista === 'mes'}">Mes</button>
        </div>
        <button class="btn btn-principal" data-nueva>Nueva cita</button>
      </header>
      <div class="agenda-cuerpo"><p class="cargando-texto">Cargando agenda…</p></div>
    </section>`;

  el.querySelector('.barra').addEventListener('click', (e) => {
    const ir = e.target.closest('[data-ir]')?.dataset.ir;
    const v = e.target.closest('[data-vista]')?.dataset.vista;
    if (ir) {
      if (ir === 'hoy') st.fecha = hoyISO();
      else if (st.vista === 'dia') st.fecha = sumarDias(st.fecha, Number(ir));
      else if (st.vista === 'semana') st.fecha = sumarDias(st.fecha, 7 * Number(ir));
      else st.fecha = sumarMeses(st.fecha, Number(ir));
      guardarEstado(); render(el);
    } else if (v && v !== st.vista) {
      st.vista = v; guardarEstado(); render(el);
    } else if (e.target.closest('[data-nueva]')) {
      abrirFormularioCita({ fecha: st.fecha, hora: horaSugerida(), alGuardar: alGuardarCita });
    }
  });

  try {
    let info = null;
    if (st.vista === 'dia') info = await pintarDia(el.querySelector('.agenda-cuerpo'));
    else if (st.vista === 'semana') info = await pintarSemana(el.querySelector('.agenda-cuerpo'));
    else await pintarMes(el.querySelector('.agenda-cuerpo'));
    if (pendienteMover && info) { const id = pendienteMover; pendienteMover = null; modoMover(el, id, info); }
  } catch (e) {
    el.querySelector('.agenda-cuerpo').innerHTML = `<div class="vacio"><p>No se pudo cargar la agenda.</p>
      <button class="btn" onclick="location.reload()">Reintentar</button></div>`;
    errorAviso(e, 'Error al cargar');
  }
}

function alGuardarCita(id, datos) {
  if (datos?.fecha) st.fecha = datos.fecha;
  guardarEstado();
  if (contenedor && location.hash.startsWith('#agenda')) render(contenedor);
  else if (contenedor) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
// Tras editar o mover desde el detalle, la agenda salta al día de la cita
const refrescar = (id, datos) => alGuardarCita(id, datos);

function horaSugerida() {
  const { apertura } = leerAjustes();
  if (st.fecha !== hoyISO()) return apertura;
  const m = Math.ceil(minutosAhora() / 15) * 15;
  return aHora(Math.max(m, aMinutos(apertura)));
}

// Reparte en columnas las citas que se pisan (marca _col y _cols)
function enCarriles(citas) {
  const ordenadas = [...citas].sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
  const grupos = [];
  for (const c of ordenadas) {
    const g = grupos.at(-1);
    if (g && c.inicio < g.fin) { g.citas.push(c); g.fin = Math.max(g.fin, c.fin); }
    else grupos.push({ fin: c.fin, citas: [c] });
  }
  const bloques = [];
  for (const g of grupos) {
    const columnas = [];
    for (const c of g.citas) {
      let col = columnas.findIndex((finCol) => finCol <= c.inicio);
      if (col === -1) { col = columnas.length; columnas.push(0); }
      columnas[col] = c.fin;
      c._col = col;
    }
    for (const c of g.citas) c._cols = columnas.length;
    bloques.push(...g.citas);
  }
  return bloques;
}

function htmlBloque(c, ini, ppm, { semana = false } = {}) {
  const alturaPx = Math.max(c.duracion_min * ppm, semana ? 22 : 26);
  const compacto = alturaPx < (semana ? 44 : 56);
  return `<button class="cita-bloque estado-${c.estado} ${compacto ? 'compacto' : ''} ${c.cobrada ? 'cobrada' : ''}" data-cita="${c.id}"
    style="--esmalte:${esc(c.clienta?.color || '#B5838D')};top:${(c.inicio - ini) * ppm}px;height:${alturaPx}px;
           left:calc(${(c._col / c._cols) * 100}% + 2px);width:calc(${100 / c._cols}% - 4px)"
    aria-label="${c.hora} ${esc(nombreCompleto(c.clienta))}, ${esc(textoServicios(c))}, ${ESTADOS[c.estado]}">
    <span class="cb-hora">${c.hora}</span>
    <span class="cb-nombre">${esc(semana ? (c.clienta?.nombre || '') : nombreCompleto(c.clienta))}</span>
    ${compacto ? '' : `<span class="cb-servicios">${esc(textoServicios(c))}</span>`}
  </button>`;
}

function rangoHorario(citas) {
  const aj = leerAjustes();
  let ini = aMinutos(aj.apertura), fin = aMinutos(aj.cierre);
  for (const c of citas) { ini = Math.min(ini, Math.floor(c.inicio / 60) * 60); fin = Math.max(fin, Math.ceil(c.fin / 60) * 60); }
  return { ini, fin };
}

// ---------------------------------------------------------------------
// Vista de semana
// ---------------------------------------------------------------------
async function pintarSemana(zona) {
  const lunes = lunesDe(st.fecha);
  const citas = await db.citasEntre(lunes, sumarDias(lunes, 6));
  const visibles = citas.filter((c) => st.anuladas || c.estado !== 'anulada');
  const hoy = hoyISO();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const { ini, fin } = rangoHorario(visibles);
  const alto = (fin - ini) * PPM_S;
  const anuladas = citas.filter((c) => c.estado === 'anulada').length;
  const previsto = citas.filter(cuenta).reduce((a, c) => a + c.total, 0);

  const etiquetas = [];
  for (let m = ini; m < fin; m += 60) etiquetas.push(`<span style="top:${(m - ini) * PPM_S}px">${aHora(m)}</span>`);

  zona.innerHTML = `
    <div class="semana-info">
      <p class="texto-suave">${citas.filter(cuenta).length} citas · previsto <strong>${euros(previsto)}</strong></p>
      ${anuladas ? `<label class="check"><input type="checkbox" data-anuladas ${st.anuladas ? 'checked' : ''}> Ver anuladas (${anuladas})</label>` : ''}
    </div>
    <div class="semana-scroll">
      <div class="semana" style="--ppm-hora:${60 * PPM_S}px">
        <div class="sem-esquina"></div>
        ${dias.map((d) => {
          const n = citas.filter((c) => c.fecha === d && cuenta(c)).length;
          return `<button class="sem-cab ${d === hoy ? 'hoy' : ''} ${d === st.fecha ? 'elegido' : ''}" data-dia="${d}" aria-label="Abrir ${esc(textoDiaLargo(d))}">
            <span>${inicialDia(d)}</span><b>${desdeISO(d).getDate()}</b><small>${n ? `${n} ${n === 1 ? 'cita' : 'citas'}` : ''}</small></button>`;
        }).join('')}
        <div class="sem-horas" style="height:${alto}px">${etiquetas.join('')}</div>
        ${dias.map((d) => `
          <div class="sem-col ${d === hoy ? 'hoy' : ''}" style="height:${alto}px">
            <div class="carril" data-fecha="${d}" title="Toca un hueco para crear una cita">
              ${enCarriles(visibles.filter((c) => c.fecha === d)).map((c) => htmlBloque(c, ini, PPM_S, { semana: true })).join('')}
            </div>
            ${d === hoy ? '<div class="ahora" aria-hidden="true"></div>' : ''}
          </div>`).join('')}
      </div>
    </div>`;

  zona.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cita]');
    if (b) return abrirDetalleCita(b.dataset.cita, refrescar);
    const cab = e.target.closest('[data-dia]');
    if (cab) { st.fecha = cab.dataset.dia; st.vista = 'dia'; guardarEstado(); return render(contenedor); }
    if (e.target.classList.contains('carril')) {
      const m = Math.floor((ini + e.offsetY / PPM_S) / 15) * 15;
      abrirFormularioCita({ fecha: e.target.dataset.fecha, hora: aHora(m), alGuardar: alGuardarCita });
    }
  });
  zona.querySelector('[data-anuladas]')?.addEventListener('change', (e) => {
    st.anuladas = e.target.checked; guardarEstado(); render(contenedor);
  });

  const scroll = zona.querySelector('.semana-scroll');
  const linea = zona.querySelector('.ahora');
  const colocarLinea = () => {
    if (!linea) return;
    const m = minutosAhora();
    linea.style.display = m >= ini && m <= fin ? '' : 'none';
    linea.style.top = `${(m - ini) * PPM_S}px`;
  };
  colocarLinea();
  if (linea) relojLinea = setInterval(colocarLinea, 60000);
  const primera = Math.min(...visibles.map((c) => c.inicio), Infinity);
  const objetivo = dias.includes(hoy) ? minutosAhora() - 60 : (Number.isFinite(primera) ? primera - 30 : ini);
  scroll.scrollTop = Math.max(0, (objetivo - ini) * PPM_S);
  return { ini, fin, ppm: PPM_S, citas, scroll };
}

// ---------------------------------------------------------------------
// Vista de día
// ---------------------------------------------------------------------
async function pintarDia(zona) {
  const lunes = lunesDe(st.fecha);
  const semana = await db.citasEntre(lunes, sumarDias(lunes, 6));
  const delDia = semana.filter((c) => c.fecha === st.fecha);
  const visibles = delDia.filter((c) => st.anuladas || c.estado !== 'anulada');
  const hoy = hoyISO();

  // Tira de la semana
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const tira = dias.map((d) => {
    const n = semana.filter((c) => c.fecha === d && cuenta(c)).length;
    return `<button class="dia-tira ${d === st.fecha ? 'activo' : ''} ${d === hoy ? 'hoy' : ''}" data-dia="${d}"
      aria-current="${d === st.fecha ? 'date' : 'false'}">
      <span>${inicialDia(d)}</span><b>${desdeISO(d).getDate()}</b>
      <i class="puntos" aria-label="${n} citas">${'•'.repeat(Math.min(n, 5))}</i></button>`;
  }).join('');

  // Rango horario (se amplía si hay citas fuera del horario)
  const { ini, fin } = rangoHorario(visibles);
  const alto = (fin - ini) * PPM;

  const horas = [];
  for (let m = ini; m <= fin; m += 30) {
    horas.push(`<div class="linea-hora ${m % 60 ? 'media' : ''}" style="top:${(m - ini) * PPM}px">
      ${m % 60 ? '' : `<span>${aHora(m)}</span>`}</div>`);
  }

  const htmlBloques = enCarriles(visibles).map((c) => htmlBloque(c, ini, PPM)).join('');

  const conteo = delDia.filter(cuenta);
  const previsto = conteo.reduce((a, c) => a + c.total, 0);
  const anuladas = delDia.filter((c) => c.estado === 'anulada').length;

  zona.innerHTML = `
    <nav class="tira-semana" aria-label="Semana">${tira}</nav>
    <div class="dia-layout">
      <div class="dia-scroll">
        <div class="dia" style="height:${alto}px">
          ${horas.join('')}
          <div class="carril" title="Toca un hueco para crear una cita">${htmlBloques}</div>
          ${st.fecha === hoy ? '<div class="ahora" aria-hidden="true"></div>' : ''}
        </div>
      </div>
      <aside class="resumen-dia" aria-label="Citas del día">
        <h2>${conteo.length ? `${conteo.length} ${conteo.length === 1 ? 'cita' : 'citas'}` : 'Sin citas'}</h2>
        ${conteo.length ? `<p class="texto-suave">Previsto: <strong>${euros(previsto)}</strong></p>` : '<p class="texto-suave">Toca un hueco de la agenda o «Nueva cita» para apuntar una.</p>'}
        <ol class="lista-dia">
          ${delDia.filter((c) => st.anuladas || c.estado !== 'anulada').map((c) => `
            <li><button data-cita="${c.id}" class="estado-${c.estado}" style="--esmalte:${esc(c.clienta?.color || '#B5838D')}">
              <time>${c.hora}</time>
              <span><strong>${esc(nombreCompleto(c.clienta))}</strong><small>${esc(textoServicios(c))}</small></span>
              <em class="${c.cobrada ? 'em-cobrada' : ''}">${c.cobrada ? 'Cobrada' : c.estado === 'confirmada' ? '' : esc(ESTADOS[c.estado])}</em>
            </button></li>`).join('')}
        </ol>
        ${anuladas ? `<label class="check"><input type="checkbox" data-anuladas ${st.anuladas ? 'checked' : ''}> Ver anuladas (${anuladas})</label>` : ''}
      </aside>
    </div>`;

  zona.querySelector('.tira-semana').addEventListener('click', (e) => {
    const d = e.target.closest('[data-dia]')?.dataset.dia;
    if (d) { st.fecha = d; guardarEstado(); render(contenedor); }
  });
  zona.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cita]');
    if (b) return abrirDetalleCita(b.dataset.cita, refrescar);
    if (e.target.classList.contains('carril')) {
      const y = e.offsetY;
      const m = Math.floor((ini + y / PPM) / 15) * 15;
      abrirFormularioCita({ fecha: st.fecha, hora: aHora(m), alGuardar: alGuardarCita });
    }
  });
  zona.querySelector('[data-anuladas]')?.addEventListener('change', (e) => {
    st.anuladas = e.target.checked; guardarEstado(); render(contenedor);
  });

  // Línea de "ahora" y desplazamiento inicial
  const scroll = zona.querySelector('.dia-scroll');
  const linea = zona.querySelector('.ahora');
  const colocarLinea = () => {
    if (!linea) return;
    const m = minutosAhora();
    linea.style.display = m >= ini && m <= fin ? '' : 'none';
    linea.style.top = `${(m - ini) * PPM}px`;
  };
  colocarLinea();
  if (linea) relojLinea = setInterval(colocarLinea, 60000);
  const objetivo = st.fecha === hoy ? minutosAhora() - 45 : (visibles[0]?.inicio ?? ini) - 15;
  scroll.scrollTop = Math.max(0, (objetivo - ini) * PPM);
  return { ini, fin, ppm: PPM, citas: delDia, scroll };
}

// ---------------------------------------------------------------------
// Vista de mes
// ---------------------------------------------------------------------
async function pintarMes(zona) {
  const primero = primeroDeMes(st.fecha);
  const desde = lunesDe(primero);
  const hasta = sumarDias(desde, 41);
  const citas = (await db.citasEntre(desde, hasta)).filter(cuenta);
  const hoy = hoyISO();
  const mes = primero.slice(0, 7);

  const cabecera = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => `<div class="mes-cab">${d}</div>`).join('');
  const celdas = Array.from({ length: 42 }, (_, i) => {
    const d = sumarDias(desde, i);
    const delDia = citas.filter((c) => c.fecha === d);
    const fuera = d.slice(0, 7) !== mes;
    return `<button class="mes-dia ${fuera ? 'fuera' : ''} ${d === hoy ? 'hoy' : ''}" data-dia="${d}"
      aria-label="${esc(textoDiaLargo(d))}, ${delDia.length} citas">
      <b>${desdeISO(d).getDate()}</b>
      ${delDia.slice(0, 3).map((c) => `<span class="mes-cita" style="--esmalte:${esc(c.clienta?.color || '#B5838D')}">${c.hora} ${esc(c.clienta?.nombre || '')}</span>`).join('')}
      ${delDia.length > 3 ? `<span class="mes-mas">+${delDia.length - 3} más</span>` : ''}
    </button>`;
  }).join('');

  zona.innerHTML = `<div class="mes">${cabecera}${celdas}</div>`;
  zona.querySelector('.mes').addEventListener('click', (e) => {
    const d = e.target.closest('[data-dia]')?.dataset.dia;
    if (d) { st.fecha = d; st.vista = 'dia'; guardarEstado(); render(contenedor); }
  });
}

export function irAFecha(fecha) { st.fecha = fecha; st.vista = 'dia'; guardarEstado(); }

// ---------------------------------------------------------------------
// Mover una cita arrastrándola con el dedo (desde «Mover cita» en su ficha)
// Todo queda oscurecido menos la cita; se arrastra a su nuevo hueco y al
// soltarla queda guardada. La ✕ roja cancela.
// ---------------------------------------------------------------------
let pendienteMover = null;
window.addEventListener('mb:mover-cita', (e) => {
  const { id, fecha } = e.detail;
  pendienteMover = id;
  st.fecha = fecha;
  if (st.vista === 'mes') st.vista = 'dia';
  guardarEstado();
  if (location.hash.startsWith('#agenda') && contenedor?.isConnected) render(contenedor);
  else if (!location.hash || location.hash === '#') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#agenda';
});

const PASO = 5;   // minutos: la cita se coloca de 5 en 5
const DIA_CORTO = (iso) => `${inicialDia(iso)} ${desdeISO(iso).getDate()}`;

function modoMover(el, id, { ini, ppm, citas, scroll }) {
  const c = citas.find((x) => x.id === id);
  const bloque = el.querySelector(`.cita-bloque[data-cita="${id}"]`);
  if (!c || !bloque) return aviso('No se encuentra la cita en la agenda.', 'error');
  const semana = st.vista === 'semana';
  // Que la cita se vea
  scroll.scrollIntoView({ block: 'nearest' });
  bloque.scrollIntoView({ block: 'center', inline: 'center' });

  document.body.classList.add('moviendo-cita');
  const velo = document.createElement('div');
  velo.className = 'velo-mover';
  velo.innerHTML = `<p class="mover-ayuda">Arrastra la cita a su nueva hora${semana ? ' o a otro día' : '. Para cambiar de día, suéltala sobre un día de arriba'}.</p>`;
  const cancelar = document.createElement('button');
  cancelar.className = 'mover-cancelar';
  cancelar.type = 'button';
  cancelar.setAttribute('aria-label', 'Cancelar el movimiento');
  cancelar.textContent = '✕';
  const fantasma = bloque.cloneNode(true);
  fantasma.removeAttribute('data-cita');
  fantasma.classList.add('fantasma');
  fantasma.setAttribute('aria-label', `Arrastrar la cita de ${nombreCompleto(c.clienta)}`);
  fantasma.insertAdjacentHTML('beforeend', '<span class="fantasma-hora"></span>');
  const etiqueta = fantasma.querySelector('.fantasma-hora');
  bloque.classList.add('origen-mover');
  document.body.append(velo, fantasma, cancelar);

  const color = c.clienta?.color || '#B5838D';
  const colocarEn = (left, top, ancho, alto) => {
    fantasma.style.cssText = `--esmalte:${color};position:fixed;left:${left}px;top:${top}px;width:${ancho}px;height:${alto}px;margin:0`;
  };
  const volver = () => {
    const r = bloque.getBoundingClientRect();
    colocarEn(r.left, r.top, r.width, r.height);
    etiqueta.textContent = '';
    marcarDestino(null);
  };
  let arr = null;        // arrastre en curso: { dx, dy, x, y }
  let destino = null;    // { fecha, inicio }
  let pan = null;        // desplazar la agenda tocando fuera de la cita
  let animacion = null;
  let resaltado = null;
  volver();

  function marcarDestino(elDestino) {
    if (resaltado && resaltado !== elDestino) resaltado.classList.remove('destino-mover');
    resaltado = elDestino;
    resaltado?.classList.add('destino-mover');
  }

  function calcular(x, y) {
    const top = y - arr.dy;
    const pila = document.elementsFromPoint(x, y);
    const tira = pila.find((n) => n.matches?.('.dia-tira[data-dia], .sem-cab[data-dia]'));
    if (tira) return { fecha: tira.dataset.dia, inicio: c.inicio, sobre: tira };
    const carril = pila.find((n) => n.classList?.contains('carril'));
    if (!carril) return null;
    const r = carril.getBoundingClientRect();
    let inicio = Math.round((ini + (top - r.top) / ppm) / PASO) * PASO;
    inicio = Math.max(0, Math.min(inicio, 24 * 60 - c.duracion_min));
    return { fecha: carril.dataset.fecha || st.fecha, inicio, sobre: semana ? carril.parentElement : null };
  }

  function mover(x, y) {
    arr.x = x; arr.y = y;
    const r = fantasma.getBoundingClientRect();
    colocarEn(x - arr.dx, y - arr.dy, r.width, r.height);
    destino = calcular(x, y);
    marcarDestino(destino?.sobre || null);
    const horaFantasma = fantasma.querySelector('.cb-hora');
    if (horaFantasma) horaFantasma.textContent = destino ? aHora(destino.inicio) : c.hora;
    etiqueta.textContent = destino ? `${destino.fecha !== c.fecha ? `${DIA_CORTO(destino.fecha)} · ` : ''}${aHora(destino.inicio)}–${aHora(destino.inicio + c.duracion_min)}` : '';
  }

  // Si el dedo llega al borde, la agenda se desplaza sola
  function autoDesplazar() {
    if (!arr) return;
    const r = scroll.getBoundingClientRect();
    const margen = 48, vel = 10;
    let dy = 0, dx = 0;
    if (arr.y < r.top + margen) dy = -vel; else if (arr.y > r.bottom - margen) dy = vel;
    if (semana) { if (arr.x < r.left + margen + 50) dx = -vel; else if (arr.x > r.right - margen) dx = vel; }
    if (dy || dx) { scroll.scrollTop += dy; scroll.scrollLeft += dx; mover(arr.x, arr.y); }
    animacion = requestAnimationFrame(autoDesplazar);
  }

  fantasma.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fantasma.setPointerCapture(e.pointerId);
    const r = fantasma.getBoundingClientRect();
    arr = { dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY };
    fantasma.classList.add('arrastrando');
    animacion = requestAnimationFrame(autoDesplazar);
  });
  fantasma.addEventListener('pointermove', (e) => { if (arr) mover(e.clientX, e.clientY); });
  fantasma.addEventListener('pointercancel', () => { arr = null; cancelAnimationFrame(animacion); fantasma.classList.remove('arrastrando'); volver(); });
  fantasma.addEventListener('pointerup', async (e) => {
    if (!arr) return;
    mover(e.clientX, e.clientY);
    arr = null;
    cancelAnimationFrame(animacion);
    fantasma.classList.remove('arrastrando');
    const d = destino;
    if (!d || (d.fecha === c.fecha && d.inicio === c.inicio)) return volver();
    const hora = aHora(d.inicio);
    try {
      const pisa = await db.solapes(d.fecha, d.inicio, d.inicio + c.duracion_min, c.id);
      if (pisa.length) {
        const ok = await confirmar('Ahí ya hay otra cita', {
          detalle: `Coincide con: ${pisa.map((x) => `${x.hora} ${nombreCompleto(x.clienta)}`).join(', ')}. ¿Moverla igualmente?`,
          si: 'Mover igualmente', no: 'Elegir otro hueco',
        });
        if (!ok) return volver();
      }
      cargando(true);
      await db.moverCita(c.id, d.fecha, hora);
      aviso(`Cita movida al ${textoDiaLargo(d.fecha).toLowerCase()} a las ${hora}`);
      salir();
      window.dispatchEvent(new Event('mb:datos'));
      st.fecha = d.fecha; guardarEstado();
      render(contenedor);
    } catch (err) { errorAviso(err, 'No se pudo mover la cita'); volver(); }
    finally { cargando(false); }
  });

  // Tocar fuera de la cita desplaza la agenda (para buscar el hueco)
  velo.addEventListener('pointerdown', (e) => {
    pan = { x: e.clientX, y: e.clientY, top: scroll.scrollTop, left: scroll.scrollLeft };
    velo.setPointerCapture(e.pointerId);
  });
  velo.addEventListener('pointermove', (e) => {
    if (!pan) return;
    scroll.scrollTop = pan.top - (e.clientY - pan.y);
    scroll.scrollLeft = pan.left - (e.clientX - pan.x);
  });
  velo.addEventListener('pointerup', () => { pan = null; });
  velo.addEventListener('wheel', (e) => { scroll.scrollTop += e.deltaY; scroll.scrollLeft += e.deltaX; e.preventDefault(); }, { passive: false });
  const alDesplazar = () => { if (!arr) volver(); };
  scroll.addEventListener('scroll', alDesplazar);
  window.addEventListener('scroll', alDesplazar);
  window.addEventListener('resize', alDesplazar);
  const tecla = (e) => { if (e.key === 'Escape') salir(); };
  document.addEventListener('keydown', tecla);

  function salir() {
    cancelAnimationFrame(animacion);
    marcarDestino(null);
    velo.remove(); fantasma.remove(); cancelar.remove();
    bloque.classList.remove('origen-mover');
    document.body.classList.remove('moviendo-cita');
    scroll.removeEventListener('scroll', alDesplazar);
    window.removeEventListener('scroll', alDesplazar);
    window.removeEventListener('resize', alDesplazar);
    window.removeEventListener('hashchange', salir);
    document.removeEventListener('keydown', tecla);
  }
  cancelar.addEventListener('click', () => { salir(); aviso('Movimiento cancelado'); });
  window.addEventListener('hashchange', salir);
}

// Agenda: vista de día (con la semana arriba) y vista de mes
import * as db from '../db.js';
import { esc, euros, nombreCompleto, errorAviso } from '../util.js';
import { hoyISO, sumarDias, sumarMeses, lunesDe, primeroDeMes, desdeISO, aMinutos, aHora,
  textoDiaLargo, textoMes, inicialDia, minutosAhora } from '../fechas.js';
import { leerAjustes } from '../ajustes.js';
import { abrirFormularioCita, abrirDetalleCita, ESTADOS, textoServicios } from '../citas.js';

const PPM = 1.6; // píxeles por minuto en la vista de día
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
          <button class="btn-icono" data-ir="-1" aria-label="${st.vista === 'dia' ? 'Día anterior' : 'Mes anterior'}">‹</button>
          <button class="btn btn-mini" data-ir="hoy">Hoy</button>
          <button class="btn-icono" data-ir="1" aria-label="${st.vista === 'dia' ? 'Día siguiente' : 'Mes siguiente'}">›</button>
        </div>
        <h1 id="tituloAgenda" class="barra-titulo">${st.vista === 'dia' ? esc(textoDiaLargo(st.fecha)) : esc(textoMes(st.fecha))}</h1>
        <div class="segmentos" role="group" aria-label="Vista">
          <button data-vista="dia" aria-pressed="${st.vista === 'dia'}">Día</button>
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
      else st.fecha = st.vista === 'dia' ? sumarDias(st.fecha, Number(ir)) : sumarMeses(st.fecha, Number(ir));
      guardarEstado(); render(el);
    } else if (v && v !== st.vista) {
      st.vista = v; guardarEstado(); render(el);
    } else if (e.target.closest('[data-nueva]')) {
      abrirFormularioCita({ fecha: st.fecha, hora: horaSugerida(), alGuardar: alGuardarCita });
    }
  });

  try {
    if (st.vista === 'dia') await pintarDia(el.querySelector('.agenda-cuerpo'));
    else await pintarMes(el.querySelector('.agenda-cuerpo'));
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
  const aj = leerAjustes();
  let ini = aMinutos(aj.apertura), fin = aMinutos(aj.cierre);
  for (const c of visibles) { ini = Math.min(ini, Math.floor(c.inicio / 60) * 60); fin = Math.max(fin, Math.ceil(c.fin / 60) * 60); }
  const alto = (fin - ini) * PPM;

  const horas = [];
  for (let m = ini; m <= fin; m += 30) {
    horas.push(`<div class="linea-hora ${m % 60 ? 'media' : ''}" style="top:${(m - ini) * PPM}px">
      ${m % 60 ? '' : `<span>${aHora(m)}</span>`}</div>`);
  }

  // Columnas para citas que se pisan
  const ordenadas = [...visibles].sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
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

  const htmlBloques = bloques.map((c) => {
    const alturaPx = Math.max(c.duracion_min * PPM, 26);
    const compacto = alturaPx < 56;
    return `<button class="cita-bloque estado-${c.estado} ${compacto ? 'compacto' : ''}" data-cita="${c.id}"
      style="--esmalte:${esc(c.clienta?.color || '#B5838D')};top:${(c.inicio - ini) * PPM}px;height:${alturaPx}px;
             left:calc(${(c._col / c._cols) * 100}% + 2px);width:calc(${100 / c._cols}% - 4px)"
      aria-label="${c.hora} ${esc(nombreCompleto(c.clienta))}, ${esc(textoServicios(c))}, ${ESTADOS[c.estado]}">
      <span class="cb-hora">${c.hora}</span>
      <span class="cb-nombre">${esc(nombreCompleto(c.clienta))}</span>
      ${compacto ? '' : `<span class="cb-servicios">${esc(textoServicios(c))}</span>`}
    </button>`;
  }).join('');

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
              <em>${c.estado === 'confirmada' ? '' : esc(ESTADOS[c.estado])}</em>
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

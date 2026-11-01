// Pasar citas desde Google Calendar (archivo .ics o el .zip que da Google)
import * as db from './db.js';
import { esc, nombreCompleto, abrirHoja, aviso, errorAviso, cargando, esmalteAleatorio } from './util.js';
import { hoyISO, aHora, textoDiaCorto, inicialDia, duracionTexto } from './fechas.js';
import { leerICS, interpretar, normal } from './ics.js';
import { leerAjustes } from './ajustes.js';

const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

function cargarScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => (window[global] ? ok(window[global]) : mal(new Error('No se pudo cargar')));
    s.onerror = () => mal(new Error('No se pudo abrir el .zip. Descomprímelo y elige el archivo .ics de dentro.'));
    document.head.appendChild(s);
  });
}

async function textosDeArchivo(archivo) {
  if (/\.zip$/i.test(archivo.name) || archivo.type.includes('zip')) {
    const JSZip = await cargarScript(JSZIP, 'JSZip');
    const zip = await JSZip.loadAsync(archivo);
    const ics = Object.values(zip.files).filter((f) => !f.dir && /\.ics$/i.test(f.name));
    if (!ics.length) throw new Error('El .zip no contiene ningún calendario (.ics)');
    return Promise.all(ics.map(async (f) => ({ nombre: f.name.replace(/^.*\//, ''), texto: await f.async('string') })));
  }
  return [{ nombre: archivo.name, texto: await archivo.text() }];
}

// Botón que se pone en Ajustes
export function elegirArchivo() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.ics,.zip,text/calendar,application/zip';
  inp.addEventListener('change', async () => {
    const archivo = inp.files?.[0];
    if (!archivo) return;
    try {
      cargando(true);
      const textos = await textosDeArchivo(archivo);
      const [servicios, clientas] = await Promise.all([db.listarServicios(), db.listarClientas()]);
      cargando(false);
      abrirRevision({ textos, servicios, clientas, nombreArchivo: archivo.name });
    } catch (e) { cargando(false); errorAviso(e, 'No se pudo leer el archivo'); }
  });
  inp.click();
}

function abrirRevision({ textos, servicios, clientas, nombreArchivo }) {
  const hoy = hoyISO();
  let desde = hoy;
  let filas = [];
  let calendariosElegidos = new Set(textos.map((t) => t.nombre));

  const { el, cerrar } = abrirHoja(`
    <div class="importar">
      <header class="hoja-cabecera">
        <div>
          <h2 class="hoja-titulo">Importar de Google Calendar</h2>
          <p class="texto-suave">${esc(nombreArchivo)}</p>
        </div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        ${textos.length > 1 ? `<fieldset class="campo"><legend>Calendarios</legend>
          ${textos.map((t) => `<label class="check"><input type="checkbox" data-cal="${esc(t.nombre)}" checked> ${esc(t.nombre.replace(/\.ics$/i, ''))}</label>`).join('')}</fieldset>` : ''}
        <div class="imp-controles">
          <label class="campo"><span>Importar citas desde el día</span><input type="date" data-desde value="${desde}"></label>
          <div class="acciones-form">
            <button type="button" class="btn btn-mini" data-todas="1">Marcar todas</button>
            <button type="button" class="btn btn-mini" data-todas="0">Desmarcar todas</button>
          </div>
        </div>
        <p class="imp-resumen" aria-live="polite"></p>
        <ul class="imp-lista"></ul>
      </div>
      <footer class="hoja-pie">
        <p class="imp-progreso" aria-live="polite"></p>
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button type="button" class="btn btn-principal" data-importar>Importar</button>
      </footer>
    </div>`, { ancho: 'ancha' });

  const lista = el.querySelector('.imp-lista');

  async function preparar() {
    const eventos = textos.filter((t) => calendariosElegidos.has(t.nombre)).flatMap((t) => leerICS(t.texto, { desde }));
    let existentes = [];
    if (eventos.length) {
      try { existentes = await db.citasEntre(desde, eventos.at(-1).fecha); } catch { /* sin comprobación */ }
    }
    filas = eventos.map((ev) => {
      const r = interpretar(ev, servicios, clientas);
      const hora = aHora(ev.min);
      const duplicada = r.clientaId && existentes.some((c) => c.fecha === ev.fecha && c.hora === hora && c.clienta_id === r.clientaId);
      return {
        ev, hora, duplicada,
        marcada: !ev.diaCompleto && !duplicada,
        clienta: r.clientaId || 'nueva', nombre: r.nombre || ev.titulo, telefono: r.telefono,
        servicios: r.servicios.join(','),
      };
    });
    pintar();
  }

  const opcionesServicio = (valor) => {
    const combinada = valor && valor.includes(',')
      ? `<option value="${valor}" selected>${esc(valor.split(',').map((id) => servicios.find((s) => s.id === id)?.nombre).join(' + '))}</option>` : '';
    return `<option value="">Sin servicio (se cobra a mano)</option>${combinada}`
      + servicios.map((s) => `<option value="${s.id}" ${s.id === valor ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
  };
  const opcionesClienta = (valor) => `<option value="nueva" ${valor === 'nueva' ? 'selected' : ''}>Clienta nueva…</option>`
    + clientas.map((c) => `<option value="${c.id}" ${c.id === valor ? 'selected' : ''}>${esc(nombreCompleto(c))}</option>`).join('');

  function pintar() {
    lista.innerHTML = filas.map((f, i) => `
      <li class="fila-imp ${f.marcada ? '' : 'desmarcada'}">
        <label class="imp-check"><input type="checkbox" data-i="${i}" data-k="marcada" ${f.marcada ? 'checked' : ''}><span class="sr">Importar</span></label>
        <div class="imp-info">
          <p class="imp-cuando">${inicialDia(f.ev.fecha)} ${esc(textoDiaCorto(f.ev.fecha))} · ${f.ev.diaCompleto ? 'Todo el día' : `${f.hora} · ${duracionTexto(Math.min(f.ev.duracion, 720))}`}
            ${f.duplicada ? '<em class="aviso-texto">Ya está en la agenda</em>' : ''}${f.ev.diaCompleto ? '<em class="texto-suave">Evento de día completo</em>' : ''}</p>
          <p class="imp-titulo">«${esc(f.ev.titulo)}»</p>
          <div class="imp-campos">
            <select data-i="${i}" data-k="clienta" aria-label="Clienta">${opcionesClienta(f.clienta)}</select>
            ${f.clienta === 'nueva' ? `<input data-i="${i}" data-k="nombre" value="${esc(f.nombre)}" aria-label="Nombre de la clienta nueva">` : ''}
            <select data-i="${i}" data-k="servicios" aria-label="Servicio">${opcionesServicio(f.servicios)}</select>
          </div>
        </div>
      </li>`).join('') || '<li class="vacio"><p>No hay eventos a partir de ese día.</p></li>';
    resumen();
  }

  function resumen() {
    const n = filas.filter((f) => f.marcada).length;
    const nuevas = new Set(filas.filter((f) => f.marcada && f.clienta === 'nueva').map((f) => normal(f.nombre))).size;
    const dup = filas.filter((f) => f.duplicada).length;
    el.querySelector('.imp-resumen').innerHTML = `${filas.length} eventos · <strong>${n} citas para importar</strong>`
      + (nuevas ? (nuevas === 1 ? ' · se creará 1 clienta nueva' : ` · se crearán ${nuevas} clientas nuevas`) : '')
      + (dup ? ` · ${dup} ya estaban` : '')
      + '<br><span class="texto-suave">Revisa la clienta y el servicio de cada una. Desmarca lo que no sea una cita (médico, cumpleaños…).</span>';
    const b = el.querySelector('[data-importar]');
    b.disabled = !n;
    b.textContent = n ? `Importar ${n} ${n === 1 ? 'cita' : 'citas'}` : 'Importar';
  }

  lista.addEventListener('change', (e) => {
    const i = e.target.dataset.i; if (i == null) return;
    const f = filas[i]; const k = e.target.dataset.k;
    if (k === 'marcada') { f.marcada = e.target.checked; e.target.closest('.fila-imp').classList.toggle('desmarcada', !f.marcada); return resumen(); }
    if (k === 'clienta') {
      f.clienta = e.target.value;
      // Si elige una clienta existente, se aplica a las demás citas con el mismo nombre detectado
      if (f.clienta !== 'nueva') filas.forEach((x) => { if (x !== f && x.clienta === 'nueva' && normal(x.nombre) === normal(f.nombre)) x.clienta = f.clienta; });
      return pintar();
    }
    if (k === 'servicios') f.servicios = e.target.value;
  });
  lista.addEventListener('input', (e) => {
    const i = e.target.dataset.i;
    if (i != null && e.target.dataset.k === 'nombre') { filas[i].nombre = e.target.value; resumen(); }
  });
  el.querySelector('[data-desde]').addEventListener('change', (e) => { desde = e.target.value || hoy; preparar(); });
  el.querySelectorAll('[data-cal]').forEach((c) => c.addEventListener('change', () => {
    calendariosElegidos = new Set([...el.querySelectorAll('[data-cal]:checked')].map((x) => x.dataset.cal)); preparar();
  }));
  el.querySelectorAll('[data-todas]').forEach((b) => b.addEventListener('click', () => {
    filas.forEach((f) => { f.marcada = b.dataset.todas === '1' && !f.duplicada; }); pintar();
  }));

  el.querySelector('[data-importar]').addEventListener('click', async () => {
    const elegidas = filas.filter((f) => f.marcada);
    if (elegidas.some((f) => f.clienta === 'nueva' && !f.nombre.trim())) return aviso('Falta el nombre de alguna clienta nueva.', 'error');
    const btn = el.querySelector('[data-importar]');
    const prog = el.querySelector('.imp-progreso');
    btn.disabled = true;
    const nuevas = new Map();
    let hechas = 0, fallos = 0;
    const apertura = leerAjustes().apertura;
    for (const f of elegidas) {
      prog.textContent = `Importando ${hechas + fallos + 1} de ${elegidas.length}…`;
      try {
        let clientaId = f.clienta !== 'nueva' ? f.clienta : nuevas.get(normal(f.nombre));
        if (!clientaId) {
          const c = await db.guardarClienta({
            nombre: f.nombre.trim(), telefono: f.telefono || null, color: esmalteAleatorio(),
            notas: 'Creada al importar de Google Calendar', consentimiento_datos: false,
          });
          clientaId = c.id;
          nuevas.set(normal(f.nombre), clientaId);
        }
        const ids = f.servicios ? f.servicios.split(',') : [];
        const duracion = f.ev.diaCompleto ? 60 : Math.max(5, Math.min(f.ev.duracion, 720));
        const lineas = ids.length
          ? ids.map((id) => servicios.find((s) => s.id === id)).filter(Boolean).map((s) => ({
            servicio_id: s.id, nombre: s.nombre, precio: Number(s.precio), iva_pct: Number(s.iva_pct ?? 21), duracion_min: s.duracion_min,
          }))
          : [{ servicio_id: null, nombre: f.ev.titulo.slice(0, 120), precio: 0, iva_pct: 21, duracion_min: duracion }];
        await db.guardarCita({
          clienta_id: clientaId, fecha: f.ev.fecha, hora_inicio: f.ev.diaCompleto ? apertura : f.hora,
          duracion_min: duracion,
          estado: f.ev.fecha < hoy ? 'realizada' : 'confirmada',
          notas: `Importada de Google Calendar: «${f.ev.titulo}»${f.ev.descripcion ? ` · ${f.ev.descripcion.slice(0, 300)}` : ''}`,
        }, lineas);
        hechas++;
      } catch (e) { fallos++; console.error(e); }
    }
    prog.textContent = '';
    cerrar();
    const txtNuevas = nuevas.size ? (nuevas.size === 1 ? ' y 1 clienta nueva' : ` y ${nuevas.size} clientas nuevas`) : '';
    aviso(fallos ? `Importadas ${hechas} citas · ${fallos} no se pudieron importar` : `Importadas ${hechas} ${hechas === 1 ? 'cita' : 'citas'}${txtNuevas}`, fallos ? 'error' : 'ok');
    location.hash = '#agenda';
  });

  preparar();
}

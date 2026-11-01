// Copia de seguridad: «Descargar datos» (un .zip con todo en JSON) e
// «Introducir datos» (vuelve a meter lo que falte desde ese .zip).
import * as db from './db.js';
import { esc, abrirHoja, aviso, errorAviso, cargando } from './util.js';
import { hoyISO, textoFecha } from './fechas.js';
import { confirmarConPin } from './pin.js';

const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const VERSION = '0.7';
const CLAVE_ULTIMA = 'mb_ultima_copia_v1';

export const NOMBRES = {
  clientas: 'Clientas', servicios: 'Servicios', productos: 'Productos', citas: 'Citas', cita_servicios: 'Servicios de las citas',
  cobros: 'Cobros', cobro_lineas: 'Líneas de los cobros', cobro_pagos: 'Pagos de los cobros', facturas: 'Facturas',
  cierres_caja: 'Cierres de caja', consumibles: 'Material del inventario', consumible_movimientos: 'Movimientos del inventario',
  obligaciones: 'Avisos (gastos y obligaciones)', obligacion_registros: 'Pagos de los avisos',
};

function cargarJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = JSZIP;
    s.onload = () => (window.JSZip ? ok(window.JSZip) : mal(new Error('No se pudo cargar el compresor')));
    s.onerror = () => mal(new Error('No se pudo cargar el compresor. Comprueba la conexión a internet.'));
    document.head.appendChild(s);
  });
}

export function ultimaCopia() {
  try { return localStorage.getItem(CLAVE_ULTIMA) || null; } catch { return null; }
}

// ---------------------------------------------------------------------
// Preparar el .zip
// ---------------------------------------------------------------------
async function generarCopia() {
  const [{ copia, faltan }, JSZip] = await Promise.all([db.exportarDatos(VERSION), cargarJSZip()]);
  const zip = new JSZip();
  const total = Object.keys(NOMBRES).reduce((a, t) => a + (copia[t]?.length || 0), 0);
  zip.file('datos.json', JSON.stringify(copia));
  for (const t of Object.keys(NOMBRES)) zip.file(`tablas/${t}.json`, JSON.stringify(copia[t] || [], null, 1));
  zip.file('LEEME.txt', [
    'Copia de seguridad de Manely Belleza',
    `Hecha el ${new Date().toLocaleString('es-ES')}`,
    '',
    'Para recuperarla: en la app, Ajustes > Copia de seguridad > Introducir datos,',
    'y elegir este mismo archivo .zip (no hace falta descomprimirlo).',
    '',
    'datos.json         todo junto (es lo que lee la app al recuperar)',
    'tablas/*.json      cada tabla por separado, por si hiciera falta consultarla',
    '',
    ...Object.entries(NOMBRES).map(([t, n]) => `${n}: ${copia[t]?.length || 0}`),
  ].join('\r\n'));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, nombre: `Manely-copia-${hoyISO()}.zip`, total, faltan };
}

function apuntarCopia() { try { localStorage.setItem(CLAVE_ULTIMA, new Date().toISOString()); } catch { /* */ } }
function avisoFaltan(faltan) {
  if (faltan.length) aviso(`Ojo: la copia va sin ${faltan.map((t) => NOMBRES[t]).join(', ')}. Falta ejecutar algún archivo SQL.`, 'error');
}
function bajarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------------------------------------------------------------
// Descargar (se guarda en la carpeta Descargas de este dispositivo)
// ---------------------------------------------------------------------
export async function descargarCopia() {
  try {
    cargando(true);
    const { blob, nombre, total, faltan } = await generarCopia();
    bajarArchivo(blob, nombre);
    apuntarCopia();
    if (faltan.length) avisoFaltan(faltan); else aviso(`Copia descargada en Descargas: ${nombre} (${total} datos)`);
    return true;
  } catch (e) { errorAviso(e, 'No se pudo hacer la copia'); return false; }
  finally { cargando(false); }
}

// ---------------------------------------------------------------------
// Enviar a Drive, por email o por WhatsApp
// En el móvil y la tablet se abre el menú «Compartir» del sistema con el
// archivo ya adjunto: allí se elige Drive, Gmail o WhatsApp (y el contacto).
// Si el navegador no puede compartir archivos (algunos ordenadores), se
// descarga y se abre el destino para adjuntarlo a mano.
// ---------------------------------------------------------------------
const DESTINOS = {
  drive: { titulo: 'Guardar en Drive', app: 'Drive', abrir: 'https://drive.google.com/drive/my-drive',
    pasos: 'Se ha descargado la copia y se ha abierto Google Drive. Arrastra allí el archivo desde la carpeta Descargas (o pulsa «Nuevo» → «Subir archivo»).' },
  email: { titulo: 'Enviar por email', app: 'Gmail (o tu correo)', abrir: null,
    pasos: 'Se ha descargado la copia y se ha abierto el correo. Adjunta el archivo desde la carpeta Descargas y envíatelo.' },
  whatsapp: { titulo: 'Enviar por WhatsApp', app: 'WhatsApp', abrir: 'https://web.whatsapp.com/',
    pasos: 'Se ha descargado la copia y se ha abierto WhatsApp Web. Abre el chat, pulsa el clip 📎 → Documento y elige el archivo de la carpeta Descargas.' },
};

export async function enviarCopia(destino) {
  const d = DESTINOS[destino];
  let copia;
  try { cargando(true); copia = await generarCopia(); }
  catch (e) { return errorAviso(e, 'No se pudo hacer la copia'); }
  finally { cargando(false); }
  const archivo = new File([copia.blob], copia.nombre, { type: 'application/zip' });
  const datosCompartir = { files: [archivo], title: copia.nombre, text: `Copia de seguridad de Manely Belleza (${textoFecha(hoyISO())})` };
  if (navigator.canShare?.({ files: [archivo] })) {
    const compartir = async () => {
      try {
        await navigator.share(datosCompartir);
        apuntarCopia(); avisoFaltan(copia.faltan);
        return 'ok';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelado';
        if (e.name === 'NotAllowedError') return 'permiso';
        errorAviso(e, 'No se pudo compartir'); return 'error';
      }
    };
    // Si la copia tardó en prepararse, el navegador pide volver a pulsar
    if (await compartir() === 'permiso') {
      const { el, cerrar } = abrirHoja(`
        <div class="hoja-cuerpo">
          <h2 class="hoja-titulo">Copia preparada</h2>
          <p>${esc(copia.nombre)} · ${copia.total} datos. Pulsa el botón y elige <strong>${esc(d.app)}</strong> en el menú.</p>
          <div class="hoja-pie sin-borde">
            <button type="button" class="btn" data-cerrar>Cancelar</button>
            <button type="button" class="btn btn-principal" data-compartir>${esc(d.titulo)}</button>
          </div>
        </div>`, { ancho: 'estrecha' });
      el.querySelector('[data-compartir]').addEventListener('click', async () => { cerrar(); await compartir(); });
    }
    return;
  }
  // Sin «Compartir» con archivos: descargar y abrir el destino
  bajarArchivo(copia.blob, copia.nombre);
  apuntarCopia(); avisoFaltan(copia.faltan);
  if (destino === 'email') {
    location.href = `mailto:?subject=${encodeURIComponent(`Copia de seguridad Manely Belleza ${textoFecha(hoyISO())}`)}&body=${encodeURIComponent('Adjunto la copia de seguridad de la app (archivo .zip de la carpeta Descargas).')}`;
  } else window.open(d.abrir, '_blank', 'noopener');
  abrirHoja(`
    <div class="hoja-cuerpo">
      <h2 class="hoja-titulo">${esc(d.titulo)}</h2>
      <p>${esc(d.pasos)}</p>
      <p class="texto-suave">Archivo: ${esc(copia.nombre)}</p>
      <div class="hoja-pie sin-borde"><button type="button" class="btn btn-principal" data-cerrar>Vale</button></div>
    </div>`, { ancho: 'estrecha' });
}

// ---------------------------------------------------------------------
// Introducir
// ---------------------------------------------------------------------
async function leerArchivo(archivo) {
  let texto;
  if (/\.zip$/i.test(archivo.name) || archivo.type.includes('zip')) {
    const JSZip = await cargarJSZip();
    const zip = await JSZip.loadAsync(archivo);
    const dentro = zip.file('datos.json') || zip.file(/(^|\/)datos\.json$/)[0];
    if (!dentro) throw new Error('El .zip no tiene el archivo datos.json: no parece una copia de Manely Belleza.');
    texto = await dentro.async('string');
  } else {
    texto = await archivo.text();
  }
  let copia;
  try { copia = JSON.parse(texto); } catch { throw new Error('El archivo está dañado o no es una copia de Manely Belleza.'); }
  if (copia?.app !== 'Manely Belleza') throw new Error('El archivo no es una copia de Manely Belleza.');
  return copia;
}

export function introducirCopia(alTerminar) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,.json,application/zip,application/json';
  input.addEventListener('change', async () => {
    const archivo = input.files?.[0];
    if (!archivo) return;
    let copia;
    try { cargando(true); copia = await leerArchivo(archivo); }
    catch (e) { return errorAviso(e, 'No se pudo leer la copia'); }
    finally { cargando(false); }
    revisar(copia, alTerminar);
  });
  input.click();
}

function revisar(copia, alTerminar) {
  const filas = Object.entries(NOMBRES).filter(([t]) => copia[t]?.length);
  const fecha = copia.creada ? new Date(copia.creada) : null;
  const { el, cerrar } = abrirHoja(`
    <header class="hoja-cabecera">
      <div><h2 class="hoja-titulo">Introducir datos</h2>
        <p class="texto-suave">Copia ${fecha ? `del ${esc(textoFecha(fecha.toISOString().slice(0, 10)))} a las ${esc(fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}` : ''}${copia.modo === 'demo' ? ' · hecha en el modo demostración' : ''}</p></div>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo">
      <p>Se añadirá a la app <strong>todo lo que falte</strong>. Lo que ya está no se cambia ni se duplica, así que se puede hacer sin miedo aunque la app tenga datos.</p>
      ${filas.length ? `<ul class="lista-copia">${filas.map(([t, n]) => `<li><span>${esc(n)}</span><b>${copia[t].length}</b></li>`).join('')}</ul>` : '<p class="aviso-texto">La copia está vacía.</p>'}
    </div>
    <footer class="hoja-pie">
      <button type="button" class="btn" data-cerrar>Cancelar</button>
      <button type="button" class="btn btn-principal" data-introducir ${filas.length ? '' : 'disabled'}>Introducir datos</button>
    </footer>`, { ancho: 'normal' });
  el.querySelector('[data-introducir]').addEventListener('click', async () => {
    const ok = await confirmarConPin({ titulo: 'Introducir datos', texto: 'Se añadirán a la app los datos de la copia que falten. Escribe tu PIN para confirmarlo.' });
    if (!ok) return;
    try {
      cargando(true);
      const r = await db.restaurarDatos(copia);
      cerrar();
      resultado(copia, r);
      window.dispatchEvent(new Event('mb:datos'));
      alTerminar?.();
    } catch (e) {
      errorAviso(e, /restaurar_copia/.test(e.message) ? 'Falta ejecutar supabase/006_copias.sql en Supabase' : 'No se pudieron introducir los datos');
    } finally { cargando(false); }
  });
}

function resultado(copia, r) {
  const total = Object.values(r || {}).reduce((a, n) => a + Number(n || 0), 0);
  abrirHoja(`
    <header class="hoja-cabecera">
      <h2 class="hoja-titulo">${total ? 'Datos recuperados' : 'No faltaba nada'}</h2>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="hoja-cuerpo">
      <p>${total ? `Se han añadido <strong>${total}</strong> datos. El resto ya estaba en la app.` : 'Todo lo de la copia ya estaba en la app.'}</p>
      <ul class="lista-copia">${Object.entries(NOMBRES).filter(([t]) => copia[t]?.length).map(([t, n]) => `<li><span>${esc(n)}</span><b>${Number(r?.[t] || 0)} de ${copia[t].length}</b></li>`).join('')}</ul>
    </div>
    <footer class="hoja-pie"><button type="button" class="btn btn-principal" data-cerrar>Vale</button></footer>`, { ancho: 'normal' });
}

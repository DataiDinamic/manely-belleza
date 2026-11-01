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
// Descargar
// ---------------------------------------------------------------------
export async function descargarCopia() {
  try {
    cargando(true);
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
    const nombre = `Manely-copia-${hoyISO()}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    try { localStorage.setItem(CLAVE_ULTIMA, new Date().toISOString()); } catch { /* */ }
    if (faltan.length) aviso(`Copia descargada, pero sin: ${faltan.map((t) => NOMBRES[t]).join(', ')}. Falta ejecutar algún archivo SQL.`, 'error');
    else aviso(`Copia descargada: ${nombre} (${total} datos)`);
    return true;
  } catch (e) { errorAviso(e, 'No se pudo hacer la copia'); return false; }
  finally { cargando(false); }
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

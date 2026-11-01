// Facturas: pedir datos, emitir, generar el PDF y compartirlo o descargarlo
import * as db from './db.js';
import { esc, euros, nombreCompleto, abrirHoja, aviso, errorAviso, cargando } from './util.js';
import { textoFecha } from './fechas.js';

const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
let cargaJsPDF = null;

function cargarJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  cargaJsPDF ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSPDF;
    s.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('No se pudo cargar el generador de PDF')));
    s.onerror = () => { cargaJsPDF = null; reject(new Error('No se pudo cargar el generador de PDF. Comprueba la conexión.')); };
    document.head.appendChild(s);
  });
  return cargaJsPDF;
}

async function logoDataURL() {
  try {
    const r = await fetch('iconos/insignia.png');
    const b = await r.blob();
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  } catch { return null; }
}

const fmt = (n) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + ' €';
const pct = (n) => `${Number(n).toLocaleString('es-ES')} %`;

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------
export async function pdfFactura(f) {
  const jsPDF = await cargarJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 18, W = 210 - M * 2;
  const violeta = [106, 61, 180], tinta = [24, 21, 28], suave = [108, 100, 117];
  let y = 20;

  const logo = await logoDataURL();
  if (logo) doc.addImage(logo, 'PNG', M, y - 4, 24, 24);
  const xCab = logo ? M + 30 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...tinta);
  doc.text(f.emisor.nombre || f.emisor.razon_social || '', xCab, y + 2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...suave);
  const emisor = [
    f.emisor.razon_social && f.emisor.razon_social !== f.emisor.nombre ? f.emisor.razon_social : null,
    `NIF: ${f.emisor.nif}`,
    f.emisor.direccion,
    [f.emisor.cp, f.emisor.poblacion, f.emisor.provincia].filter(Boolean).join(' '),
    [f.emisor.telefono, f.emisor.email].filter(Boolean).join(' · '),
  ].filter(Boolean);
  emisor.forEach((t, i) => doc.text(t, xCab, y + 8 + i * 4.3));

  doc.setFont('helvetica', 'bold'); doc.setFontSize(f.tipo === 'completa' ? 20 : 15); doc.setTextColor(...violeta);
  doc.text(f.tipo === 'completa' ? 'FACTURA' : 'FACTURA SIMPLIFICADA', 210 - M, y + 2, { align: 'right' });
  doc.setFontSize(10); doc.setTextColor(...tinta);
  doc.text(`Nº ${f.codigo}`, 210 - M, y + 9, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...suave);
  doc.text(`Fecha de expedición: ${textoFecha(f.fecha)}`, 210 - M, y + 14, { align: 'right' });
  if (f.fecha_operacion !== f.fecha) doc.text(`Fecha de la operación: ${textoFecha(f.fecha_operacion)}`, 210 - M, y + 18.5, { align: 'right' });

  y = Math.max(y + 8 + emisor.length * 4.3, y + 22) + 8;

  if (f.receptor && f.tipo === 'completa') {
    doc.setDrawColor(229, 222, 236); doc.setFillColor(245, 240, 252);
    doc.roundedRect(M, y, W, 26, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...violeta);
    doc.text('CLIENTE', M + 4, y + 6);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...tinta); doc.setFontSize(10);
    const r = f.receptor;
    [r.nombre, `NIF: ${r.nif}`, [r.direccion, [r.cp, r.poblacion].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
      .forEach((t, i) => doc.text(String(t || ''), M + 4, y + 11.5 + i * 4.8));
    y += 34;
  }

  // Tabla de conceptos
  const cols = [M, M + 92, M + 110, M + 136, 210 - M];
  doc.setFillColor(...tinta); doc.rect(M, y, W, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
  doc.text('Concepto', cols[0] + 3, y + 5.4);
  doc.text('Cant.', cols[1] + 14, y + 5.4, { align: 'right' });
  doc.text('Precio', cols[2] + 22, y + 5.4, { align: 'right' });
  doc.text('IVA', cols[3] + 12, y + 5.4, { align: 'right' });
  doc.text('Importe', cols[4] - 3, y + 5.4, { align: 'right' });
  y += 8;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...tinta);
  for (const l of f.lineas) {
    const nombre = doc.splitTextToSize(String(l.nombre), 86);
    const alto = Math.max(7, nombre.length * 4.4 + 2.6);
    if (y + alto > 260) { doc.addPage(); y = 20; }
    doc.text(nombre, cols[0] + 3, y + 5);
    doc.text(String(Number(l.cantidad)), cols[1] + 14, y + 5, { align: 'right' });
    doc.text(fmt(l.precio_unit), cols[2] + 22, y + 5, { align: 'right' });
    doc.text(pct(l.iva_pct), cols[3] + 12, y + 5, { align: 'right' });
    doc.text(fmt(l.importe_bruto ?? l.importe), cols[4] - 3, y + 5, { align: 'right' });
    y += alto;
    doc.setDrawColor(229, 222, 236); doc.line(M, y, 210 - M, y);
  }
  const bruto = f.lineas.reduce((a, l) => a + Number(l.importe_bruto ?? l.importe), 0);
  const desc = Math.round((bruto - Number(f.total)) * 100) / 100;

  y += 6;
  const xEt = 210 - M - 62, xVal = 210 - M - 3;
  const fila = (et, val, negrita = false) => {
    doc.setFont('helvetica', negrita ? 'bold' : 'normal');
    doc.text(et, xEt, y); doc.text(val, xVal, y, { align: 'right' }); y += 5.5;
  };
  doc.setFontSize(9.5); doc.setTextColor(...tinta);
  if (desc > 0.004) { fila('Suma', fmt(bruto)); fila('Descuento', '-' + fmt(desc)); }
  for (const g of f.desglose_iva) {
    fila(`Base imponible (${pct(g.iva_pct)})`, fmt(g.base));
    fila(`Cuota IVA ${pct(g.iva_pct)}`, fmt(g.cuota));
  }
  y += 1;
  doc.setFillColor(...violeta); doc.roundedRect(xEt - 4, y - 4.5, 62 + 7, 11, 2, 2, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(12);
  doc.setFont('helvetica', 'bold'); doc.text('TOTAL', xEt, y + 2.6); doc.text(fmt(f.total), xVal, y + 2.6, { align: 'right' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...suave);
  doc.text(f.tipo === 'completa' ? 'Precios con IVA incluido.' : 'Precios con IVA incluido. Factura simplificada.', M, 280);
  doc.text('Gracias por tu visita', 210 - M, 280, { align: 'right' });

  return doc.output('blob');
}

// ---------------------------------------------------------------------
// Pedir datos de la factura
// ---------------------------------------------------------------------
function pedirDatos(clienta) {
  const tieneDatos = clienta?.nif && clienta?.direccion;
  return new Promise((resolve) => {
    let hecho = false;
    const { el, cerrar } = abrirHoja(`
      <form novalidate>
        <header class="hoja-cabecera">
          <h2 class="hoja-titulo">Factura</h2>
          <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
        </header>
        <div class="hoja-cuerpo">
          <fieldset class="campo tipos-factura">
            <legend>Tipo de factura</legend>
            <label class="opcion-grande"><input type="radio" name="tipo" value="simplificada" ${tieneDatos ? '' : 'checked'}>
              <span><strong>Simplificada</strong><small>Sin datos de la clienta. La normal para particulares.</small></span></label>
            <label class="opcion-grande"><input type="radio" name="tipo" value="completa" ${tieneDatos ? 'checked' : ''}>
              <span><strong>Completa</strong><small>Con nombre, NIF y dirección de la clienta (si te la pide para su empresa o para deducirla).</small></span></label>
          </fieldset>
          <div class="datos-receptor" ${tieneDatos ? '' : 'hidden'}>
            <label class="campo"><span>Nombre o razón social</span><input name="nombre" value="${esc(nombreCompleto(clienta) === 'Clienta eliminada' ? '' : nombreCompleto(clienta))}"></label>
            <div class="fila-2">
              <label class="campo"><span>NIF</span><input name="nif" value="${esc(clienta?.nif || '')}" autocapitalize="characters"></label>
              <label class="campo"><span>Email (opcional)</span><input name="email" type="email" value="${esc(clienta?.email || '')}"></label>
            </div>
            <label class="campo"><span>Dirección</span><input name="direccion" value="${esc(clienta?.direccion || '')}"></label>
            <div class="fila-2">
              <label class="campo"><span>Código postal</span><input name="cp" value="${esc(clienta?.cp || '')}"></label>
              <label class="campo"><span>Población</span><input name="poblacion" value="${esc(clienta?.poblacion || '')}"></label>
            </div>
            ${clienta?.id ? '<label class="check"><input type="checkbox" name="guardar" checked> Guardar estos datos en la ficha de la clienta</label>' : ''}
          </div>
        </div>
        <footer class="hoja-pie">
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button class="btn btn-azul">Hacer factura</button>
        </footer>
      </form>`, { alCerrar: () => { if (!hecho) resolve(null); } });
    const form = el.querySelector('form');
    form.addEventListener('change', (e) => {
      if (e.target.name === 'tipo') el.querySelector('.datos-receptor').hidden = e.target.value !== 'completa';
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const tipo = form.elements.tipo.value;
      const r = {};
      if (tipo === 'completa') {
        for (const k of ['nombre', 'nif', 'email', 'direccion', 'cp', 'poblacion']) r[k] = form.elements[k].value.trim();
        if (!r.nombre || !r.nif || !r.direccion) return aviso('Para la factura completa hacen falta nombre, NIF y dirección.', 'error');
      }
      hecho = true;
      resolve({ tipo, receptor: r, guardar: tipo === 'completa' && form.elements.guardar?.checked });
      cerrar();
    });
  });
}

// ---------------------------------------------------------------------
// Entregar: compartir (email, WhatsApp…) o descargar
// ---------------------------------------------------------------------
export async function entregarFactura(f) {
  let blob;
  try { cargando(true); blob = await pdfFactura(f); }
  catch (e) { return errorAviso(e, 'No se pudo crear el PDF'); }
  finally { cargando(false); }
  const nombre = `Factura_${f.codigo}.pdf`;
  const archivo = new File([blob], nombre, { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const puedeCompartir = !!(navigator.canShare && navigator.canShare({ files: [archivo] }));
  const { el } = abrirHoja(`
    <div class="hoja-cuerpo factura-lista">
      <p class="factura-icono" aria-hidden="true">✓</p>
      <h2 class="hoja-titulo">Factura ${esc(f.codigo)}</h2>
      <p class="texto-suave">${f.tipo === 'completa' ? `Para ${esc(f.receptor?.nombre || '')}` : 'Factura simplificada'} · ${euros(f.total)}</p>
      <div class="acciones-factura">
        ${puedeCompartir ? '<button class="btn btn-azul" data-compartir>Enviar (correo, WhatsApp…)</button>' : ''}
        <a class="btn ${puedeCompartir ? '' : 'btn-azul'}" href="${url}" download="${esc(nombre)}">Descargar PDF</a>
        <a class="btn" href="${url}" target="_blank" rel="noopener">Ver</a>
      </div>
      <button class="btn" data-cerrar>Cerrar</button>
    </div>`, { ancho: 'estrecha', alCerrar: () => setTimeout(() => URL.revokeObjectURL(url), 60000) });
  el.querySelector('[data-compartir]')?.addEventListener('click', async () => {
    try {
      await navigator.share({ files: [archivo], title: `Factura ${f.codigo}`, text: `Factura ${f.codigo} de ${f.emisor.nombre}` });
    } catch (e) { if (e.name !== 'AbortError') errorAviso(e, 'No se pudo compartir'); }
  });
}

// ---------------------------------------------------------------------
// Flujo: pedir datos (antes de cobrar) → emitir → PDF
// ---------------------------------------------------------------------
export async function pedirDatosFactura(clientaId) {
  let clienta = null;
  if (clientaId) { try { clienta = await db.obtenerClienta(clientaId); } catch { /* sin datos */ } }
  const datos = await pedirDatos(clienta);
  return datos ? { ...datos, clienta } : null;
}

export async function emitirYEntregar(cobroId, datos) {
  try {
    cargando(true);
    const id = await db.emitirFactura(cobroId, datos.tipo, datos.receptor);
    if (datos.guardar && datos.clienta) {
      const { nif, direccion, cp, poblacion, email } = datos.receptor;
      try { await db.guardarClienta({ ...datos.clienta, nif, direccion, cp, poblacion, email: email || datos.clienta.email }); } catch { /* no es grave */ }
    }
    const f = await db.obtenerFactura(id);
    cargando(false);
    await entregarFactura(f);
    return f;
  } catch (e) {
    cargando(false);
    const msg = e?.message || '';
    if (/Ajustes/.test(msg)) aviso(`${msg}. El cobro sí está guardado: haz la factura desde el cobro cuando lo completes.`, 'error');
    else errorAviso(e, 'No se pudo hacer la factura (el cobro sí está guardado)');
    return null;
  }
}

// Desde un cobro ya registrado
export async function hacerFactura(cobroId, clientaId) {
  const datos = await pedirDatosFactura(clientaId);
  if (!datos) return null;
  return emitirYEntregar(cobroId, datos);
}

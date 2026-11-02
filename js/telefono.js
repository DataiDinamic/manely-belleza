// Llamar y enviar SMS. En un móvil se hace directamente; en la tablet o el
// ordenador (que normalmente no pueden llamar) se muestra un código QR: se
// escanea con la cámara del móvil y el móvil marca el número o abre el SMS
// con el mensaje ya escrito.
import { esc, abrirHoja } from './util.js';
import { leerAjustes } from './ajustes.js';

const QR = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

// ¿Este dispositivo puede llamar? (se puede cambiar en Ajustes → En este dispositivo)
export function puedeLlamarAqui() {
  const aj = leerAjustes().llamadas;
  if (aj === 'aqui') return true;
  if (aj === 'qr') return false;
  const tactil = matchMedia('(pointer: coarse)').matches;
  return tactil && Math.min(screen.width, screen.height) < 600;   // un móvil, no una tablet
}

// Número para tel: y sms: (con prefijo +34 si no lo lleva)
export function numeroTel(t) {
  let d = String(t || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+') && d.length === 9) d = '+34' + d;
  return d;
}

const enlaceLlamada = (tel) => `tel:${numeroTel(tel)}`;
const enlaceSMS = (tel, texto) => `sms:${numeroTel(tel)}?body=${encodeURIComponent(texto)}`;

function cargarQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = QR;
    s.onload = () => (window.qrcode ? ok(window.qrcode) : mal(new Error('No se pudo cargar el QR')));
    s.onerror = () => mal(new Error('No se pudo cargar el QR. Comprueba la conexión a internet.'));
    document.head.appendChild(s);
  });
}

async function hojaQR({ titulo, subtitulo, enlace, explicacion, botonAqui }) {
  const { el } = abrirHoja(`
    <div class="hoja-cuerpo hoja-qr">
      <header class="hoja-cabecera sin-borde">
        <div><h2 class="hoja-titulo">${esc(titulo)}</h2>${subtitulo ? `<p class="texto-suave">${esc(subtitulo)}</p>` : ''}</div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </header>
      <div class="qr" aria-label="Código QR">Cargando…</div>
      <p class="qr-explicacion">${esc(explicacion)}</p>
      <div class="hoja-pie sin-borde">
        <a class="btn" href="${esc(enlace)}" data-cerrar>${esc(botonAqui)}</a>
        <button type="button" class="btn btn-principal" data-cerrar>Hecho</button>
      </div>
    </div>`, { ancho: 'estrecha' });
  try {
    const qrcode = await cargarQR();
    const qr = qrcode(0, 'L');
    qr.addData(enlace);
    qr.make();
    el.querySelector('.qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } catch (e) {
    el.querySelector('.qr').textContent = e.message;
  }
}

export function llamar(clienta) {
  const tel = numeroTel(clienta?.telefono);
  if (!tel) return;
  if (puedeLlamarAqui()) { location.href = enlaceLlamada(tel); return; }
  hojaQR({
    titulo: `Llamar a ${clienta.nombre || ''}`.trim(),
    subtitulo: clienta.telefono,
    enlace: enlaceLlamada(tel),
    explicacion: 'Abre la cámara de tu móvil y apunta al código: el móvil marcará el número.',
    botonAqui: 'Llamar desde este dispositivo',
  });
}

export function enviarSMS(clienta, texto) {
  const tel = numeroTel(clienta?.telefono);
  if (!tel) return;
  if (puedeLlamarAqui()) { location.href = enlaceSMS(tel, texto); return; }
  hojaQR({
    titulo: `SMS a ${clienta.nombre || ''}`.trim(),
    subtitulo: clienta.telefono,
    enlace: enlaceSMS(tel, texto),
    explicacion: 'Abre la cámara de tu móvil y apunta al código: se abrirán los mensajes del móvil con el texto ya escrito. Solo queda pulsar enviar.',
    botonAqui: 'Enviar desde este dispositivo',
  });
}

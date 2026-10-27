// Ajustes de este dispositivo (horario dibujado, bloqueo)
import { CONFIG } from './config.js';

const CLAVE = 'mb_ajustes_v1';
const POR_DEFECTO = { apertura: CONFIG.APERTURA, cierre: CONFIG.CIERRE, bloqueo: CONFIG.BLOQUEO_MINUTOS };

export function leerAjustes() {
  try { return { ...POR_DEFECTO, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; }
  catch { return { ...POR_DEFECTO }; }
}

export function guardarAjustes(cambios) {
  const a = { ...leerAjustes(), ...cambios };
  try { localStorage.setItem(CLAVE, JSON.stringify(a)); } catch { /* */ }
  return a;
}

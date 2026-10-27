// Rellenar con los datos de tu proyecto Supabase:
//  - SUPABASE_URL: Project Settings > Data API > "Project URL"
//  - SUPABASE_KEY: Project Settings > API Keys > "Publishable key" (empieza por sb_publishable_)
// Esta clave es pública a propósito: lo que protege los datos son las reglas
// de seguridad del archivo supabase/001_fase1.sql y el inicio de sesión.
// Mientras estén vacíos, la app arranca en modo demostración
// (datos de ejemplo guardados solo en este navegador).
export const CONFIG = {
  SUPABASE_URL: 'https://imgwnaokyoqrinqqzgig.supabase.co',
  SUPABASE_KEY: 'sb_publishable_0L0n-dM2Q6i-mBcd246vBA_r58xh9Yg',

  NOMBRE_NEGOCIO: 'Manely Belleza',

  // Horario que se dibuja en la agenda (se puede cambiar en Ajustes)
  APERTURA: '09:00',
  CIERRE: '21:00',

  // Bloqueo con PIN tras este tiempo sin usar la app
  BLOQUEO_MINUTOS: 5,
};

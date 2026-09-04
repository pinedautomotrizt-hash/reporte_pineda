// Metas mensuales de facturación oficial sin IGV. Se ajustan aquí cuando el
// negocio redefina el objetivo de una sede/año (no requiere migración de
// base de datos, solo redeploy).
//
// Cada año acepta un número fijo (misma meta los 12 meses) o un arreglo de
// 12 valores [Ene, Feb, Mar, Abr, May, Jun, Jul, Ago, Sep, Oct, Nov, Dic]
// cuando la meta cambia dentro del año.
export const METAS_ANUALES = {
  "Pineda Callao": {
    2025: 350000,
    // Sube de 400,000 a 418,000 a partir de julio.
    2026: [400000, 400000, 400000, 400000, 400000, 400000, 418000, 418000, 418000, 418000, 418000, 418000],
  },
  "Pineda Trujillo": {
    // Trujillo abrió en 2025: sin meta en ningún mes del año de apertura.
    2025: 0,
    2026: 200000,
  },
};

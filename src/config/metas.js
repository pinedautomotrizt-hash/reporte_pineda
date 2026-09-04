// Metas mensuales de facturación oficial sin IGV. Se ajustan aquí cuando el
// negocio redefina el objetivo de una sede/año (no requiere migración de
// base de datos, solo redeploy).
//
// Cada año acepta un número fijo (misma meta los 12 meses) o un arreglo de
// 12 valores [Ene, Feb, Mar, Abr, May, Jun, Jul, Ago, Sep, Oct, Nov, Dic]
// cuando la meta cambia dentro del año.
export const METAS_ANUALES = {
  "Pineda Callao": { 2025: 418000, 2026: 418000 },
  "Pineda Trujillo": {
    // Trujillo abrió en 2025: sin meta en la apertura (Ene-Abr), 100,000
    // de mayo a setiembre, y 150,000 en el último trimestre.
    2025: [0, 0, 0, 0, 100000, 100000, 100000, 100000, 100000, 150000, 150000, 150000],
    2026: 200000,
  },
};

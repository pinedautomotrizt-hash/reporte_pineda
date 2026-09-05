// Marcas de REPUESTOS (fabricantes de piezas, no de vehiculos) mas
// conocidas del mercado para un taller/tienda automotriz. No viene de tus
// reportes (esa columna no existe ahi) — es una lista curada, agrupada por
// especialidad, para que la valides/ajustes antes de usarla en la
// codificacion. Incluye las 3 que ya tenias en el generador (Filcar,
// Sakura, Willybosch, etc.) mas las marcas globales mas comunes por rubro.
export const MARCA_REPUESTO = [
  // -- filtros --
  ['Mann Filter', 'MNF', 'Filtros'],
  ['Fram', 'FRM', 'Filtros'],
  ['Purolator', 'PUR', 'Filtros'],
  ['WIX', 'WIX', 'Filtros'],
  // -- frenos --
  ['Brembo', 'BR', 'Frenos'],
  ['ATE', 'ATE', 'Frenos'],
  ['TRW', 'TRW', 'Frenos'],
  ['Wagner', 'WAG', 'Frenos'],
  ['Monroe', 'MON', 'Frenos / Suspensión'],
  // -- encendido / electrico --
  ['NGK', 'NGK', 'Encendido'],
  ['Denso', 'DEN', 'Encendido / Eléctrico'],
  ['Bosch', 'BO', 'Eléctrico / Multi-rubro'],
  ['Champion', 'CHM', 'Encendido'],
  ['Valeo', 'VL', 'Eléctrico / Embrague'],
  ['Delco', 'DEL', 'Eléctrico'],
  // -- suspension / direccion --
  ['KYB', 'KYB', 'Suspensión'],
  ['Gabriel', 'GAB', 'Suspensión'],
  ['Moog', 'MOG', 'Suspensión / Dirección'],
  // -- embrague / transmision --
  ['LUK', 'LK', 'Embrague'],
  ['Sachs', 'SAC', 'Embrague'],
  ['Exedy', 'EX', 'Embrague'],
  // -- correas, mangueras, refrigeracion --
  ['Gates', 'GAT', 'Correas / Mangueras'],
  ['Continental', 'CONT', 'Correas / Mangueras'],
  ['Dayco', 'DAY', 'Correas / Mangueras'],
  // -- rodamientos --
  ['SKF', 'SKF', 'Rodamientos'],
  ['Timken', 'TIM', 'Rodamientos'],
  ['NSK', 'NSK', 'Rodamientos'],
  ['FAG', 'FAG', 'Rodamientos'],
  // -- marcas locales / distribuidoras que ya usabas --
  ['Filcar', 'FI', 'Multi-rubro (local)'],
  ['Sakura', 'SK', 'Filtros (local)'],
  ['Willybosch', 'WB', 'Multi-rubro (local)'],
];

// Detecta, por palabras clave en la Descripcion, los codigos que en
// realidad son ropa de trabajo o Equipo de Proteccion Personal (EPP) —
// hoy repartidos sin criterio entre Insumos/Suministros/Repuestos/Accesorios.
export const PATRON_ROPA_EPP =
  /PANTALON|BOTA|GUANTE|CASCO|LENTE|CHALECO|ZAPATO|OVEROL|MAMELUCO|CAMISA|POLO(?!EA)|GORRA|MASCARILLA|RESPIRADOR|TAPA ?OIDO|ARNES|CORREA DE SEGURIDAD|UNIFORME/;

export function esRopaEpp(descripcion) {
  return PATRON_ROPA_EPP.test((descripcion || '').toString().toUpperCase());
}

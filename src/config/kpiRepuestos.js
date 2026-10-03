// Catalogo de repuestos sobre los que se mide vida util en el modulo KPI.
//
// La lista salio de medir TODO el catalogo facturado y quedarse solo con lo que
// sostiene un calculo: se exigio un minimo de 20 reemplazos encadenados sobre la
// misma placa. Lo que no llegaba a eso se retiro, porque mostrar una cifra con
// dos o cuatro casos invita a decidir compras sobre ruido.
//
// Cada entrada define:
//   id        clave estable que usa el frontend (no cambiar: viaja en la URL).
//   label     nombre para mostrar.
//   zona      pieza del despiece del vehiculo a la que pertenece.
//   naturaleza  "desgaste"   la pieza se cambia cuando se acaba -> es vida util
//               "programado" se cambia porque toca el servicio -> es intervalo
//                            de mantenimiento, NO vida util. Son cosas distintas
//                            y mezclarlas haria que ninguna de las dos signifique
//                            algo (ver nota al final).
//   patrones  LIKE que identifican la pieza en detalle_factura_ot.descripcion.
//   excluir   LIKE que descartan falsos positivos del patron anterior.
//   variante  separa delantero/posterior cuando aplica, porque el desgaste de un
//             eje no es comparable con el del otro.
//   vidaRef   referencia del fabricante en km. Solo para contrastar; no entra en
//             ningun calculo.
//
// Los patrones se comparan en mayusculas contra la descripcion de la linea.
export const KPI_REPUESTOS = Object.freeze([
  // ----------------------------------------------- piezas de desgaste (MTTF)
  {
    id: "pastillas-freno",
    label: "Pastillas de freno",
    zona: "frenos",
    naturaleza: "desgaste",
    patrones: ["%PASTILLA%"],
    excluir: [],
    variante: true,
    vidaRef: 40000,
  },
  {
    id: "zapatas-freno",
    label: "Zapatas de freno",
    zona: "frenos",
    naturaleza: "desgaste",
    patrones: ["%ZAPATA%"],
    excluir: [],
    variante: false,
    vidaRef: 60000,
  },
  {
    id: "amortiguador",
    label: "Amortiguador",
    zona: "suspension",
    naturaleza: "desgaste",
    patrones: ["%AMORTIGUA%"],
    excluir: [],
    variante: true,
    vidaRef: 80000,
  },
  {
    id: "bateria",
    label: "Batería",
    zona: "electrico",
    naturaleza: "desgaste",
    // Los bornes y cables se cambian solos, sin tocar la bateria.
    patrones: ["%BATERIA%"],
    excluir: ["%BORNE%", "%CABLE%"],
    variante: false,
    vidaRef: 60000,
  },
  {
    id: "bujias",
    label: "Bujías",
    zona: "motor",
    naturaleza: "desgaste",
    patrones: ["%BUJIA%"],
    excluir: ["%CABLE%"],
    variante: false,
    vidaRef: 40000,
  },
  {
    id: "faja-accesorios",
    label: "Faja de accesorios",
    zona: "motor",
    naturaleza: "desgaste",
    // El templador es otra pieza: se cambia aparte y con otra frecuencia.
    patrones: ["%FAJA%ACCESORIO%", "%CORREA%ACCESORIO%"],
    excluir: ["%TEMPLADOR%", "%TENSOR%"],
    variante: false,
    vidaRef: 60000,
  },
  {
    id: "plumillas",
    label: "Plumillas",
    zona: "electrico",
    naturaleza: "desgaste",
    patrones: ["%PLUMILLA%"],
    excluir: [],
    variante: false,
    vidaRef: 20000,
  },

  // ------------------------------------- mantenimiento programado (intervalo)
  {
    id: "filtro-aceite",
    label: "Filtro de aceite",
    zona: "motor",
    naturaleza: "programado",
    patrones: ["%FILTRO%ACEITE%", "%FLTRO%ACEITE%"],
    excluir: ["%TAPA%", "%LLAVE%"],
    variante: false,
    vidaRef: 10000,
  },
  {
    id: "filtro-aire",
    label: "Filtro de aire",
    zona: "motor",
    naturaleza: "programado",
    patrones: ["%FILTRO%AIRE%"],
    excluir: ["%ACONDICIONADO%", "%A/C%", "%CABINA%"],
    variante: false,
    vidaRef: 20000,
  },
  {
    id: "filtro-cabina",
    label: "Filtro de cabina",
    zona: "electrico",
    naturaleza: "programado",
    patrones: ["%FILTRO%CABINA%", "%FILTRO%A/C%", "%FILTRO%AIRE ACONDICIONADO%"],
    excluir: [],
    variante: false,
    vidaRef: 20000,
  },
  {
    id: "filtro-combustible",
    label: "Filtro de combustible",
    zona: "combustible",
    naturaleza: "programado",
    patrones: ["%FILTRO%COMBUSTIBLE%", "%FILTRO%PETROLEO%", "%FILTRO%GASOLINA%"],
    excluir: [],
    variante: false,
    vidaRef: 30000,
  },
]);

// Retirados del catalogo por no sostener el calculo (reemplazos encadenados
// medidos sobre el historial completo, septiembre 2026):
//   rotula 4 · disco de freno 2 · terminal de direccion 1
//   embrague 15 · correa de distribucion 18   (bajo el minimo de 20)
//   bomba de agua 0 · bomba de combustible 0  (ninguna fallo todavia)
// Volver a incluirlos cuando acumulen historial: basta con agregarlos aqui.

export const KPI_REPUESTOS_POR_ID = Object.freeze(
  Object.fromEntries(KPI_REPUESTOS.map((repuesto) => [repuesto.id, repuesto])),
);

// Por que "desgaste" y "programado" no se promedian juntos:
// una pastilla se cambia cuando se acaba, asi que el kilometraje entre cambios
// es su vida util. Un filtro de aceite se cambia porque toca el servicio, asi
// que ese mismo numero mide la politica de mantenimiento del taller, no cuanto
// aguanta el filtro. Son dos preguntas distintas y el modulo las separa.
export const KPI_NATURALEZAS = Object.freeze({
  desgaste: {
    label: "Vida útil",
    detalle: "La pieza se cambia cuando se acaba",
  },
  programado: {
    label: "Intervalo de servicio",
    detalle: "Se cambia por plan de mantenimiento, no por falla",
  },
});

export const KPI_LIMITES = Object.freeze({
  kmMinimoValido: 100,
  intervaloMinimo: 2000,
  intervaloMaximo: 200000,
  muestraMinima: 20,
});

// Grupos de cliente que se consideran flota: son los vehiculos cuyo historial
// de mantenimiento esta completo en el taller, que es la condicion para poder
// encadenar reemplazos sin huecos.
export const KPI_GRUPOS_FLOTA = Object.freeze(["FLOTAS"]);

// Catalogo de repuestos sobre los que se mide vida util (MTTF) en el modulo KPI.
//
// Cada entrada define:
//   id       clave estable que usa el frontend (no cambiar: viaja en la URL).
//   label    nombre para mostrar.
//   zona     pieza del despiece del vehiculo a la que pertenece.
//   patrones LIKE que identifican la pieza en detalle_factura_ot.descripcion.
//   excluir  LIKE que descartan falsos positivos del patron anterior.
//   variante campo opcional: separa delantero/posterior cuando aplica, porque
//            el desgaste de un eje no es comparable con el del otro.
//   vidaRef  vida util de referencia del fabricante, en km. Solo sirve para
//            contrastar contra lo medido; no entra en ningun calculo.
//
// Los patrones se comparan en mayusculas contra la descripcion de la linea.
export const KPI_REPUESTOS = Object.freeze([
  {
    id: "pastillas-freno",
    label: "Pastillas de freno",
    zona: "frenos",
    patrones: ["%PASTILLA%"],
    excluir: [],
    variante: true,
    vidaRef: 40000,
  },
  {
    id: "disco-freno",
    label: "Disco de freno",
    zona: "frenos",
    patrones: ["%DISCO%FRENO%"],
    excluir: ["%EMBRAGUE%"],
    variante: true,
    vidaRef: 70000,
  },
  {
    id: "amortiguador",
    label: "Amortiguador",
    zona: "suspension",
    patrones: ["%AMORTIGUA%"],
    excluir: [],
    variante: true,
    vidaRef: 80000,
  },
  {
    id: "rotula",
    label: "Rótula",
    zona: "suspension",
    patrones: ["%ROTULA%"],
    excluir: [],
    variante: false,
    vidaRef: 90000,
  },
  {
    id: "bomba-agua",
    label: "Bomba de agua",
    zona: "motor",
    patrones: ["%BOMBA%AGUA%"],
    excluir: [],
    variante: false,
    vidaRef: 100000,
  },
  {
    id: "correa-distribucion",
    label: "Correa de distribución",
    zona: "motor",
    patrones: ["%DISTRIBUCION%", "%CORREA%DENTADA%"],
    excluir: ["%TAPA%"],
    variante: false,
    vidaRef: 90000,
  },
  {
    id: "bomba-combustible",
    label: "Bomba de combustible",
    zona: "combustible",
    patrones: ["%BOMBA%COMBUSTIBLE%", "%BOMBA%GASOLINA%"],
    excluir: [],
    variante: false,
    vidaRef: 120000,
  },
  {
    id: "bateria",
    label: "Batería",
    zona: "electrico",
    patrones: ["%BATERIA%"],
    excluir: ["%BORNE%", "%CABLE%"],
    variante: false,
    vidaRef: 60000,
  },
  {
    id: "embrague",
    label: "Embrague",
    zona: "transmision",
    patrones: ["%EMBRAGUE%"],
    excluir: ["%BOMBA%", "%CANERIA%"],
    variante: false,
    vidaRef: 120000,
  },
]);

export const KPI_REPUESTOS_POR_ID = Object.freeze(
  Object.fromEntries(KPI_REPUESTOS.map((r) => [r.id, r])),
);

// Reglas de saneamiento del odometro. Un intervalo fuera de estos limites no
// se descarta en silencio: se reporta aparte con su motivo, para que el taller
// pueda corregir la captura en recepcion.
export const KPI_LIMITES = Object.freeze({
  // Lecturas por debajo de esto son el relleno que graba el ERP cuando nadie
  // anoto el odometro (se ven muchos "1" y "0"), no un vehiculo nuevo.
  kmMinimoValido: 100,
  // Un cambio a los pocos kilometros no es desgaste: es garantia, siniestro o
  // un error de digitacion.
  intervaloMinimo: 2000,
  // Por arriba, un salto asi grande casi siempre significa que en el medio
  // hubo un cambio que no se registro en el taller.
  intervaloMaximo: 200000,
  // Debajo de esta cantidad de intervalos el promedio no representa nada y la
  // vista lo advierte en vez de mostrar el numero a secas.
  muestraMinima: 20,
});

// Grupos de cliente que se consideran "flota": vuelven siempre al mismo taller,
// por lo que su historial de reemplazos esta completo y el intervalo medido es
// real. En particulares se pierden los cambios hechos fuera y el resultado sale
// inflado, por eso el modulo trabaja sobre flota por defecto.
export const KPI_GRUPOS_FLOTA = Object.freeze(["FLOTAS"]);

// Cartera de clientes por asesora: define quien hace el SEGUIMIENTO.
//
// Es distinto de "ultimo asesor" del reporte, que solo dice quien atendio la
// ultima vez. Un vehiculo puede haber sido atendido por alguien que ya no
// trabaja; el seguimiento igual tiene que tener dueno.
//
// Cada patron se compara contra cliente_nombre en mayusculas. Basta que el
// patron este contenido en el nombre.
export const CARTERA_ASESORAS = Object.freeze({
  "Pineda Trujillo": {
    "KAREN ROSAS": [
      "MAREAUTO",                 // Mareautos
      "RENTING S.A.C",            // Euro Renting
      "DANPER",                   // Damper
      "TECNOLOGICA DE ALIMENTOS", // TASA
      "LAREDO",                   // Laredo
      "YOFC",                     // YOF
      "VETA DORADA",              // Veta Dorada
    ],
    "MARIA VALERIANO": [
      "ALD AUTOMOTIVE",
      "ANC PERU",
      "MARCO PERUANA",
      "NASA",
      "SAVI",
      // Cuenta heredada: Fiorella Cabrejos la llevaba (722 OT) y al salir
      // paso a Maria, que es quien la atiende hoy (105 OT, la mas reciente).
      "RENTAEQUIPOS",
    ],
  },
});

// Asesoras que ya no estan activas: su nombre sigue apareciendo como "ultimo
// asesor" en reportes historicos, pero no se les puede asignar seguimiento.
export const ASESORAS_INACTIVAS = Object.freeze([
  "FIORELLA CABREJOS",
  "LETICIA RODRIGUEZ",
]);

/**
 * Resuelve quien da seguimiento a una fila.
 * 1) Si el cliente esta en una cartera, manda la cartera.
 * 2) Si no, vale el ultimo asesor, siempre que siga activo.
 * 3) Si el ultimo asesor ya no trabaja, queda sin asignar para revision manual.
 */
export function resolverAsesora(localNombre, clienteNombre, ultimoAsesor) {
  const cartera = CARTERA_ASESORAS[localNombre];
  const cliente = String(clienteNombre || "").toUpperCase();
  if (cartera) {
    for (const [asesora, patrones] of Object.entries(cartera)) {
      if (patrones.some((patron) => cliente.includes(patron))) return asesora;
    }
  }
  const ultimo = String(ultimoAsesor || "").trim().toUpperCase();
  if (!ultimo || ASESORAS_INACTIVAS.includes(ultimo)) return null;
  return ultimo;
}

// El nombre de la asesora viene en dos formatos distintos segun la fuente:
//   usuario.us_asesor_nombre / orden_trabajo.asesor -> "APELLIDOS NOMBRES"
//   reporte de seguimiento (ultimo_asesor)          -> "NOMBRE APELLIDO"
// Sin esta equivalencia, una asesora logueada no encontraria sus propias filas.
// Ojo: la tabla `asesor` escribe CADEÑO y `usuario` escribe CEDEÑO para Karen;
// se aceptan ambas grafias a proposito, hasta que se corrija el dato de origen.
export const ALIAS_ASESORAS = Object.freeze({
  "ROSAS CEDENO KAREN GINEHT": "KAREN ROSAS",
  "ROSAS CADENO KAREN GINEHT": "KAREN ROSAS",
  "VALERIANO VASQUEZ MARIA ISABEL": "MARIA VALERIANO",
  "CHOMBA GALVEZ KASSANDRA": "KASSANDRA CHOMBA",
});

const sinTildes = (valor) => String(valor || "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toUpperCase()
  .trim();

/** Traduce el nombre con el que una asesora inicia sesion al que usa el reporte. */
export function asesoraDesdeUsuario(usAsesorNombre) {
  const clave = sinTildes(usAsesorNombre);
  if (!clave) return null;
  return ALIAS_ASESORAS[clave] || usAsesorNombre;
}

// Estados con los que la asesora gestiona cada seguimiento. Viven en
// sg_estado, no en `estado` (esa columna la reescribe el ERP en cada carga).
// El orden es el del embudo y es el que usa el frontend para ordenar fichas.
export const SEGUIMIENTO_ESTADOS = Object.freeze([
  { id: "PENDIENTE",   label: "Pendiente",     cierra: false },
  { id: "CONTACTADO",  label: "Contactado",    cierra: false },
  { id: "AGENDADO",    label: "Cita agendada", cierra: false },
  { id: "NO_CONTESTA", label: "No contesta",   cierra: false },
  { id: "ATENDIDO",    label: "Atendido",      cierra: true },
  { id: "NO_DESEA",    label: "No desea",      cierra: true },
]);

export const SEGUIMIENTO_ESTADOS_IDS = Object.freeze(
  SEGUIMIENTO_ESTADOS.map((estado) => estado.id),
);

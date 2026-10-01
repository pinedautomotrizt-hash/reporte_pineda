import pool, { query } from "../db.js";
import {
  SEGUIMIENTO_ESTADOS,
  SEGUIMIENTO_ESTADOS_IDS,
  asesoraDesdeUsuario,
} from "../config/carteraAsesoras.js";

// ---------------------------------------------------------------------------
// Seguimiento de mantenimientos: la lista de vehiculos a los que toca llamar
// porque les vence el servicio. La data la trae el ERP (reporte RepManVehVen,
// cargado desde Importaciones) y cada asesora gestiona unicamente su cartera.
//
// Dos estados convive aqui y no hay que confundirlos:
//   estado     -> lo dice el ERP (vacio o ATENDIDO). Solo lectura: el
//                 importador lo reescribe en cada carga.
//   sg_estado  -> lo gestiona la asesora. Es el unico que ella puede tocar.
// Cuando el ERP ya marco ATENDIDO, eso manda: el seguimiento esta cerrado
// aunque la asesora no haya alcanzado a registrarlo.
// ---------------------------------------------------------------------------

const ESTADOS_QUE_CIERRAN = new Set(
  SEGUIMIENTO_ESTADOS.filter((estado) => estado.cierra).map((estado) => estado.id),
);

// Estado efectivo de una fila, resolviendo la precedencia ERP > asesora.
const ERP_ATENDIDO = "ATENDIDO";

// Columnas que se devuelven al frontend. Se listan explicitamente para no
// filtrar campos internos y para que el contrato del endpoint sea evidente.
const CAMPOS = `
  sm_id                AS id,
  local_nombre         AS local,
  placa,
  marca,
  modelo,
  version,
  cliente_documento    AS clienteDocumento,
  cliente_nombre       AS cliente,
  contacto,
  telefono,
  fec_penul_servicio   AS fecPenultimoServicio,
  fec_ult_servicio     AS fecUltimoServicio,
  ultimo_asesor        AS ultimoAsesor,
  recomendacion,
  servicio_prop_km     AS servicioKm,
  fec_servicio_prop    AS fecServicioPropuesto,
  estado               AS estadoErp,
  fec_atencion         AS fecAtencion,
  vehiculo_alquilado   AS vehiculoAlquilado,
  contacto_alquiler    AS contactoAlquiler,
  ref_contacto         AS refContacto,
  asesora_asignada     AS asesora,
  sg_estado            AS sgEstado,
  sg_nota              AS sgNota,
  sg_proximo_contacto  AS sgProximoContacto,
  sg_cita_en           AS sgCitaEn,
  sg_actualizado_por   AS sgActualizadoPor,
  sg_actualizado_en    AS sgActualizadoEn
`;

/**
 * Resuelve de que asesora son las filas que puede ver quien pide.
 * - ASESOR_INDIVIDUAL: solo las suyas, sin posibilidad de pedir otras.
 * - ADMIN / ASESOR: todas, o las de la asesora indicada en ?asesora=.
 * Devuelve null cuando no hay que filtrar por asesora.
 */
function alcanceAsesora(req) {
  if (req.user?.rol === "ASESOR_INDIVIDUAL") {
    const propia = asesoraDesdeUsuario(req.user.asesorNombre);
    if (!propia) {
      const error = new Error("Tu usuario no tiene una asesora asignada.");
      error.status = 400;
      throw error;
    }
    return propia;
  }
  const pedida = String(req.query.asesora || "").trim();
  return pedida || null;
}

function normalizarTexto(valor) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

// Clasifica la fila en la bandeja que la asesora ve: ya cerrada, vencida
// (la fecha propuesta ya paso) o por vencer.
function clasificar(fila, hoy) {
  const cerrada = fila.estadoErp === ERP_ATENDIDO || ESTADOS_QUE_CIERRAN.has(fila.sgEstado);
  if (cerrada) return "cerrado";
  const propuesta = fila.fecServicioPropuesto ? new Date(fila.fecServicioPropuesto) : null;
  if (propuesta && propuesta.getTime() < hoy.getTime()) return "vencido";
  return "porVencer";
}

// ------------------------------------------------------------------- lectura

export const getSeguimientoMantenimiento = async (req, res, next) => {
  try {
    const asesora = alcanceAsesora(req);
    const local = normalizarTexto(req.query.local);
    const desde = normalizarTexto(req.query.desde);
    const hasta = normalizarTexto(req.query.hasta);

    const condiciones = [];
    const params = {};
    if (asesora) {
      condiciones.push("UPPER(TRIM(asesora_asignada)) = UPPER(:asesora)");
      params.asesora = asesora;
    }
    if (local) {
      condiciones.push("local_nombre = :local");
      params.local = local;
    }
    if (desde) {
      condiciones.push("fec_servicio_prop >= :desde");
      params.desde = desde;
    }
    if (hasta) {
      condiciones.push("fec_servicio_prop <= :hasta");
      params.hasta = hasta;
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const filas = await query(
      `SELECT ${CAMPOS}
         FROM seguimiento_mantenimiento
         ${where}
        ORDER BY fec_servicio_prop ASC, cliente_nombre ASC, placa ASC`,
      params,
    );

    // "Hoy" a medianoche: la comparacion es por dia, no por instante, para que
    // un servicio propuesto para hoy no salga vencido a media manana.
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const seguimientos = filas.map((fila) => ({ ...fila, bandeja: clasificar(fila, hoy) }));

    const resumen = {
      total: seguimientos.length,
      vencidos: seguimientos.filter((fila) => fila.bandeja === "vencido").length,
      porVencer: seguimientos.filter((fila) => fila.bandeja === "porVencer").length,
      cerrados: seguimientos.filter((fila) => fila.bandeja === "cerrado").length,
      sinGestion: seguimientos.filter((fila) => fila.bandeja !== "cerrado" && !fila.sgEstado).length,
    };

    // Conteo por estado de gestion, en el orden del embudo. Las filas abiertas
    // sin sg_estado se cuentan como PENDIENTE: es lo que son en la practica.
    const porEstado = SEGUIMIENTO_ESTADOS.map((estado) => ({
      ...estado,
      n: seguimientos.filter((fila) => {
        if (fila.estadoErp === ERP_ATENDIDO) return estado.id === "ATENDIDO";
        return (fila.sgEstado || "PENDIENTE") === estado.id;
      }).length,
    }));

    // Catalogo de asesoras para el selector. Una asesora solo ve su propia
    // cartera, asi que no se consulta: seria una lista que nunca se pinta.
    const soloPropias = req.user?.rol === "ASESOR_INDIVIDUAL";
    const asesoras = soloPropias ? [] : await query(
      `SELECT asesora_asignada AS asesora, COUNT(*) AS n
         FROM seguimiento_mantenimiento
        WHERE asesora_asignada IS NOT NULL
        GROUP BY asesora_asignada
        ORDER BY asesora_asignada`,
    );

    res.json({
      asesora,
      soloPropias,
      estados: SEGUIMIENTO_ESTADOS,
      asesoras,
      resumen,
      porEstado,
      seguimientos,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    next(error);
  }
};

// ---------------------------------------------------------------- escritura

export const updateSeguimientoGestion = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Seguimiento inválido." });
    }

    const { sgEstado, sgNota, sgProximoContacto, sgCitaEn } = req.body ?? {};
    const estado = normalizarTexto(sgEstado);
    if (estado && !SEGUIMIENTO_ESTADOS_IDS.includes(estado)) {
      return res.status(400).json({ message: `Estado no válido: ${estado}` });
    }

    // "YYYY-MM-DDTHH:mm" es lo que manda un <input type="datetime-local">.
    // MySQL lo quiere con espacio y segundos.
    const cita = normalizarTexto(sgCitaEn);
    if (cita && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(cita)) {
      return res.status(400).json({ message: "La fecha y hora de la cita no es válida." });
    }
    const citaSql = cita ? `${cita.slice(0, 10)} ${cita.slice(11, 16)}:00` : null;

    // Una cita agendada sin fecha no sirve para nada: no se puede recordar ni
    // mostrar en el calendario, y el cliente queda esperando sin que nadie sepa.
    if (estado === "AGENDADO" && !citaSql) {
      return res.status(400).json({
        message: "Para marcar una cita agendada hay que indicar la fecha y hora.",
      });
    }

    // Una asesora solo puede tocar filas de su propia cartera. La validacion va
    // en el UPDATE y no antes para que no haya ventana entre leer y escribir.
    const asesora = alcanceAsesora(req);
    const filtroAsesora = req.user?.rol === "ASESOR_INDIVIDUAL"
      ? "AND UPPER(TRIM(asesora_asignada)) = UPPER(:asesora)"
      : "";

    const nota = normalizarTexto(sgNota);
    const proximo = normalizarTexto(sgProximoContacto);
    const autor = req.user?.nombre || req.user?.email || "sistema";

    // La gestion y su registro en el historial van en una sola transaccion: si
    // una falla no puede quedar el estado cambiado sin su linea de historial,
    // ni al reves.
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Estado previo, para dejar en el historial de donde a donde se movio.
      const [[previo]] = await connection.execute(
        "SELECT sg_estado FROM seguimiento_mantenimiento WHERE sm_id = ? FOR UPDATE",
        [id],
      );

      const [resultado] = await connection.execute(
        `UPDATE seguimiento_mantenimiento
            SET sg_estado           = :estado,
                sg_nota             = :nota,
                sg_proximo_contacto = :proximo,
                sg_cita_en          = :cita,
                sg_actualizado_por  = :autor,
                sg_actualizado_en   = NOW()
          WHERE sm_id = :id ${filtroAsesora}`,
        { id, estado, nota, proximo, cita: citaSql, autor, ...(filtroAsesora ? { asesora } : {}) },
      );

      if (!resultado.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ message: "No se encontró el seguimiento en tu cartera." });
      }

      await connection.execute(
        `INSERT INTO seguimiento_historial
           (sm_id, sh_estado_anterior, sh_estado, sh_nota, sh_proximo_contacto, sh_cita_en, sh_autor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, previo?.sg_estado ?? null, estado, nota, proximo, citaSql, autor],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [fila] = await query(
      `SELECT ${CAMPOS} FROM seguimiento_mantenimiento WHERE sm_id = :id`,
      { id },
    );
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    res.json({ seguimiento: { ...fila, bandeja: clasificar(fila, hoy) } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    next(error);
  }
};

// ------------------------------------------------------------------ historial

// Linea de tiempo de un seguimiento: cada vez que se registro una gestion. Se
// pide aparte y no junto con el listado porque solo hace falta al abrir una
// ficha, y traerlo para los 105 vehiculos seria mucho dato que nadie mira.
export const getSeguimientoHistorial = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Seguimiento inválido." });
    }

    // Se comprueba que la ficha sea de quien pregunta antes de devolver nada:
    // el historial tiene notas internas sobre el cliente.
    const asesora = alcanceAsesora(req);
    const filtroAsesora = req.user?.rol === "ASESOR_INDIVIDUAL"
      ? "AND UPPER(TRIM(asesora_asignada)) = UPPER(:asesora)"
      : "";
    const dueno = await query(
      `SELECT sm_id FROM seguimiento_mantenimiento WHERE sm_id = :id ${filtroAsesora}`,
      { id, ...(filtroAsesora ? { asesora } : {}) },
    );
    if (!dueno.length) {
      return res.status(404).json({ message: "No se encontró el seguimiento en tu cartera." });
    }

    const historial = await query(
      `SELECT sh_id               AS id,
              sh_estado_anterior  AS estadoAnterior,
              sh_estado           AS estado,
              sh_nota             AS nota,
              sh_proximo_contacto AS proximoContacto,
              sh_cita_en          AS citaEn,
              sh_autor            AS autor,
              sh_creado_en        AS fecha
         FROM seguimiento_historial
        WHERE sm_id = :id
        ORDER BY sh_creado_en DESC, sh_id DESC`,
      { id },
    );

    res.json({ historial });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    next(error);
  }
};

// -------------------------------------------------------------------- agenda

// Compromisos de la asesora en un rango de fechas, para pintarlos en el
// calendario. Son dos cosas distintas y el calendario las separa por color:
//   cita       -> el cliente trae el vehiculo ese dia a esa hora
//   recontacto -> la asesora quedo en volver a llamar ese dia (sin hora)
//
// Se piden por rango y no se trae todo: el calendario solo muestra el mes que
// se esta viendo.
export const getSeguimientoAgenda = async (req, res, next) => {
  try {
    const asesora = alcanceAsesora(req);
    const desde = normalizarTexto(req.query.desde);
    const hasta = normalizarTexto(req.query.hasta);

    const filtro = [];
    const params = {};
    if (asesora) {
      filtro.push("UPPER(TRIM(asesora_asignada)) = UPPER(:asesora)");
      params.asesora = asesora;
    }
    const where = filtro.length ? `AND ${filtro.join(" AND ")}` : "";

    const rango = (columna) => {
      const partes = [];
      if (desde) partes.push(`${columna} >= :desde`);
      if (hasta) partes.push(`${columna} <= :hasta`);
      return partes.length ? `AND ${partes.join(" AND ")}` : "";
    };
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;

    const base = `sm_id AS id, placa, marca, modelo, cliente_nombre AS cliente,
                  contacto, telefono, servicio_prop_km AS servicioKm,
                  sg_estado AS sgEstado, estado AS estadoErp`;

    const [citas, recontactos] = await Promise.all([
      query(
        `SELECT ${base}, sg_cita_en AS cuando
           FROM seguimiento_mantenimiento
          WHERE sg_cita_en IS NOT NULL ${where} ${rango("sg_cita_en")}
          ORDER BY sg_cita_en`,
        params,
      ),
      query(
        `SELECT ${base}, sg_proximo_contacto AS cuando
           FROM seguimiento_mantenimiento
          WHERE sg_proximo_contacto IS NOT NULL ${where} ${rango("sg_proximo_contacto")}
          ORDER BY sg_proximo_contacto`,
        params,
      ),
    ]);

    res.json({
      asesora,
      eventos: [
        ...citas.map((fila) => ({ ...fila, tipo: "cita" })),
        ...recontactos.map((fila) => ({ ...fila, tipo: "recontacto" })),
      ],
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    next(error);
  }
};

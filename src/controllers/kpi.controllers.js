import { query } from "../db.js";
import {
  KPI_REPUESTOS,
  KPI_REPUESTOS_POR_ID,
  KPI_LIMITES,
  KPI_GRUPOS_FLOTA,
} from "../config/kpiRepuestos.js";

// ---------------------------------------------------------------------------
// Vida util de un repuesto = kilometros recorridos entre dos instalaciones
// consecutivas de esa misma pieza en la misma placa.
//
// El ERP no guarda "km de instalacion" ni "km de desgaste": guarda el odometro
// de cada OT. Los dos extremos se deducen encadenando las OT en las que se
// facturo la pieza. Se ordena por FECHA (la cronologia real) y luego se valida
// que el odometro suba; ordenar por kilometraje escondería las lecturas malas
// en vez de detectarlas, y produciria intervalos inventados.
// ---------------------------------------------------------------------------

const kmExpr = "CAST(NULLIF(TRIM(o.kilometraje_real), '') AS UNSIGNED)";

const MOTIVOS = Object.freeze({
  SIN_KM: "El odómetro no se registró en una de las dos OT",
  RETROCEDE: "El odómetro bajó respecto de la OT anterior",
  MUY_CORTO: "Intervalo demasiado corto: garantía, siniestro o error de tipeo",
  MUY_LARGO: "Intervalo demasiado largo: probablemente hubo un cambio fuera del taller",
});

// --------------------------------------------------------------- estadistica

function percentil(ordenados, fraccion) {
  if (!ordenados.length) return null;
  const indice = Math.min(
    ordenados.length - 1,
    Math.max(0, Math.ceil(ordenados.length * fraccion) - 1),
  );
  return ordenados[indice];
}

function estadisticos(valores) {
  if (!valores.length) {
    return { n: 0, mttf: null, mediana: null, b10: null, p90: null, min: null, max: null, desv: null };
  }
  const ordenados = [...valores].sort((a, b) => a - b);
  const suma = ordenados.reduce((acc, v) => acc + v, 0);
  const media = suma / ordenados.length;
  const varianza =
    ordenados.reduce((acc, v) => acc + (v - media) ** 2, 0) / ordenados.length;
  return {
    n: ordenados.length,
    suma: Math.round(suma),
    mttf: Math.round(media),
    mediana: Math.round(percentil(ordenados, 0.5)),
    // Vida B10: kilometraje al que el 10% de las piezas ya se reemplazo. Es el
    // numero con el que se programa mantenimiento preventivo; el promedio deja
    // a la mitad de la flota fuera de servicio antes de la cita.
    b10: Math.round(percentil(ordenados, 0.1)),
    p90: Math.round(percentil(ordenados, 0.9)),
    min: ordenados[0],
    max: ordenados[ordenados.length - 1],
    desv: Math.round(Math.sqrt(varianza)),
  };
}

// ------------------------------------------------------------ clasificacion

const enMayuscula = (valor) => String(valor || "").toUpperCase();

function cumplePatron(descripcion, patron) {
  // Traduce el LIKE del catalogo ("%BOMBA%AGUA%") a una comprobacion en JS,
  // para clasificar la misma linea que trajo el SQL sin volver a consultar.
  const partes = patron.split("%").filter(Boolean);
  let desde = 0;
  return partes.every((parte) => {
    const encontrado = descripcion.indexOf(parte, desde);
    if (encontrado === -1) return false;
    desde = encontrado + parte.length;
    return true;
  });
}

function clasificarLinea(descripcion) {
  const texto = enMayuscula(descripcion);
  return (
    KPI_REPUESTOS.find(
      (repuesto) =>
        repuesto.patrones.some((patron) => cumplePatron(texto, patron)) &&
        !repuesto.excluir.some((patron) => cumplePatron(texto, patron)),
    ) || null
  );
}

// Delantero / posterior no son comparables: un eje desgasta distinto que el otro.
function detectarVariante(descripcion) {
  const texto = enMayuscula(descripcion);
  if (/\bDEL(ANT\w*|T)?\b/.test(texto)) return "DELANTERO";
  if (/\bPOST\w*\b|\bTRAS\w*\b/.test(texto)) return "POSTERIOR";
  return "SIN ESPECIFICAR";
}

// ------------------------------------------------------------------ filtros

function parseKpiFilters(req) {
  const local =
    req.query.local && req.query.local !== "Todos" ? String(req.query.local) : null;
  const marca = req.query.marca ? String(req.query.marca).trim() : null;
  const modelo = req.query.modelo ? String(req.query.modelo).trim() : null;
  // soloFlota viene activo por defecto: es el universo donde el historial de
  // reemplazos esta completo (ver nota en config/kpiRepuestos.js).
  const soloFlota = req.query.soloFlota !== "false";
  const empresa =
    req.query.empresa && req.query.empresa !== "Todas" ? String(req.query.empresa).trim() : null;
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "") ? req.query.desde : null;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || "") ? req.query.hasta : null;
  return { local, marca, modelo, soloFlota, empresa, desde, hasta };
}

async function traerEventos(filtros) {
  const params = {};
  const condiciones = [`TRIM(o.placa) <> ''`];

  if (filtros.local) {
    condiciones.push("o.local_nombre = :local");
    params.local = filtros.local;
  }
  if (filtros.marca) {
    condiciones.push("UPPER(TRIM(o.marca)) = :marca");
    params.marca = filtros.marca.toUpperCase();
  }
  if (filtros.modelo) {
    condiciones.push("UPPER(TRIM(o.modelo)) = :modelo");
    params.modelo = filtros.modelo.toUpperCase();
  }
  if (filtros.empresa) {
    condiciones.push("TRIM(o.cliente_nombre) = :empresa");
    params.empresa = filtros.empresa;
  }
  if (filtros.soloFlota) {
    const lista = KPI_GRUPOS_FLOTA.map((grupo, indice) => {
      params[`grupo${indice}`] = grupo;
      return `:grupo${indice}`;
    });
    condiciones.push(`UPPER(TRIM(o.grupo_cliente)) IN (${lista.join(", ")})`);
  }
  if (filtros.desde) {
    condiciones.push("d.fec_apertura >= :desde");
    params.desde = filtros.desde;
  }
  if (filtros.hasta) {
    condiciones.push("d.fec_apertura <= :hasta");
    params.hasta = filtros.hasta;
  }

  // Un OR por cada patron del catalogo. Los "excluir" no se aplican aqui sino
  // al clasificar en JS, porque un mismo LIKE alimenta a varios repuestos.
  const patrones = [];
  KPI_REPUESTOS.forEach((repuesto, i) => {
    repuesto.patrones.forEach((patron, j) => {
      const clave = `p${i}_${j}`;
      params[clave] = patron;
      patrones.push(`UPPER(d.descripcion) LIKE :${clave}`);
    });
  });

  // Solo lineas de REPUESTO: las de SERVICIO son la mano de obra del cambio y
  // duplicarian el evento.
  const sql = `
    WITH ot AS (
      SELECT o.nro_orden,
             MAX(${kmExpr})            AS km,
             MAX(TRIM(o.marca))        AS marca,
             MAX(TRIM(o.modelo))       AS modelo,
             MAX(TRIM(o.placa))        AS placa,
             MAX(TRIM(o.local_nombre)) AS local_nombre,
             MAX(TRIM(o.cliente_nombre)) AS cliente
        FROM orden_trabajo o
       WHERE ${condiciones.join(" AND ")}
       GROUP BY o.nro_orden
    )
    SELECT d.nro_ot       AS ot,
           d.fec_apertura AS fecha,
           d.codigo       AS codigo,
           d.descripcion  AS descripcion,
           d.total_con_igv AS importe,
           ot.km, ot.marca, ot.modelo, ot.placa, ot.local_nombre, ot.cliente
      FROM detalle_factura_ot d
      JOIN ot ON ot.nro_orden = d.nro_ot
     WHERE d.origen = 'REPUESTO'
       AND (${patrones.join(" OR ")})
     ORDER BY ot.placa, d.fec_apertura
  `;

  return query(sql, params);
}

// -------------------------------------------------------------- calculo core

// Agrupa por placa + repuesto + variante y encadena eventos consecutivos.
// Devuelve intervalos validos y descartados (con su motivo) por separado.
function calcularIntervalos(eventos) {
  const series = new Map();

  eventos.forEach((evento) => {
    const repuesto = clasificarLinea(evento.descripcion);
    if (!repuesto) return;
    const variante = repuesto.variante ? detectarVariante(evento.descripcion) : "UNICA";
    const clave = `${evento.placa}||${repuesto.id}||${variante}`;
    if (!series.has(clave)) series.set(clave, { repuesto, variante, eventos: [] });
    series.get(clave).eventos.push(evento);
  });

  const validos = [];
  const descartados = [];

  series.forEach(({ repuesto, variante, eventos: lista }) => {
    // Una misma OT puede traer la pieza en dos lineas (izquierda/derecha): es
    // un solo evento de reemplazo, no dos.
    const porOt = new Map();
    lista.forEach((evento) => {
      if (!porOt.has(evento.ot)) porOt.set(evento.ot, evento);
    });
    // mysql2 devuelve DATE como objeto Date: hay que comparar el instante, no
    // su representacion de texto (que empieza por el dia de la semana).
    const ordenados = [...porOt.values()].sort(
      (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
    );

    for (let i = 0; i < ordenados.length - 1; i += 1) {
      const inicio = ordenados[i];
      const fin = ordenados[i + 1];
      const base = {
        repuestoId: repuesto.id,
        repuesto: repuesto.label,
        variante,
        placa: inicio.placa,
        marca: inicio.marca,
        modelo: inicio.modelo,
        cliente: inicio.cliente,
        local: inicio.local_nombre,
        otInicio: inicio.ot,
        otFin: fin.ot,
        fechaInicio: inicio.fecha,
        fechaFin: fin.fecha,
        kmInicio: inicio.km,
        kmFin: fin.km,
        codigo: inicio.codigo,
        descripcion: inicio.descripcion,
      };

      const kmInicio = Number(inicio.km);
      const kmFin = Number(fin.km);

      if (!kmInicio || !kmFin || kmInicio < KPI_LIMITES.kmMinimoValido || kmFin < KPI_LIMITES.kmMinimoValido) {
        descartados.push({ ...base, km: null, motivo: MOTIVOS.SIN_KM });
        continue;
      }
      const km = kmFin - kmInicio;
      if (km < 0) {
        descartados.push({ ...base, km, motivo: MOTIVOS.RETROCEDE });
      } else if (km < KPI_LIMITES.intervaloMinimo) {
        descartados.push({ ...base, km, motivo: MOTIVOS.MUY_CORTO });
      } else if (km > KPI_LIMITES.intervaloMaximo) {
        descartados.push({ ...base, km, motivo: MOTIVOS.MUY_LARGO });
      } else {
        validos.push({ ...base, km });
      }
    }
  });

  return { validos, descartados };
}

function resumirPor(intervalos, obtenerClave, etiquetar = (clave) => ({ clave })) {
  const grupos = new Map();
  intervalos.forEach((intervalo) => {
    const clave = obtenerClave(intervalo);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(intervalo.km);
  });
  return [...grupos.entries()]
    .map(([clave, kms]) => ({ ...etiquetar(clave), ...estadisticos(kms) }))
    .sort((a, b) => b.n - a.n);
}

// --------------------------------------------------------------- endpoints

export async function getKpiRepuestos(req, res, next) {
  try {
    const filtros = parseKpiFilters(req);
    const eventos = await traerEventos(filtros);
    const { validos, descartados } = calcularIntervalos(eventos);

    const porRepuesto = new Map();
    validos.forEach((intervalo) => {
      if (!porRepuesto.has(intervalo.repuestoId)) porRepuesto.set(intervalo.repuestoId, []);
      porRepuesto.get(intervalo.repuestoId).push(intervalo);
    });

    const resumen = KPI_REPUESTOS.map((repuesto) => {
      const intervalos = porRepuesto.get(repuesto.id) || [];
      const stats = estadisticos(intervalos.map((i) => i.km));
      const placas = new Set(intervalos.map((i) => i.placa)).size;
      return {
        id: repuesto.id,
        label: repuesto.label,
        zona: repuesto.zona,
        vidaRef: repuesto.vidaRef,
        placas,
        descartados: descartados.filter((d) => d.repuestoId === repuesto.id).length,
        // La vista muestra el numero igual, pero advierte cuando no hay muestra
        // suficiente para sostenerlo. Un MTTF sobre 1 caso no es un promedio.
        confiable: stats.n >= KPI_LIMITES.muestraMinima,
        ...stats,
      };
    });

    // Catalogo para el selector: solo las empresas que aportan mediciones, para
    // no ofrecer filtros que devuelven la vista vacia.
    const empresas = [...new Set(validos.map((i) => i.cliente).filter(Boolean))].sort();

    // Comparacion entre flotas: cada una usa sus vehiculos distinto, asi que el
    // promedio conjunto esconde diferencias que importan para comprar.
    const porEmpresa = resumirPor(validos, (i) => i.cliente || "SIN CLIENTE", (cliente) => ({ cliente }))
      .map((fila) => ({
        ...fila,
        placas: new Set(
          validos.filter((i) => (i.cliente || "SIN CLIENTE") === fila.cliente).map((i) => i.placa),
        ).size,
      }));

    res.json({
      filtros,
      limites: KPI_LIMITES,
      resumen,
      empresas,
      porEmpresa,
      totales: {
        intervalos: validos.length,
        descartados: descartados.length,
        placas: new Set(validos.map((i) => i.placa)).size,
        repuestosConMuestra: resumen.filter((r) => r.confiable).length,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getKpiRepuestoDetalle(req, res, next) {
  try {
    const repuesto = KPI_REPUESTOS_POR_ID[req.params.repuesto];
    if (!repuesto) {
      return res.status(404).json({ message: "Repuesto no reconocido." });
    }

    const filtros = parseKpiFilters(req);
    const eventos = await traerEventos(filtros);
    const { validos, descartados } = calcularIntervalos(eventos);

    const mios = validos.filter((i) => i.repuestoId === repuesto.id);
    const miosDescartados = descartados.filter((i) => i.repuestoId === repuesto.id);
    const stats = estadisticos(mios.map((i) => i.km));

    // Codigos realmente usados para esta pieza, con cuantas veces se instalo
    // cada uno. Es lo que permite comparar original contra alternativo.
    const codigos = new Map();
    eventos.forEach((evento) => {
      const clasificado = clasificarLinea(evento.descripcion);
      if (clasificado?.id !== repuesto.id) return;
      const clave = String(evento.codigo || "SIN CODIGO");
      if (!codigos.has(clave)) {
        codigos.set(clave, { codigo: clave, descripcion: evento.descripcion, veces: 0, importe: 0 });
      }
      const fila = codigos.get(clave);
      fila.veces += 1;
      fila.importe += Number(evento.importe || 0);
    });

    // Histograma en tramos de 5.000 km: hace visible la dispersion, que es lo
    // que el promedio esconde.
    const paso = 5000;
    const histograma = new Map();
    mios.forEach(({ km }) => {
      const tramo = Math.floor(km / paso) * paso;
      histograma.set(tramo, (histograma.get(tramo) || 0) + 1);
    });

    res.json({
      repuesto: { id: repuesto.id, label: repuesto.label, zona: repuesto.zona, vidaRef: repuesto.vidaRef },
      filtros,
      limites: KPI_LIMITES,
      resumen: { ...stats, confiable: stats.n >= KPI_LIMITES.muestraMinima },
      porModelo: resumirPor(mios, (i) => `${i.marca || "SIN MARCA"}||${i.modelo || "SIN MODELO"}`, (clave) => {
        const [marca, modelo] = clave.split("||");
        return { marca, modelo };
      }),
      porVariante: repuesto.variante
        ? resumirPor(mios, (i) => i.variante, (variante) => ({ variante }))
        : [],
      porCliente: resumirPor(mios, (i) => i.cliente || "SIN CLIENTE", (cliente) => ({ cliente })).slice(0, 10),
      histograma: [...histograma.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([desde, cantidad]) => ({ desde, hasta: desde + paso, cantidad })),
      codigos: [...codigos.values()].sort((a, b) => b.veces - a.veces),
      intervalos: mios.sort((a, b) => a.km - b.km),
      descartados: miosDescartados,
    });
  } catch (error) {
    next(error);
  }
}

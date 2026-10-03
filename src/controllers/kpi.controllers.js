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

// ------------------------------------------------- supervivencia (Kaplan-Meier)
//
// El promedio de intervalos solo puede mirar piezas que YA se reemplazaron dos
// veces en el mismo vehiculo, y eso sesga el resultado hacia los vehiculos que
// mas gastan: la camioneta que quema pastillas cada 8.000 km aporta cinco
// intervalos, y la que lleva 60.000 km con las mismas aporta cero.
//
// Kaplan-Meier incorpora las observaciones incompletas (censuradas), que son
// las dos que el promedio tira a la basura:
//   - la pieza cambiada por mantenimiento programado: no fallo, "duro al menos X"
//   - la pieza instalada que sigue rodando hoy: "lleva X km y sigue viva"
//
// Devuelve la curva de supervivencia S(km) = probabilidad de que la pieza siga
// viva a esos kilometros, de la que salen B10 y la mediana de supervivencia.

function kaplanMeier(observaciones) {
  const n = observaciones.length;
  if (!n) return { curva: [], nFallas: 0, nCensurados: 0 };

  const ordenadas = [...observaciones].sort((a, b) => a.km - b.km);
  const curva = [{ km: 0, supervivencia: 1, enRiesgo: n, fallas: 0 }];

  let enRiesgo = n;
  let supervivencia = 1;
  let i = 0;

  while (i < ordenadas.length) {
    const km = ordenadas[i].km;
    let fallas = 0;
    let censurados = 0;
    // Todas las observaciones con el mismo kilometraje se procesan juntas.
    while (i < ordenadas.length && ordenadas[i].km === km) {
      if (ordenadas[i].fallo) fallas += 1;
      else censurados += 1;
      i += 1;
    }
    if (fallas > 0 && enRiesgo > 0) {
      supervivencia *= 1 - fallas / enRiesgo;
      curva.push({ km, supervivencia, enRiesgo, fallas });
    }
    // Los censurados salen del grupo en riesgo sin contar como falla: esa es
    // justamente la informacion que el promedio no sabe aprovechar.
    enRiesgo -= fallas + censurados;
  }

  return {
    curva,
    nFallas: ordenadas.filter((o) => o.fallo).length,
    nCensurados: ordenadas.filter((o) => !o.fallo).length,
  };
}

// Kilometraje al que ha fallado una fraccion dada de las piezas.
// Devuelve null cuando la curva nunca baja hasta ahi: con el historial
// disponible ese punto todavia no se alcanzo, y afirmarlo seria inventarlo.
function vidaB(curva, fraccionFallada) {
  const objetivo = 1 - fraccionFallada;
  const punto = curva.find((p) => p.supervivencia <= objetivo);
  return punto ? Math.round(punto.km) : null;
}

// Para una pieza de mantenimiento programado, Kaplan-Meier no aplica: casi
// todos sus cambios son preventivos y entrarian como censurados, dejando una
// curva que nunca baja. Lo que se quiere saber ahi es otra cosa -- cada cuantos
// kilometros se cambia de verdad -- y eso es la mediana simple de intervalos.
function intervaloServicio(valores) {
  const stats = estadisticos(valores);
  return {
    nFallas: stats.n,
    nCensurados: 0,
    kmB10: stats.b10,
    kmMediana: stats.mediana,
    curva: [],
  };
}

// Calcula la vida util de un subconjunto con el metodo que corresponda a la
// pieza. Se usa para el total y para cada corte (modelo, empresa).
function vidaUtilDe(repuesto, observaciones, intervalos) {
  return repuesto.naturaleza === "programado"
    ? intervaloServicio(intervalos)
    : supervivencia(observaciones);
}

function supervivencia(observaciones) {
  const { curva, nFallas, nCensurados } = kaplanMeier(observaciones);
  if (!curva.length) {
    return { nFallas: 0, nCensurados: 0, kmB10: null, kmMediana: null, curva: [] };
  }
  return {
    nFallas,
    nCensurados,
    // B10: con este numero se programa el preventivo y se arma el stock.
    kmB10: vidaB(curva, 0.1),
    kmMediana: vidaB(curva, 0.5),
    // La curva se envia compactada: la vista solo dibuja los escalones.
    curva: curva.map((p) => ({
      km: Math.round(p.km),
      s: Number(p.supervivencia.toFixed(4)),
      enRiesgo: p.enRiesgo,
    })),
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
           d.tipo_ot      AS tipoOt,
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

// Ultimo odometro conocido de cada placa, con la fecha de esa visita.
//
// Es lo que permite medir la pieza que sigue en servicio: si el vehiculo volvio
// al taller despues del ultimo cambio, sabemos que la pieza llego al menos
// hasta ese kilometraje. Se exige visita POSTERIOR a proposito: del vehiculo
// que dejo de venir no sabemos nada, y suponer que su pieza sigue viva inflaria
// el resultado.
async function traerUltimoOdometro(filtros) {
  const params = {};
  const condiciones = [`TRIM(o.placa) <> ''`, `${kmExpr} IS NOT NULL`];
  if (filtros.local) {
    condiciones.push("o.local_nombre = :local");
    params.local = filtros.local;
  }
  const filas = await query(
    `SELECT TRIM(o.placa) AS placa,
            MAX(${kmExpr})      AS km,
            MAX(o.fec_apertura) AS fecha
       FROM orden_trabajo o
      WHERE ${condiciones.join(" AND ")}
      GROUP BY TRIM(o.placa)`,
    params,
  );
  return new Map(filas.map((fila) => [fila.placa, fila]));
}

// -------------------------------------------------------------- calculo core

// Agrupa por placa + repuesto + variante y encadena eventos consecutivos.
// Devuelve intervalos validos y descartados (con su motivo) por separado.
// Un cambio hecho dentro de un mantenimiento programado no es una falla: la
// pieza todavia servia. Para Kaplan-Meier ese intervalo es censurado.
const esPreventivo = (tipoOt) => /PERIODICO|PREVENTIV/.test(enMayuscula(tipoOt));

function calcularIntervalos(eventos, ultimoOdometro = new Map()) {
  const series = new Map();
  // Observaciones para la curva de supervivencia, por repuesto.
  const observaciones = new Map();
  const anotar = (repuestoId, km, fallo, contexto) => {
    if (!(km >= KPI_LIMITES.intervaloMinimo && km <= KPI_LIMITES.intervaloMaximo)) return;
    if (!observaciones.has(repuestoId)) observaciones.set(repuestoId, []);
    observaciones.get(repuestoId).push({ km, fallo, ...contexto });
  };

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
        // El intervalo cuenta como falla salvo que lo haya cerrado un
        // mantenimiento programado: ahi la pieza se cambio sin haberse acabado.
        anotar(repuesto.id, km, !esPreventivo(fin.tipoOt), {
          marca: inicio.marca,
          modelo: inicio.modelo,
          cliente: inicio.cliente,
          placa: inicio.placa,
        });
      }
    }

    // La pieza instalada en el ultimo cambio: si el vehiculo volvio despues,
    // sabemos que llego al menos hasta ese kilometraje sin que la cambiaran.
    const ultimo = ordenados[ordenados.length - 1];
    const visita = ultimoOdometro.get(String(ultimo?.placa || "").trim());
    const kmUltimo = Number(ultimo?.km);
    const kmVisita = Number(visita?.km);
    if (
      kmUltimo >= KPI_LIMITES.kmMinimoValido
      && kmVisita > kmUltimo
      && new Date(visita.fecha).getTime() > new Date(ultimo.fecha).getTime()
    ) {
      anotar(repuesto.id, kmVisita - kmUltimo, false, {
        marca: ultimo.marca,
        modelo: ultimo.modelo,
        cliente: ultimo.cliente,
        placa: ultimo.placa,
      });
    }
  });

  return { validos, descartados, observaciones };
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
    const [eventos, ultimoOdometro] = await Promise.all([
      traerEventos(filtros),
      traerUltimoOdometro(filtros),
    ]);
    const { validos, descartados, observaciones } = calcularIntervalos(eventos, ultimoOdometro);

    const porRepuesto = new Map();
    validos.forEach((intervalo) => {
      if (!porRepuesto.has(intervalo.repuestoId)) porRepuesto.set(intervalo.repuestoId, []);
      porRepuesto.get(intervalo.repuestoId).push(intervalo);
    });

    const resumen = KPI_REPUESTOS.map((repuesto) => {
      const intervalos = porRepuesto.get(repuesto.id) || [];
      const stats = estadisticos(intervalos.map((i) => i.km));
      const vidaUtil = repuesto.naturaleza === "programado"
        ? intervaloServicio(intervalos.map((i) => i.km))
        : supervivencia(observaciones.get(repuesto.id) || []);
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
        ...stats,
        // Kaplan-Meier sobre fallas + observaciones censuradas. Es la cifra que
        // de verdad estima la vida util; `mttf` queda como referencia.
        km: vidaUtil,
        // La curva se sostiene en las FALLAS observadas: las piezas que siguen
        // en servicio aportan informacion, pero no confirman ninguna vida util.
        confiable: vidaUtil.nFallas >= KPI_LIMITES.muestraMinima,
        // El frontend necesita saber que pregunta responde la cifra: vida util
        // de la pieza, o cada cuanto la cambia el taller.
        naturaleza: repuesto.naturaleza,
      };
    });

    // Vista por modelo: es la que miran los duenos de flota, porque la pregunta
    // que se hacen no es "cuanto dura una pastilla" sino "cuanto me dura a MI,
    // en las unidades que tengo". Dos modelos del mismo taller pueden diferir
    // al doble, y eso cambia que unidad conviene comprar.
    const porModelo = (() => {
      const modelos = new Map();

      const registrar = (clave, marca, modelo) => {
        if (!modelos.has(clave)) {
          modelos.set(clave, { marca, modelo, placas: new Set(), piezas: {} });
        }
        return modelos.get(clave);
      };

      KPI_REPUESTOS.forEach((repuesto) => {
        const obs = observaciones.get(repuesto.id) || [];
        const intervalos = porRepuesto.get(repuesto.id) || [];

        // Se agrupa por modelo y se recalcula con el mismo metodo del total:
        // promediar los promedios de cada modelo daria otro numero distinto.
        const porClave = new Map();
        obs.forEach((o) => {
          const clave = `${o.marca || "SIN MARCA"}||${o.modelo || "SIN MODELO"}`;
          if (!porClave.has(clave)) porClave.set(clave, { obs: [], intervalos: [], o });
          porClave.get(clave).obs.push(o);
        });
        intervalos.forEach((i) => {
          const clave = `${i.marca || "SIN MARCA"}||${i.modelo || "SIN MODELO"}`;
          if (!porClave.has(clave)) porClave.set(clave, { obs: [], intervalos: [], o: i });
          porClave.get(clave).intervalos.push(i.km);
        });

        porClave.forEach((grupo, clave) => {
          const [marca, modelo] = clave.split("||");
          const fila = registrar(clave, marca, modelo);
          grupo.obs.forEach((o) => fila.placas.add(o.placa));
          const vida = vidaUtilDe(repuesto, grupo.obs, grupo.intervalos);
          if (vida.nFallas > 0) {
            fila.piezas[repuesto.id] = {
              kmMediana: vida.kmMediana,
              kmB10: vida.kmB10,
              n: vida.nFallas,
              confiable: vida.nFallas >= KPI_LIMITES.muestraMinima,
            };
          }
        });
      });

      return [...modelos.values()]
        .map((fila) => ({
          marca: fila.marca,
          modelo: fila.modelo,
          placas: fila.placas.size,
          medidas: Object.keys(fila.piezas).length,
          piezas: fila.piezas,
        }))
        .filter((fila) => fila.medidas > 0)
        .sort((a, b) => b.placas - a.placas);
    })();

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
      porModelo,
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
    const [eventos, ultimoOdometro] = await Promise.all([
      traerEventos(filtros),
      traerUltimoOdometro(filtros),
    ]);
    const { validos, descartados, observaciones } = calcularIntervalos(eventos, ultimoOdometro);

    const mios = validos.filter((i) => i.repuestoId === repuesto.id);
    const miosDescartados = descartados.filter((i) => i.repuestoId === repuesto.id);
    const stats = estadisticos(mios.map((i) => i.km));
    const vidaUtil = repuesto.naturaleza === "programado"
      ? intervaloServicio(mios.map((i) => i.km))
      : supervivencia(observaciones.get(repuesto.id) || []);

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
      repuesto: {
        id: repuesto.id,
        label: repuesto.label,
        zona: repuesto.zona,
        vidaRef: repuesto.vidaRef,
        naturaleza: repuesto.naturaleza,
      },
      filtros,
      limites: KPI_LIMITES,
      resumen: {
        ...stats,
        km: vidaUtil,
        confiable: vidaUtil.nFallas >= KPI_LIMITES.muestraMinima,
        naturaleza: repuesto.naturaleza,
      },
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

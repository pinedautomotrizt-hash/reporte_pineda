import XLSX from "xlsx-js-style";
import ExcelJS from "exceljs";
import { existsSync } from "fs";
import { resolve } from "path";
import { query } from "../db.js";

const fechaDocumento =
  "STR_TO_DATE(NULLIF(TRIM(fec_documento), ''), '%Y-%m-%d')";
const numero = (columna) =>
  `COALESCE(CAST(NULLIF(REPLACE(TRIM(${columna}), ',', ''), '') AS DECIMAL(15,2)), 0)`;
const esNotaCredito =
  "UPPER(TRIM(tipo_documento)) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')";
const importeSinIgv = `${numero("valor_gravado")} + ${numero("valor_exonerado")} + ${numero("valor_inafecto")}`;
const importeContable = (expresion) =>
  `CASE WHEN ${esNotaCredito} THEN -ABS(${expresion}) ELSE ${expresion} END`;

// Construye el filtro mensual y opcional por sede usado en todas las hojas.
function crearPeriodo({ start, local }, alias = "") {
  const prefijo = alias ? `${alias}.` : "";
  const sede = local ? `AND ${prefijo}local_nombre = :local` : "";
  return `
    ${fechaDocumento.replaceAll(/\b(fec_documento)\b/g, `${prefijo}$1`)} >= :start
    AND ${fechaDocumento.replaceAll(/\b(fec_documento)\b/g, `${prefijo}$1`)} < DATE_ADD(:start, INTERVAL 1 MONTH)
    ${sede}
  `;
}


// Aplica una vez las reglas contables y consolida cada comprobante importado.
function documentosBase(periodo) {
  return `
    SELECT
      nro_documento,
      MAX(${fechaDocumento}) fecha,
      local_nombre,
      MAX(tipo_documento) tipo_documento,
      MAX(cliente_documento) cliente_documento,
      MAX(cliente_nombre) cliente,
      MAX(moneda) moneda,
      MAX(${numero("moneda_usd")}) moneda_usd,
      MAX(${importeContable(importeSinIgv)}) sin_igv,
      MAX(${importeContable(numero("impuesto"))}) igv,
      MAX(${importeContable(numero("precio_venta"))}) con_igv,
      MAX(clase_venta) clase_venta,
      MAX(asesor_operacion) asesor,
      MAX(estado) estado,
      MAX(estado_sunat) estado_sunat,
      MAX(operacion_relacionada) operacion_relacionada,
      MAX(forma_pago) forma_pago
    FROM registro_venta
    WHERE ${periodo}
    GROUP BY nro_documento, local_nombre
  `;
}

// Convierte filas JSON en una hoja legible y fija anchos de columnas.
function agregarHoja(libro, nombre, filas) {
  const datos = filas.length
    ? filas
    : [{ Mensaje: "Sin información para los filtros seleccionados" }];
  const hoja = XLSX.utils.json_to_sheet(datos);
  const encabezados = Object.keys(datos[0]);
  hoja["!cols"] = encabezados.map((encabezado) => ({
    wch: Math.min(
      45,
      Math.max(
        encabezado.length + 2,
        ...datos.map((fila) => String(fila[encabezado] ?? "").length + 2),
      ),
    ),
  }));
  hoja["!autofilter"] = { ref: hoja["!ref"] };
  XLSX.utils.book_append_sheet(libro, hoja, nombre);
}

// Presenta el inventario de OT aperturadas: resumen general y detalle separado por sede.
function agregarPendientesAperturados(libro, filas) {
  const sedes = [
    ...new Set(filas.map((fila) => fila.Local || "Sin sede")),
  ].sort((a, b) => a.localeCompare(b, "es"));
  const totalPotencial = filas.reduce(
    (total, fila) => total + Number(fila["Valor pendiente sin IGV"] || 0),
    0,
  );
  const fueraDePlazo = filas.filter(
    (fila) => Number(fila["Días aperturada"] || 0) > 30,
  );
  const salida = [
    ["PANEL DE ÓRDENES APERTURADAS"],
    ["Indicador", "Cantidad", "Valor pendiente sin IGV"],
    ["Total general", filas.length, totalPotencial],
    [
      "Fuera de plazo (> 30 días)",
      fueraDePlazo.length,
      fueraDePlazo.reduce(
        (total, fila) => total + Number(fila["Valor pendiente sin IGV"] || 0),
        0,
      ),
    ],
    ...sedes.map((sede) => {
      const registros = filas.filter(
        (fila) => (fila.Local || "Sin sede") === sede,
      );
      return [
        sede,
        registros.length,
        registros.reduce(
          (total, fila) => total + Number(fila["Valor pendiente sin IGV"] || 0),
          0,
        ),
      ];
    }),
    [],
  ];
  const columnas = [
    "Fecha apertura",
    "Días aperturada",
    "OT",
    "Cliente",
    "Placa",
    "Asesor",
    "Grupo servicio",
    "Clase OT",
    "Tipo OT",
    "Moneda",
    "Valor pendiente sin IGV",
    "Fecha factura",
    "Nro. factura",
    "Estado",
  ];

  sedes.forEach((sede) => {
    const registros = filas.filter(
      (fila) => (fila.Local || "Sin sede") === sede,
    );
    salida.push([`DETALLE ${sede.toUpperCase()}`], columnas);
    registros.forEach((fila) =>
      salida.push(columnas.map((columna) => fila[columna] ?? "")),
    );
    salida.push(
      [
        `TOTAL ${sede.toUpperCase()}`,
        registros.length,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        registros.reduce(
          (total, fila) => total + Number(fila["Valor pendiente sin IGV"] || 0),
          0,
        ),
      ],
      [],
    );
  });

  if (!filas.length)
    salida.push(["Sin órdenes aperturadas al cierre del periodo seleccionado"]);
  const hoja = XLSX.utils.aoa_to_sheet(salida);
  hoja["!cols"] = [14, 15, 18, 34, 12, 30, 22, 20, 18, 12, 23, 14, 18, 15].map(
    (wch) => ({ wch }),
  );
  hoja["!merges"] = [];
  const borde = {
    top: { style: "thin", color: { rgb: "CBD5E1" } },
    bottom: { style: "thin", color: { rgb: "CBD5E1" } },
    left: { style: "thin", color: { rgb: "CBD5E1" } },
    right: { style: "thin", color: { rgb: "CBD5E1" } },
  };
  salida.forEach((fila, indiceFila) => {
    const titulo =
      String(fila[0] || "").startsWith("PANEL") ||
      String(fila[0] || "").startsWith("DETALLE ");
    const cabecera = fila[0] === "Indicador" || fila[0] === "Fecha apertura";
    const fueraDePlazo =
      /^\d{2}\/\d{2}\/\d{4}$/.test(String(fila[0] || "")) &&
      Number(fila[1] || 0) > 30;
    if (titulo)
      hoja["!merges"].push({
        s: { r: indiceFila, c: 0 },
        e: { r: indiceFila, c: 13 },
      });
    fila.forEach((_, indiceColumna) => {
      const celda =
        hoja[XLSX.utils.encode_cell({ r: indiceFila, c: indiceColumna })];
      if (!celda) return;
      celda.s = titulo
        ? {
            font: { bold: true, color: { rgb: "FFFFFF" }, sz: 13 },
            fill: { fgColor: { rgb: "991B1B" } },
            alignment: { horizontal: "center" },
          }
        : cabecera
          ? {
              font: { bold: true, color: { rgb: "FFFFFF" } },
              fill: { fgColor: { rgb: "B91C1C" } },
              alignment: { horizontal: "center", wrapText: true },
              border: borde,
            }
          : fueraDePlazo
            ? {
                font: { bold: indiceColumna === 1, color: { rgb: "991B1B" } },
                fill: { fgColor: { rgb: "FECACA" } },
                border: borde,
              }
            : {
                fill: {
                  fgColor: { rgb: indiceFila % 2 ? "FFFFFF" : "F8FAFC" },
                },
                border: borde,
              };
      if (indiceColumna === 10 || (indiceColumna === 2 && indiceFila < 8))
        celda.z = "#,##0.00";
    });
  });
  XLSX.utils.book_append_sheet(libro, hoja, "Pendientes");
}

// OT del mes: a diferencia de "Pendientes" (que arrastra TODO lo que sigue
// aperturado sin importar cuándo abrió), esta hoja solo mira las OT cuya
// fecha de apertura cae dentro del mes elegido, y muestra si a hoy siguen
// aperturadas o ya se cerraron. Así el ticket promedio de un mes nunca se
// mezcla con OT que abrieron en otro mes.
function agregarOtDelMes(libro, filas, { month, local }) {
  const esAperturada = (fila) => String(fila.Estado || "").toUpperCase() === "APERTURADO";
  // Explícito y no "todo lo que no es aperturada": FACTURADO/LIQUIDADO/etc. ya
  // se filtraron desde la query y no deben contarse como "cerrada" aquí.
  const esCerrada = (fila) => String(fila.Estado || "").toUpperCase() === "CERRADO";
  const ticketPromedio = (registros) =>
    registros.length
      ? registros.reduce((total, fila) => total + Number(fila.Ticket || 0), 0) / registros.length
      : 0;
  // Suma el valor de las OT ya CERRADAS (no las aperturadas): es lo que se
  // ganaría en cuanto se facturen, no lo ya facturado oficialmente.
  const totalDineroCerradas = (registros) =>
    registros
      .filter((fila) => esCerrada(fila))
      .reduce((total, fila) => total + Number(fila.Ticket || 0), 0);
  // Suma el valor de las OT que SIGUEN aperturadas: a diferencia de las
  // cerradas, este monto es relativo/estimado porque la OT puede seguir
  // sumando repuestos o servicios antes de cerrarse.
  const totalDineroAperturadas = (registros) =>
    registros
      .filter((fila) => esAperturada(fila))
      .reduce((total, fila) => total + Number(fila.Ticket || 0), 0);

  const aperturadas = filas.filter(esAperturada);
  const cerradas = filas.filter((fila) => esCerrada(fila));

  const sedes = [...new Set(filas.map((fila) => fila.Local || "Sin sede"))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  const asesores = [...new Set(filas.map((fila) => fila.Asesor || "Sin asesor"))];

  const filasPorSede = sedes.map((sede) => {
    const registros = filas.filter((fila) => (fila.Local || "Sin sede") === sede);
    return [
      sede,
      registros.filter(esAperturada).length,
      registros.filter((fila) => esCerrada(fila)).length,
      registros.length,
      ticketPromedio(registros),
      totalDineroCerradas(registros),
      totalDineroAperturadas(registros),
    ];
  });

  const filasPorAsesor = asesores
    .map((asesor) => {
      const registros = filas.filter((fila) => (fila.Asesor || "Sin asesor") === asesor);
      return {
        asesor,
        sede: registros[0]?.Local || "-",
        aperturadas: registros.filter(esAperturada).length,
        cerradas: registros.filter((fila) => esCerrada(fila)).length,
        total: registros.length,
        ticket: ticketPromedio(registros),
        dineroCerradas: totalDineroCerradas(registros),
        dineroAperturadas: totalDineroAperturadas(registros),
      };
    })
    .sort((a, b) => b.total - a.total)
    .map((fila) => [
      fila.asesor,
      fila.sede,
      fila.aperturadas,
      fila.cerradas,
      fila.total,
      fila.ticket,
      fila.dineroCerradas,
      fila.dineroAperturadas,
    ]);

  // Por cliente se arma aparte por cada sede (una empresa puede tener OT en
  // ambas sedes, y se quiere ver el desglose de cada una por separado).
  const construirFilasPorCliente = (registrosSede) => {
    const clientesSede = [...new Set(registrosSede.map((fila) => fila.Cliente || "Sin cliente"))];
    return clientesSede
      .map((cliente) => {
        const registros = registrosSede.filter((fila) => (fila.Cliente || "Sin cliente") === cliente);
        const dineroCerradas = totalDineroCerradas(registros);
        return {
          cliente,
          aperturadas: registros.filter(esAperturada).length,
          cerradas: registros.filter((fila) => esCerrada(fila)).length,
          total: registros.length,
          ticket: ticketPromedio(registros),
          dineroCerradas,
          // Solo interesa ver el monto aperturado cuando el cliente todavia no
          // tiene NADA cerrado este mes (100% pendiente); si ya tiene algo
          // cerrado, no se resalta lo aperturado en esta columna.
          dineroAperturadas: dineroCerradas === 0 ? totalDineroAperturadas(registros) : 0,
        };
      })
      .sort((a, b) => b.total - a.total)
      .map((fila) => [
        fila.cliente,
        fila.aperturadas,
        fila.cerradas,
        fila.total,
        fila.ticket,
        fila.dineroCerradas,
        fila.dineroAperturadas,
      ]);
  };
  // Mismo criterio que arriba (solo clientes 100% pendientes), pero sumado
  // para la fila TOTAL de la sede: no es el total aperturado de TODOS los
  // clientes, solo el de los que no tienen nada cerrado todavia.
  const totalDineroAperturadasClientesPendientes = (registrosSede) => {
    const clientesSede = [...new Set(registrosSede.map((fila) => fila.Cliente || "Sin cliente"))];
    return clientesSede.reduce((total, cliente) => {
      const registros = registrosSede.filter((fila) => (fila.Cliente || "Sin cliente") === cliente);
      return totalDineroCerradas(registros) === 0 ? total + totalDineroAperturadas(registros) : total;
    }, 0);
  };

  // Semáforo del ticket promedio: se compara contra el promedio de la MISMA
  // sede ese mes (no un monto fijo), así se autoajusta si cambian los precios.
  // Verde = igual o por encima del promedio; amarillo = hasta 15% por debajo;
  // rojo = más de 15% por debajo; gris = sin dato (OT sin precio_venta cargado).
  const promedioGeneral = ticketPromedio(filas);
  const promedioPorSede = new Map(
    sedes.map((sede) => [sede, ticketPromedio(filas.filter((fila) => (fila.Local || "Sin sede") === sede))]),
  );
  const colorSemaforo = (valor, referencia) => {
    if (!valor) return { fill: "E2E8F0", texto: "475569", italic: true }; // sin dato
    if (!referencia) return null;
    if (valor >= referencia) return { fill: "BBF7D0", texto: "166534" }; // bueno
    if (valor >= referencia * 0.85) return { fill: "FEF3C7", texto: "92400E" }; // regular
    return { fill: "FECACA", texto: "991B1B" }; // bajo
  };

  // Guarda en qué fila empieza cada bloque para saber, al pintar, cuál es la
  // columna de "Ticket promedio" de esa tabla (cada bloque tiene distinto
  // numero de columnas) y contra qué promedio comparar cada ticket.
  const bloques = [];
  const salida = [];
  const agregarFila = (fila) => salida.push(fila) - 1;
  const marcarBloque = (nombre, columnaTicket, referencia) => {
    bloques.push({ nombre, desdeFila: salida.length, columnaTicket, referencia });
  };

  agregarFila(["OT DEL MES · APERTURADAS Y CERRADAS"]);
  agregarFila([
    `Periodo: ${month} · Sede: ${local || "Todos los locales"} · Se cuenta por fecha de apertura de la OT (no arrastra otros meses) · Solo estado Aperturado/Cerrado, no incluye Facturado/Liquidado`,
  ]);
  agregarFila([]);
  const filaLeyenda = agregarFila([
    "Bueno (≥ promedio de su sede)",
    "Regular (hasta 15% debajo)",
    "Bajo (más de 15% debajo)",
    "Sin dato (sin precio_venta)",
  ]);
  agregarFila([]);

  agregarFila(["RESUMEN GENERAL"]);
  agregarFila(["Indicador", "Valor"]);
  agregarFila(["OT aperturadas este mes (total)", filas.length]);
  agregarFila(["Siguen aperturadas", aperturadas.length]);
  agregarFila(["Ya cerradas (listas para facturar)", cerradas.length]);
  const filaTicketGeneral = agregarFila(["Ticket promedio general", promedioGeneral]);
  const filaDineroGeneral = agregarFila([
    "Total en dinero de las cerradas (por facturar)",
    totalDineroCerradas(filas),
  ]);
  const filaDineroGeneralAperturadas = agregarFila([
    "Total en dinero de las aperturadas (estimado, aún puede subir)",
    totalDineroAperturadas(filas),
  ]);
  agregarFila([]);

  agregarFila(["POR SEDE"]);
  agregarFila([
    "Sede",
    "Aperturadas",
    "Cerradas",
    "Total",
    "Ticket promedio",
    "Total en dinero (cerradas)",
    "Total en dinero (Aperturadas · estimado)",
  ]);
  marcarBloque("sede", 4, { tipo: "fijo", valor: promedioGeneral });
  filasPorSede.forEach((fila) => agregarFila(fila));
  agregarFila([]);

  agregarFila(["POR ASESOR"]);
  agregarFila([
    "Asesor",
    "Sede",
    "Aperturadas",
    "Cerradas",
    "Total",
    "Ticket promedio",
    "Total en dinero (cerradas)",
    "Total en dinero (Aperturadas · estimado)",
  ]);
  marcarBloque("asesor", 5, { tipo: "porSedeEnFila", columnaSede: 1 });
  filasPorAsesor.forEach((fila) => agregarFila(fila));
  agregarFila([]);

  sedes.forEach((sede) => {
    const registrosSede = filas.filter((fila) => (fila.Local || "Sin sede") === sede);
    agregarFila([`POR CLIENTE / EMPRESA — ${sede.toUpperCase()}`]);
    agregarFila([
      "Cliente",
      "Aperturadas",
      "Cerradas",
      "Total",
      "Ticket promedio",
      "Total en dinero (cerradas)",
      "Total en dinero (Aperturadas · estimado)",
    ]);
    marcarBloque(`cliente-${sede}`, 4, { tipo: "fijo", valor: promedioPorSede.get(sede) });
    construirFilasPorCliente(registrosSede).forEach((fila) => agregarFila(fila));
    agregarFila([
      `TOTAL ${sede.toUpperCase()}`,
      registrosSede.filter(esAperturada).length,
      registrosSede.filter((fila) => esCerrada(fila)).length,
      registrosSede.length,
      ticketPromedio(registrosSede),
      totalDineroCerradas(registrosSede),
      totalDineroAperturadasClientesPendientes(registrosSede),
    ]);
    agregarFila([]);
  });

  if (!filas.length) agregarFila(["Sin órdenes aperturadas en el periodo seleccionado"]);

  const hoja = XLSX.utils.aoa_to_sheet(salida);
  const anchoColumnas = 8;
  hoja["!cols"] = [30, 20, 14, 14, 14, 18, 22, 24].map((wch) => ({ wch }));
  hoja["!merges"] = [];
  const borde = {
    top: { style: "thin", color: { rgb: "CBD5E1" } },
    bottom: { style: "thin", color: { rgb: "CBD5E1" } },
    left: { style: "thin", color: { rgb: "CBD5E1" } },
    right: { style: "thin", color: { rgb: "CBD5E1" } },
  };
  const titulos = ["OT DEL MES", "RESUMEN GENERAL", "POR SEDE", "POR ASESOR", "POR CLIENTE"];
  const cabeceras = ["Indicador", "Sede", "Asesor", "Cliente"];

  salida.forEach((fila, indiceFila) => {
    const titulo = titulos.some((prefijo) => String(fila[0] || "").startsWith(prefijo));
    const subtitulo = String(fila[0] || "").startsWith("Periodo:");
    const cabecera = cabeceras.includes(fila[0]);
    const totalDeSede = String(fila[0] || "").startsWith("TOTAL ");
    const esLeyenda = indiceFila === filaLeyenda;
    if (titulo || subtitulo)
      hoja["!merges"].push({
        s: { r: indiceFila, c: 0 },
        e: { r: indiceFila, c: anchoColumnas - 1 },
      });
    // Bloque activo en esta fila (si ya se pasó su fila de inicio de datos).
    const bloqueActivo = [...bloques].reverse().find((bloque) => indiceFila >= bloque.desdeFila);
    const coloresLeyenda = ["BBF7D0", "FEF3C7", "FECACA", "E2E8F0"];
    const textosLeyenda = ["166534", "92400E", "991B1B", "475569"];
    fila.forEach((_, indiceColumna) => {
      const celda = hoja[XLSX.utils.encode_cell({ r: indiceFila, c: indiceColumna })];
      if (!celda) return;
      celda.s = titulo
        ? {
            font: { bold: true, color: { rgb: "FFFFFF" }, sz: 13 },
            fill: { fgColor: { rgb: "991B1B" } },
            alignment: { horizontal: "center" },
          }
        : subtitulo
          ? { font: { italic: true, color: { rgb: "475569" } }, alignment: { horizontal: "center" } }
          : esLeyenda
            ? {
                font: { bold: true, color: { rgb: textosLeyenda[indiceColumna] }, sz: 10 },
                fill: { fgColor: { rgb: coloresLeyenda[indiceColumna] } },
                alignment: { horizontal: "center", wrapText: true },
                border: borde,
              }
            : cabecera
              ? {
                  font: { bold: true, color: { rgb: "FFFFFF" } },
                  fill: { fgColor: { rgb: "B91C1C" } },
                  alignment: { horizontal: "center", wrapText: true },
                  border: borde,
                }
              : totalDeSede
                ? {
                    font: { bold: true, color: { rgb: "1E293B" } },
                    fill: { fgColor: { rgb: "FDE68A" } },
                    border: borde,
                    alignment: { horizontal: indiceColumna === 0 ? "left" : "right" },
                  }
                : {
                    fill: { fgColor: { rgb: indiceFila % 2 ? "FFFFFF" : "F8FAFC" } },
                    border: borde,
                    alignment: { horizontal: indiceColumna === 0 ? "left" : "right" },
                  };
      const esTicketGeneral = indiceFila === filaTicketGeneral && indiceColumna === 1;
      const esDineroGeneral =
        (indiceFila === filaDineroGeneral || indiceFila === filaDineroGeneralAperturadas) && indiceColumna === 1;
      const esTicketDeBloque =
        !titulo && !subtitulo && !cabecera && !totalDeSede && bloqueActivo && indiceColumna === bloqueActivo.columnaTicket;
      // "Total en dinero (cerradas)" y "Total en dinero (Aperturadas)" van
      // siempre justo despues de "Ticket promedio" en cada bloque, en ese orden.
      const esDineroDeBloque =
        bloqueActivo &&
        (indiceColumna === bloqueActivo.columnaTicket + 1 || indiceColumna === bloqueActivo.columnaTicket + 2);
      if (esTicketGeneral || esDineroGeneral || esTicketDeBloque || esDineroDeBloque) celda.z = "#,##0.00";
      if (esTicketDeBloque) {
        const referenciaBloque = bloqueActivo.referencia;
        const referencia =
          referenciaBloque.tipo === "fijo"
            ? referenciaBloque.valor
            : promedioPorSede.get(fila[referenciaBloque.columnaSede]) ?? promedioGeneral;
        const semaforo = colorSemaforo(Number(celda.v || 0), referencia);
        if (semaforo)
          celda.s = {
            ...celda.s,
            font: { ...celda.s.font, bold: true, color: { rgb: semaforo.texto }, italic: Boolean(semaforo.italic) },
            fill: { fgColor: { rgb: semaforo.fill } },
          };
      }
    });
  });
  XLSX.utils.book_append_sheet(libro, hoja, "OT del Mes");
}

// Unidades Atendidas: a diferencia de "OT del mes" (que cuenta ORDENES de
// trabajo), esta hoja cuenta VEHICULOS distintos (por placa) atendidos en el
// mes, con su ticket promedio y cuantos de esos vehiculos todavia siguen con
// una OT sin cerrar ("pendientes por atender").
function agregarUnidadesAtendidas(libro, filas, { month, local }) {
  const esPendiente = (fila) => Number(fila.Pendiente) === 1;
  const ticketPromedio = (registros) =>
    registros.length
      ? registros.reduce((total, fila) => total + Number(fila.Ticket || 0), 0) / registros.length
      : 0;

  const sedes = [...new Set(filas.map((fila) => fila.Local || "Sin sede"))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );

  const filasPorSede = sedes.map((sede) => {
    const registros = filas.filter((fila) => (fila.Local || "Sin sede") === sede);
    return [sede, registros.length, ticketPromedio(registros), registros.filter(esPendiente).length];
  });

  // Por empresa se arma aparte por cada sede (una empresa puede tener
  // vehiculos atendidos en ambas sedes, y se quiere ver cada una por separado).
  const construirFilasPorEmpresa = (registrosSede) => {
    const clientesSede = [...new Set(registrosSede.map((fila) => fila.Cliente || "Sin cliente"))];
    return clientesSede
      .map((cliente) => {
        const registros = registrosSede.filter((fila) => (fila.Cliente || "Sin cliente") === cliente);
        return {
          cliente,
          unidades: registros.length,
          ticket: ticketPromedio(registros),
          pendientes: registros.filter(esPendiente).length,
        };
      })
      .sort((a, b) => b.unidades - a.unidades)
      .map((fila) => [fila.cliente, fila.unidades, fila.ticket, fila.pendientes]);
  };

  const salida = [];
  const agregarFila = (fila) => salida.push(fila) - 1;

  agregarFila(["UNIDADES ATENDIDAS POR SEDE"]);
  agregarFila([
    `Periodo: ${month} · Sede: ${local || "Todos los locales"} · Una unidad = un vehículo (placa) distinto con al menos una OT abierta este mes · "Pendientes" son las que todavía tienen alguna OT sin cerrar`,
  ]);
  agregarFila([]);

  agregarFila(["RESUMEN GENERAL"]);
  agregarFila(["Indicador", "Valor"]);
  agregarFila(["Unidades atendidas este mes (total)", filas.length]);
  const filaTicketGeneral = agregarFila(["Ticket promedio general", ticketPromedio(filas)]);
  agregarFila(["Unidades que faltan por atender (con OT aperturada)", filas.filter(esPendiente).length]);
  agregarFila([]);

  agregarFila(["POR SEDE"]);
  agregarFila(["Sede", "Unidades atendidas", "Ticket promedio", "Unidades pendientes"]);
  filasPorSede.forEach((fila) => agregarFila(fila));
  agregarFila([]);

  sedes.forEach((sede) => {
    const registrosSede = filas.filter((fila) => (fila.Local || "Sin sede") === sede);
    agregarFila([`POR EMPRESA — ${sede.toUpperCase()}`]);
    agregarFila(["Cliente", "Unidades atendidas", "Ticket promedio", "Unidades pendientes"]);
    construirFilasPorEmpresa(registrosSede).forEach((fila) => agregarFila(fila));
    agregarFila([
      `TOTAL ${sede.toUpperCase()}`,
      registrosSede.length,
      ticketPromedio(registrosSede),
      registrosSede.filter(esPendiente).length,
    ]);
    agregarFila([]);
  });

  if (!filas.length) agregarFila(["Sin unidades atendidas en el periodo seleccionado"]);

  const hoja = XLSX.utils.aoa_to_sheet(salida);
  const anchoColumnas = 4;
  hoja["!cols"] = [34, 20, 18, 20].map((wch) => ({ wch }));
  hoja["!merges"] = [];
  const borde = {
    top: { style: "thin", color: { rgb: "CBD5E1" } },
    bottom: { style: "thin", color: { rgb: "CBD5E1" } },
    left: { style: "thin", color: { rgb: "CBD5E1" } },
    right: { style: "thin", color: { rgb: "CBD5E1" } },
  };
  const titulos = ["UNIDADES ATENDIDAS", "RESUMEN GENERAL", "POR SEDE", "POR EMPRESA"];
  const cabeceras = ["Indicador", "Sede", "Cliente"];

  salida.forEach((fila, indiceFila) => {
    const titulo = titulos.some((prefijo) => String(fila[0] || "").startsWith(prefijo));
    const subtitulo = String(fila[0] || "").startsWith("Periodo:");
    const cabecera = cabeceras.includes(fila[0]);
    const totalDeSede = String(fila[0] || "").startsWith("TOTAL ");
    if (titulo || subtitulo)
      hoja["!merges"].push({
        s: { r: indiceFila, c: 0 },
        e: { r: indiceFila, c: anchoColumnas - 1 },
      });
    fila.forEach((_, indiceColumna) => {
      const celda = hoja[XLSX.utils.encode_cell({ r: indiceFila, c: indiceColumna })];
      if (!celda) return;
      celda.s = titulo
        ? {
            font: { bold: true, color: { rgb: "FFFFFF" }, sz: 13 },
            fill: { fgColor: { rgb: "991B1B" } },
            alignment: { horizontal: "center" },
          }
        : subtitulo
          ? { font: { italic: true, color: { rgb: "475569" } }, alignment: { horizontal: "center" } }
          : cabecera
            ? {
                font: { bold: true, color: { rgb: "FFFFFF" } },
                fill: { fgColor: { rgb: "B91C1C" } },
                alignment: { horizontal: "center", wrapText: true },
                border: borde,
              }
            : totalDeSede
              ? {
                  font: { bold: true, color: { rgb: "1E293B" } },
                  fill: { fgColor: { rgb: "FDE68A" } },
                  border: borde,
                  alignment: { horizontal: indiceColumna === 0 ? "left" : "right" },
                }
              : {
                  fill: { fgColor: { rgb: indiceFila % 2 ? "FFFFFF" : "F8FAFC" } },
                  border: borde,
                  alignment: { horizontal: indiceColumna === 0 ? "left" : "right" },
                };
      // "Ticket promedio" cae siempre en la columna 1 del bloque RESUMEN
      // GENERAL (Indicador/Valor) y en la columna 2 de POR SEDE/POR EMPRESA
      // (mismo layout de 4 columnas en ambos, incluida la fila TOTAL).
      const esTicketGeneral = indiceFila === filaTicketGeneral && indiceColumna === 1;
      const esTicketDeTabla = !titulo && !subtitulo && !cabecera && indiceColumna === 2 && fila.length === 4;
      if (esTicketGeneral || esTicketDeTabla) celda.z = "#,##0.00";
    });
  });
  XLSX.utils.book_append_sheet(libro, hoja, "Unidades Atendidas");
}

// Consolida hojas analíticas y aplica logo, título y fecha a todo el libro.
async function aplicarPresentacionCorporativa(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const executive = workbook.getWorksheet("Resumen ejecutivo");
  // Sede y área permanecen dentro del resumen; KPI generales se elimina por
  // solicitud del usuario para no repetir indicadores del cuadro superior.
  for (const sheetName of ["Análisis por sede", "Análisis por área"]) {
    const source = workbook.getWorksheet(sheetName);
    if (!executive || !source) continue;
    executive.addRow([]);
    const sectionRow = executive.addRow([sheetName.toUpperCase()]);
    executive.mergeCells(
      sectionRow.number,
      1,
      sectionRow.number,
      Math.max(14, source.columnCount),
    );
    sectionRow.height = 24;
    sectionRow.getCell(1).style = {
      font: { bold: true, color: { argb: "FFFFFFFF" }, size: 12 },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF991B1B" },
      },
      alignment: { horizontal: "center" },
    };
    source.eachRow({ includeEmpty: false }, (sourceRow) => {
      const target = executive.addRow(sourceRow.values.slice(1));
      sourceRow.eachCell({ includeEmpty: true }, (cell, column) => {
        target.getCell(column).style = { ...cell.style };
        target.getCell(column).numFmt = cell.numFmt;
      });
    });
    workbook.removeWorksheet(source.id);
  }
  const kpiSheet = workbook.getWorksheet("KPI generales");
  if (kpiSheet) workbook.removeWorksheet(kpiSheet.id);

  const logoCandidates = [
    resolve(process.cwd(), "../frontend/public/assets/logo.jpg"),
    resolve(process.cwd(), "frontend/public/assets/logo.jpg"),
  ];
  const logoPath = logoCandidates.find(existsSync);
  const logoId = logoPath
    ? workbook.addImage({ filename: logoPath, extension: "jpeg" })
    : null;
  const today = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());

  workbook.eachSheet((sheet) => {
    // Excel exige defaultRowHeight cuando customHeight está presente. Sin este
    // valor intenta reparar el XML de cada hoja al abrir el archivo.
    sheet.properties.defaultRowHeight = 15;
    // ExcelJS no desplaza correctamente combinaciones existentes al insertar
    // filas; se guardan, se liberan y se recrean cinco filas más abajo.
    const previousMerges = Object.values(sheet._merges || {}).map((merge) => ({
      ...merge.model,
    }));
    previousMerges.forEach((merge) =>
      sheet.unMergeCells(merge.top, merge.left, merge.bottom, merge.right),
    );
    sheet.spliceRows(1, 0, [], [], [], [], []);
    previousMerges.forEach((merge) =>
      sheet.mergeCells(
        merge.top + 5,
        merge.left,
        merge.bottom + 5,
        merge.right,
      ),
    );
    const lastColumn = Math.max(6, sheet.columnCount);
    sheet.mergeCells(1, 3, 1, lastColumn);
    sheet.mergeCells(2, 3, 2, lastColumn);
    sheet.getCell("C1").value = "PINEDA AUTOMOTRIZ - TALLER MULTIMARCA";
    sheet.getCell("C2").value = `Fecha de generación: ${today}`;
    sheet.getCell("C1").style = {
      font: { bold: true, size: 16, color: { argb: "FFFFFFFF" } },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFB91C1C" },
      },
      alignment: { horizontal: "center", vertical: "middle" },
    };
    sheet.getCell("C2").style = {
      font: { bold: true, color: { argb: "FF991B1B" } },
      alignment: { horizontal: "center" },
    };
    sheet.getRow(1).height = 26;
    sheet.getRow(2).height = 20;
    if (logoId !== null)
      sheet.addImage(logoId, {
        tl: { col: 0, row: 0 },
        ext: { width: 105, height: 55 },
        editAs: "oneCell",
      });
    sheet.views = [{ state: "frozen", ySplit: 5, xSplit: 0 }];
    sheet.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    };
    sheet.headerFooter = {
      ...(sheet.headerFooter || {}),
      oddFooter: "Pineda Automotriz - Taller Multimarca · Página &P de &N",
    };

    // Estas hojas son listados de revisión: se quitan los autofiltros y se
    // resalta la cabecera de la tabla con el rojo corporativo.
    if (["Documentos", "NC y anulaciones"].includes(sheet.name)) {
      sheet.autoFilter = null;
      const tableHeader = sheet.getRow(6);
      tableHeader.height = 23;
      tableHeader.eachCell({ includeEmpty: false }, (cell) => {
        cell.style = {
          ...cell.style,
          font: { bold: true, color: { argb: "FFFFFFFF" } },
          fill: {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFB91C1C" },
          },
          alignment: {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          },
          border: {
            top: { style: "thin", color: { argb: "FFFFFFFF" } },
            bottom: { style: "thin", color: { argb: "FFFFFFFF" } },
            left: { style: "thin", color: { argb: "FFFFFFFF" } },
            right: { style: "thin", color: { argb: "FFFFFFFF" } },
          },
        };
      });
    }
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Organiza todo el resumen en una sola tabla filtrable y lista para tablas dinámicas.
function agregarResumenEjecutivo(
  libro,
  { month, local, meta, resumen, avanceDiario, areas, comparativo },
) {
  const total = resumen.find((row) => row.Local === "TOTAL GENERAL") || {};
  const facturacion = Number(total["Facturación sin IGV"] || 0);
  const comprobantes = Number(total.Comprobantes || 0);
  const dias = avanceDiario.filter(
    (row) => Number(row["Total oficial sin IGV"] || 0) !== 0,
  );
  const mejorDia = [...dias].sort(
    (a, b) =>
      Number(b["Total oficial sin IGV"]) - Number(a["Total oficial sin IGV"]),
  )[0];
  const anterior = Number(comparativo?.anterior || 0);
  const actual = Number(comparativo?.actual || facturacion);

  // Da a las tres hojas el mismo formato gerencial sin mezclar granularidades.
  const appendStyledSheet = (
    name,
    rows,
    widths,
    percentColumns = [],
    currencyColumns = [],
  ) => {
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: sheet["!ref"] };
    sheet["!freeze"] = { ySplit: 1 };
    const columns = Object.keys(rows[0] || {});
    const border = {
      top: { style: "thin", color: { rgb: "CBD5E1" } },
      bottom: { style: "thin", color: { rgb: "CBD5E1" } },
      left: { style: "thin", color: { rgb: "CBD5E1" } },
      right: { style: "thin", color: { rgb: "CBD5E1" } },
    };
    for (let rowIndex = 0; rowIndex <= rows.length; rowIndex += 1) {
      for (
        let columnIndex = 0;
        columnIndex < columns.length;
        columnIndex += 1
      ) {
        const cell =
          sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
        if (!cell) continue;
        cell.s =
          rowIndex === 0
            ? {
                font: { bold: true, color: { rgb: "FFFFFF" } },
                fill: { fgColor: { rgb: "991B1B" } },
                border,
                alignment: { horizontal: "center" },
              }
            : {
                fill: { fgColor: { rgb: rowIndex % 2 ? "F8FAFC" : "FFFFFF" } },
                border,
                alignment: { horizontal: columnIndex === 0 ? "left" : "right" },
                font: { bold: columnIndex === 0 },
              };
      }
    }
    rows.forEach((_, index) => {
      const excelRow = index + 2;
      currencyColumns.forEach((column) => {
        if (sheet[`${column}${excelRow}`])
          sheet[`${column}${excelRow}`].z = "#,##0.00";
      });
      percentColumns.forEach((column) => {
        if (sheet[`${column}${excelRow}`])
          sheet[`${column}${excelRow}`].z = "0.00%";
      });
      if (rows[index].Unidad === "Soles" && sheet[`B${excelRow}`])
        sheet[`B${excelRow}`].z = "#,##0.00";
      if (rows[index].Unidad === "Porcentaje" && sheet[`B${excelRow}`])
        sheet[`B${excelRow}`].z = "0.00%";
    });
    XLSX.utils.book_append_sheet(libro, sheet, name);
  };

  const kpis = [
    {
      Indicador: "Periodo",
      Valor: month,
      Unidad: "Mes",
      Explicación: `Sede: ${local || "Todos los locales"}`,
    },
    {
      Indicador: "Facturación oficial sin IGV",
      Valor: facturacion,
      Unidad: "Soles",
      Explicación:
        "Aprobados, NC y anulaciones aplicadas; no incluye Mostrador",
    },
    {
      Indicador: "IGV",
      Valor: Number(total.IGV || 0),
      Unidad: "Soles",
      Explicación: "Impuesto de los documentos válidos",
    },
    {
      Indicador: "Total con IGV",
      Valor: Number(total["Total con IGV"] || 0),
      Unidad: "Soles",
      Explicación: "Facturación oficial más IGV",
    },
    {
      Indicador: "Comprobantes aprobados",
      Valor: comprobantes,
      Unidad: "Documentos",
      Explicación: "Cada comprobante se cuenta una vez",
    },
    {
      Indicador: "Clientes únicos",
      Valor: Number(total.Clientes || 0),
      Unidad: "Clientes",
      Explicación: "Clientes diferentes en el periodo",
    },
    {
      Indicador: "Ticket promedio",
      Valor: comprobantes ? facturacion / comprobantes : 0,
      Unidad: "Soles",
      Explicación: "Facturación sin IGV / comprobantes",
    },
    {
      Indicador: "Días con movimiento",
      Valor: dias.length,
      Unidad: "Días",
      Explicación: "Días con facturación neta diferente de cero",
    },
    {
      Indicador: "Promedio por día activo",
      Valor: dias.length ? facturacion / dias.length : 0,
      Unidad: "Soles",
      Explicación: "Facturación / días con movimiento",
    },
    {
      Indicador: "Mejor día",
      Valor: mejorDia?.Fecha || "-",
      Unidad: "Fecha",
      Explicación: `Monto: ${Number(mejorDia?.["Total oficial sin IGV"] || 0).toFixed(2)}`,
    },
    {
      Indicador: "Meta mensual",
      Valor: meta,
      Unidad: "Soles",
      Explicación: "Meta ingresada al generar el reporte",
    },
    {
      Indicador: "Cumplimiento de meta",
      Valor: meta ? facturacion / meta : 0,
      Unidad: "Porcentaje",
      Explicación: "Facturación / meta",
    },
    {
      Indicador: "Brecha contra meta",
      Valor: facturacion - meta,
      Unidad: "Soles",
      Explicación: "Positivo supera la meta; negativo indica faltante",
    },
    {
      Indicador: "Mostrador",
      Valor: Number(total.Mostrador || 0),
      Unidad: "Soles",
      Explicación: "Se muestra aparte y no integra el total de asesores",
    },
    {
      Indicador: "Variación mensual",
      Valor: anterior ? (actual - anterior) / anterior : 0,
      Unidad: "Porcentaje",
      Explicación: `Actual ${actual.toFixed(2)} vs. anterior ${anterior.toFixed(2)}`,
    },
  ];
  const sedes = resumen
    .filter((row) => row.Local !== "TOTAL GENERAL")
    .map((row) => ({
      Sede: row.Local,
      "Sin IGV": Number(row["Facturación sin IGV"] || 0),
      IGV: Number(row.IGV || 0),
      "Con IGV": Number(row["Total con IGV"] || 0),
      Comprobantes: Number(row.Comprobantes || 0),
      Clientes: Number(row.Clientes || 0),
      "Ticket promedio":
        Number(row["Facturación sin IGV"] || 0) /
        Math.max(1, Number(row.Comprobantes || 0)),
      Mostrador: Number(row.Mostrador || 0),
    }));
  const areaRows = areas.map((row) => ({
    Área: row.Area,
    "Facturación sin IGV": Number(row.sin_igv || 0),
    Participación: facturacion ? Number(row.sin_igv || 0) / facturacion : 0,
    Documentos: Number(row.documentos || 0),
    "Ticket promedio": Number(row.ticket_promedio || 0),
  }));

  appendStyledSheet("KPI generales", kpis, [32, 20, 16, 62]);
  appendStyledSheet(
    "Análisis por sede",
    sedes,
    [28, 18, 18, 18, 16, 14, 18, 18],
    [],
    ["B", "C", "D", "G", "H"],
  );
  appendStyledSheet(
    "Análisis por área",
    areaRows,
    [38, 22, 18, 16, 20],
    ["C"],
    ["B", "E"],
  );
}

// Crea el tablero anual con bloques de colores, metas y resultados por área.
function agregarResumenAnual(
  libro,
  { month, local, meta, movimientos, general },
) {
  const months = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Setiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  const year = month.slice(0, 4);
  const areas = [
    ...new Set(movimientos.map((row) => row.area || "SIN CLASIFICAR")),
  ];
  const areaValue = (area, monthIndex, field) =>
    Number(
      movimientos.find(
        (row) => row.area === area && Number(row.mes) === monthIndex + 1,
      )?.[field] || 0,
    );
  const generalValue = (monthIndex, field) =>
    Number(
      general.find((row) => Number(row.mes) === monthIndex + 1)?.[field] || 0,
    );
  const rowTotal = (values) =>
    values.reduce((sum, value) => sum + Number(value || 0), 0);
  const rows = [
    [`REPORTE EJECUTIVO DE FACTURACIÓN ${year}`],
    [`Sede: ${local || "Todos los locales"}`],
    [],
  ];
  const blocks = [];
  const addBlock = (title, color, dataRows) => {
    const start = rows.length;
    rows.push([title, ...months, "TOTAL"]);
    rows.push(...dataRows);
    blocks.push({ start, end: rows.length - 1, color });
    rows.push([]);
  };

  const monthlySales = months.map((_, index) => generalValue(index, "sin_igv"));
  const monthlyGoal = months.map(() => Number(meta || 0));
  addBlock("FACTURACIÓN", "A9D18E", [
    ["Meta", ...monthlyGoal, rowTotal(monthlyGoal)],
    ["Alcance", ...monthlySales, rowTotal(monthlySales)],
    [
      "% Alcance",
      ...monthlySales.map((value, index) =>
        monthlyGoal[index] ? value / monthlyGoal[index] : 0,
      ),
      rowTotal(monthlyGoal)
        ? rowTotal(monthlySales) / rowTotal(monthlyGoal)
        : 0,
    ],
  ]);
  addBlock("COMPROBANTES", "8EAADB", [
    [
      "Documentos",
      ...months.map((_, index) => generalValue(index, "documentos")),
      rowTotal(months.map((_, index) => generalValue(index, "documentos"))),
    ],
    [
      "Clientes",
      ...months.map((_, index) => generalValue(index, "clientes")),
      rowTotal(months.map((_, index) => generalValue(index, "clientes"))),
    ],
    [
      "Ticket promedio",
      ...months.map((_, index) => generalValue(index, "ticket")),
      rowTotal(monthlySales) /
        Math.max(
          1,
          rowTotal(months.map((_, index) => generalValue(index, "documentos"))),
        ),
    ],
  ]);
  const palette = [
    "FFD966",
    "F4B183",
    "B4C6E7",
    "C6E0B4",
    "D9EAD3",
    "D9D2E9",
    "FCE5CD",
    "D0E0E3",
  ];
  areas.forEach((area, areaIndex) => {
    const sales = months.map((_, index) => areaValue(area, index, "sin_igv"));
    const docs = months.map((_, index) => areaValue(area, index, "documentos"));
    addBlock(area, palette[areaIndex % palette.length], [
      ["Facturación", ...sales, rowTotal(sales)],
      [
        "Participación",
        ...sales.map((value, index) =>
          monthlySales[index] ? value / monthlySales[index] : 0,
        ),
        rowTotal(monthlySales) ? rowTotal(sales) / rowTotal(monthlySales) : 0,
      ],
      ["Documentos", ...docs, rowTotal(docs)],
    ]);
  });

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = [
    XLSX.utils.decode_range("A1:N1"),
    XLSX.utils.decode_range("A2:N2"),
  ];
  sheet["!cols"] = [
    { wch: 24 },
    ...months.map(() => ({ wch: 14 })),
    { wch: 16 },
  ];
  sheet["!rows"] = [{ hpt: 28 }, { hpt: 22 }];
  const border = {
    top: { style: "thin", color: { rgb: "64748B" } },
    bottom: { style: "thin", color: { rgb: "64748B" } },
    left: { style: "thin", color: { rgb: "64748B" } },
    right: { style: "thin", color: { rgb: "64748B" } },
  };
  sheet.A1.s = {
    font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "991B1B" } },
    alignment: { horizontal: "center" },
  };
  sheet.A2.s = {
    font: { italic: true, color: { rgb: "475569" } },
    alignment: { horizontal: "center" },
  };
  blocks.forEach(({ start, end, color }) => {
    for (let row = start; row <= end; row += 1) {
      for (let column = 0; column < 14; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (!cell) continue;
        cell.s = {
          border,
          alignment: { horizontal: column === 0 ? "left" : "center" },
          fill: { fgColor: { rgb: row === start ? color : "FFFFFF" } },
          font: { bold: row === start || column === 0 },
        };
        if (typeof cell.v === "number")
          cell.z =
            rows[row][0].includes("%") || rows[row][0] === "Participación"
              ? "0.0%"
              : "#,##0.00";
      }
    }
  });
  sheet["!freeze"] = { xSplit: 1, ySplit: 3 };
  XLSX.utils.book_append_sheet(libro, sheet, "Resumen ejecutivo");
}

// Compara el año seleccionado contra el anterior con indicadores mensuales homogéneos.
function agregarComparacionAnual(libro, { month, local, datos }) {
  const currentYear = Number(month.slice(0, 4));
  const previousYear = currentYear - 1;
  const months = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Setiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  const get = (year, monthNumber, site = null) => {
    const matches = datos.filter(
      (row) =>
        Number(row.anio) === year &&
        Number(row.mes) === monthNumber &&
        (!site || row.local_nombre === site),
    );
    const sinIgv = matches.reduce(
      (sum, row) => sum + Number(row.sin_igv || 0),
      0,
    );
    const documentos = matches.reduce(
      (sum, row) => sum + Number(row.documentos || 0),
      0,
    );
    return {
      sin_igv: sinIgv,
      documentos,
      clientes: matches.reduce(
        (sum, row) => sum + Number(row.clientes || 0),
        0,
      ),
      ticket: documentos ? sinIgv / documentos : 0,
    };
  };
  const buildRows = (site = null) => {
    const result = months.map((monthName, index) => {
      const previous = get(previousYear, index + 1, site);
      const current = get(currentYear, index + 1, site);
      const previousSales = Number(previous.sin_igv || 0);
      const currentSales = Number(current.sin_igv || 0);
      return {
        Mes: monthName,
        [`Facturación ${previousYear}`]: previousSales,
        [`Facturación ${currentYear}`]: currentSales,
        "Diferencia S/": currentSales - previousSales,
        "Variación %": previousSales
          ? (currentSales - previousSales) / previousSales
          : "",
        [`Documentos ${previousYear}`]: Number(previous.documentos || 0),
        [`Documentos ${currentYear}`]: Number(current.documentos || 0),
        [`Clientes ${previousYear}`]: Number(previous.clientes || 0),
        [`Clientes ${currentYear}`]: Number(current.clientes || 0),
        [`Ticket ${previousYear}`]: Number(previous.ticket || 0),
        [`Ticket ${currentYear}`]: Number(current.ticket || 0),
      };
    });
    const sum = (key) =>
      result.reduce((total, row) => total + Number(row[key] || 0), 0);
    const previousTotal = sum(`Facturación ${previousYear}`);
    const currentTotal = sum(`Facturación ${currentYear}`);
    result.push({
      Mes: "TOTAL ANUAL",
      [`Facturación ${previousYear}`]: previousTotal,
      [`Facturación ${currentYear}`]: currentTotal,
      "Diferencia S/": currentTotal - previousTotal,
      "Variación %": previousTotal
        ? (currentTotal - previousTotal) / previousTotal
        : "",
      [`Documentos ${previousYear}`]: sum(`Documentos ${previousYear}`),
      [`Documentos ${currentYear}`]: sum(`Documentos ${currentYear}`),
      [`Clientes ${previousYear}`]: "Ver por mes",
      [`Clientes ${currentYear}`]: "Ver por mes",
      [`Ticket ${previousYear}`]: sum(`Documentos ${previousYear}`)
        ? previousTotal / sum(`Documentos ${previousYear}`)
        : 0,
      [`Ticket ${currentYear}`]: sum(`Documentos ${currentYear}`)
        ? currentTotal / sum(`Documentos ${currentYear}`)
        : 0,
    });
    return result;
  };
  const rows = buildRows();
  const callaoRows = buildRows("Pineda Callao");
  const trujilloRows = buildRows("Pineda Trujillo");
  const headers = Object.keys(rows[0]);
  const table = [
    [`COMPARACIÓN ANUAL ${previousYear} VS. ${currentYear}`],
    ["Consolidado y detalle por sede · Importes oficiales sin IGV"],
    [],
    headers,
    ...rows.map((row) => headers.map((header) => row[header])),
    [],
    ["PINEDA CALLAO"],
    headers,
    ...callaoRows.map((row) => headers.map((header) => row[header])),
    [],
    ["PINEDA TRUJILLO"],
    headers,
    ...trujilloRows.map((row) => headers.map((header) => row[header])),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(table);
  const lastColumn = XLSX.utils.encode_col(headers.length - 1);
  sheet["!merges"] = [
    XLSX.utils.decode_range(`A1:${lastColumn}1`),
    XLSX.utils.decode_range(`A2:${lastColumn}2`),
    XLSX.utils.decode_range(`A19:${lastColumn}19`),
    XLSX.utils.decode_range(`A35:${lastColumn}35`),
  ];
  sheet["!cols"] = [{ wch: 17 }, ...headers.slice(1).map(() => ({ wch: 20 }))];
  const border = {
    top: { style: "thin", color: { rgb: "94A3B8" } },
    bottom: { style: "thin", color: { rgb: "94A3B8" } },
    left: { style: "thin", color: { rgb: "94A3B8" } },
    right: { style: "thin", color: { rgb: "94A3B8" } },
  };
  sheet.A1.s = {
    font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "991B1B" } },
    alignment: { horizontal: "center" },
  };
  sheet.A2.s = {
    font: { italic: true, color: { rgb: "475569" } },
    alignment: { horizontal: "center" },
  };
  for (let column = 0; column < headers.length; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 3, c: column })];
    if (cell)
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1E3A8A" } },
        border,
        alignment: { horizontal: "center", wrapText: true },
      };
  }
  rows.forEach((row, index) => {
    const sheetRow = index + 4;
    const isTotal = row.Mes === "TOTAL ANUAL";
    for (let column = 0; column < headers.length; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: sheetRow, c: column })];
      if (!cell) continue;
      cell.s = {
        border,
        font: {
          bold: isTotal || column === 0,
          color: { rgb: isTotal ? "FFFFFF" : "1E293B" },
        },
        fill: {
          fgColor: {
            rgb: isTotal ? "991B1B" : index % 2 ? "EFF6FF" : "FFFFFF",
          },
        },
        alignment: { horizontal: column ? "right" : "left" },
      };
      if ([1, 2, 3, 9, 10].includes(column) && typeof cell.v === "number")
        cell.z = "#,##0.00";
    }
    const variationCell = sheet[XLSX.utils.encode_cell({ r: sheetRow, c: 4 })];
    if (variationCell && typeof variationCell.v === "number") {
      variationCell.z = "0.0%";
      if (!isTotal)
        variationCell.s = {
          ...variationCell.s,
          font: {
            bold: true,
            color: { rgb: variationCell.v >= 0 ? "166534" : "991B1B" },
          },
          fill: {
            fgColor: { rgb: variationCell.v >= 0 ? "BBF7D0" : "FECACA" },
          },
        };
    }
  });
  const styleSiteTable = (
    titleRow,
    headerRow,
    dataStart,
    siteRows,
    titleColor,
  ) => {
    const titleCell = sheet[XLSX.utils.encode_cell({ r: titleRow, c: 0 })];
    if (titleCell)
      titleCell.s = {
        font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: titleColor } },
        alignment: { horizontal: "center" },
      };
    for (let column = 0; column < headers.length; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: column })];
      if (cell)
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "1E3A8A" } },
          border,
          alignment: { horizontal: "center", wrapText: true },
        };
    }
    siteRows.forEach((row, index) => {
      const sheetRow = dataStart + index;
      const isTotal = row.Mes === "TOTAL ANUAL";
      for (let column = 0; column < headers.length; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: sheetRow, c: column })];
        if (!cell) continue;
        cell.s = {
          border,
          font: {
            bold: isTotal || column === 0,
            color: { rgb: isTotal ? "FFFFFF" : "1E293B" },
          },
          fill: {
            fgColor: {
              rgb: isTotal ? titleColor : index % 2 ? "F8FAFC" : "FFFFFF",
            },
          },
          alignment: { horizontal: column ? "right" : "left" },
        };
        if ([1, 2, 3, 9, 10].includes(column) && typeof cell.v === "number")
          cell.z = "#,##0.00";
      }
      const variation = sheet[XLSX.utils.encode_cell({ r: sheetRow, c: 4 })];
      if (variation && typeof variation.v === "number") {
        variation.z = "0.0%";
        if (!isTotal)
          variation.s = {
            ...variation.s,
            font: {
              bold: true,
              color: { rgb: variation.v >= 0 ? "166534" : "991B1B" },
            },
            fill: { fgColor: { rgb: variation.v >= 0 ? "BBF7D0" : "FECACA" } },
          };
      }
    });
  };
  styleSiteTable(18, 19, 20, callaoRows, "B91C1C");
  styleSiteTable(34, 35, 36, trujilloRows, "166534");
  sheet["!freeze"] = { ySplit: 4 };
  XLSX.utils.book_append_sheet(libro, sheet, "Comparación anual");
}

// Construye un bloque gerencial y otro de auditoría dentro de Avance diario.
function agregarAvanceDiario(
  libro,
  { month, local, meta, dias, areas, detalleOt },
) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const dailyGoal = Number(meta || 0) / daysInMonth;
  let accumulated = 0;
  const areaAmount = (date, area) =>
    Number(
      areas.find((row) => row.Fecha === date && row.area === area)?.sin_igv ||
        0,
    );
  const otherAmount = (date) =>
    areas
      .filter(
        (row) =>
          row.Fecha === date &&
          !["P&P LIMA", "GENESIS", "ROGEIRIS", "SIN CLASIFICAR"].includes(
            row.area,
          ),
      )
      .reduce((sum, row) => sum + Number(row.sin_igv || 0), 0);
  const uniqueDetail = (date, field) =>
    new Set(
      detalleOt
        .filter((row) => row.Fecha === date)
        .map((row) => row[field])
        .filter(Boolean),
    ).size;
  const management = dias.map((row, index) => {
    const net = Number(row.neto_sin_igv || 0);
    accumulated += net;
    const accumulatedGoal = dailyGoal * (index + 1);
    return {
      Fecha: row.Fecha,
      "P&P Lima": areaAmount(row.Fecha, "P&P LIMA"),
      Génesis: areaAmount(row.Fecha, "GENESIS"),
      Rogeiris: areaAmount(row.Fecha, "ROGEIRIS"),
      "Otros asesores": otherAmount(row.Fecha),
      "Sin clasificar": areaAmount(row.Fecha, "SIN CLASIFICAR"),
      "Neto del día": net,
      Acumulado: accumulated,
      "Meta acumulada": accumulatedGoal,
      Diferencia: accumulated - accumulatedGoal,
      "% avance": accumulatedGoal ? accumulated / accumulatedGoal : 0,
      Documentos: Number(row.documentos || 0),
      Clientes: Number(row.clientes || 0),
      "Ticket promedio": Number(row.ticket || 0),
    };
  });
  const audit = dias.map((row) => ({
    Fecha: row.Fecha,
    Facturas: Number(row.facturas || 0),
    Boletas: Number(row.boletas || 0),
    "Notas de crédito": Number(row.notas_credito || 0),
    "Descuento NC": Number(row.descuento_nc || 0),
    IGV: Number(row.igv || 0),
    "Total con IGV": Number(row.con_igv || 0),
    Mostrador: Number(row.mostrador || 0),
    Crédito: Number(row.credito || 0),
    Contado: Number(row.contado || 0),
    OT: uniqueDetail(row.Fecha, "OT"),
    Vehículos: uniqueDetail(row.Fecha, "Placa"),
  }));
  const mainHeaders = Object.keys(management[0] || { Fecha: "" });
  const auditHeaders = Object.keys(audit[0] || { Fecha: "" });
  const auditTitleExcelRow = management.length + 6;
  const rows = [
    ["AVANCE DIARIO DE FACTURACIÓN"],
    [
      `Periodo: ${month} · Sede: ${local || "Todos los locales"} · Importes oficiales sin IGV`,
    ],
    [],
    mainHeaders,
    ...management.map((row) => mainHeaders.map((header) => row[header])),
    [],
    ["AUDITORÍA DIARIA"],
    auditHeaders,
    ...audit.map((row) => auditHeaders.map((header) => row[header])),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const maxColumns = Math.max(mainHeaders.length, auditHeaders.length);
  const lastColumn = XLSX.utils.encode_col(maxColumns - 1);
  sheet["!merges"] = [
    XLSX.utils.decode_range(`A1:${lastColumn}1`),
    XLSX.utils.decode_range(`A2:${lastColumn}2`),
    XLSX.utils.decode_range(
      `A${auditTitleExcelRow}:${lastColumn}${auditTitleExcelRow}`,
    ),
  ];
  sheet["!cols"] = Array.from({ length: maxColumns }, (_, index) => ({
    wch: index === 0 ? 14 : 17,
  }));
  const border = {
    top: { style: "thin", color: { rgb: "CBD5E1" } },
    bottom: { style: "thin", color: { rgb: "CBD5E1" } },
    left: { style: "thin", color: { rgb: "CBD5E1" } },
    right: { style: "thin", color: { rgb: "CBD5E1" } },
  };
  const titleStyle = {
    font: { bold: true, sz: 15, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "991B1B" } },
    alignment: { horizontal: "center" },
  };
  sheet.A1.s = titleStyle;
  sheet.A2.s = {
    font: { italic: true, color: { rgb: "475569" } },
    alignment: { horizontal: "center" },
  };
  sheet[`A${auditTitleExcelRow}`].s = titleStyle;
  [3, auditTitleExcelRow].forEach((zeroBasedRow) => {
    for (let column = 0; column < maxColumns; column += 1) {
      const cell =
        sheet[XLSX.utils.encode_cell({ r: zeroBasedRow, c: column })];
      if (cell)
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "B91C1C" } },
          border,
          alignment: { horizontal: "center", wrapText: true },
        };
    }
  });
  for (let row = 4; row < 4 + management.length; row += 1) {
    for (let column = 0; column < mainHeaders.length; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (!cell) continue;
      cell.s = {
        border,
        fill: { fgColor: { rgb: row % 2 ? "F8FAFC" : "FFFFFF" } },
        alignment: { horizontal: column ? "right" : "center" },
      };
      if (column >= 1 && column !== 10 && typeof cell.v === "number")
        cell.z = "#,##0.00";
    }
    const progress = sheet[XLSX.utils.encode_cell({ r: row, c: 10 })];
    if (progress) {
      progress.z = "0.0%";
      progress.s = {
        ...progress.s,
        font: { bold: true },
        fill: {
          fgColor: {
            rgb:
              progress.v >= 1
                ? "BBF7D0"
                : progress.v >= 0.8
                  ? "FEF3C7"
                  : "FECACA",
          },
        },
      };
    }
  }
  const auditStart = auditTitleExcelRow + 1;
  for (let row = auditStart; row < auditStart + audit.length; row += 1) {
    for (let column = 0; column < auditHeaders.length; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (!cell) continue;
      cell.s = {
        border,
        fill: {
          fgColor: {
            rgb:
              column === 4 && Number(cell.v) > 0
                ? "FECACA"
                : row % 2
                  ? "FFF7ED"
                  : "FFFFFF",
          },
        },
        alignment: { horizontal: column ? "right" : "center" },
      };
      if ([4, 5, 6, 7].includes(column) && typeof cell.v === "number")
        cell.z = "#,##0.00";
    }
  }
  sheet["!freeze"] = { ySplit: 4 };
  XLSX.utils.book_append_sheet(libro, sheet, "Avance diario");
}

// Consulta y arma el Excel mensual sin depender del controlador del dashboard.
export async function generarReporteFacturacion({
  month,
  start,
  local,
  meta = 2500000,
}) {
  const params = { start, local };
  const periodo = crearPeriodo(params);
  const base = documentosBase(periodo);
  const yearStart = `${month.slice(0, 4)}-01-01`;
  const annualParams = { ...params, yearStart };
  const annualPeriod = `
    ${fechaDocumento} >= :yearStart
    AND ${fechaDocumento} < DATE_ADD(:yearStart, INTERVAL 1 YEAR)
    ${local ? "AND local_nombre = :local" : ""}
  `;
  const annualBase = documentosBase(annualPeriod);
  const compareStart = `${Number(month.slice(0, 4)) - 1}-01-01`;
  const comparisonParams = { ...params, compareStart };
  const comparisonPeriod = `
    ${fechaDocumento} >= :compareStart
    AND ${fechaDocumento} < DATE_ADD(:compareStart, INTERVAL 2 YEAR)
  `;
  const comparisonBase = documentosBase(comparisonPeriod);

  const [
    resumen,
    avanceDiario,
    documentos,
    incidencias,
    detalleOt,
    pendientes,
    areas,
    comparativo,
    pyp,
    matrizAnual,
    generalAnual,
    areasDiarias,
    comparacionAnual,
    aperturadas,
    otDelMes,
    unidadesAtendidas,
  ] = await Promise.all([
    query(
      `
      SELECT
        COALESCE(local_nombre, 'TOTAL GENERAL') AS Local,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' THEN 1 END) AS Comprobantes,
        COUNT(DISTINCT CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' THEN cliente_documento END) AS Clientes,
        ROUND(SUM(CASE WHEN COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' AND UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' THEN sin_igv ELSE 0 END), 2) AS 'Facturación sin IGV',
        ROUND(SUM(CASE WHEN COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' AND UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' THEN igv ELSE 0 END), 2) AS IGV,
        ROUND(SUM(CASE WHEN COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' AND UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' THEN con_igv ELSE 0 END), 2) AS 'Total con IGV',
        ROUND(SUM(CASE WHEN UPPER(TRIM(clase_venta)) = 'MOSTRADOR' AND UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' THEN sin_igv ELSE 0 END), 2) AS Mostrador
      FROM (${base}) d
      GROUP BY local_nombre WITH ROLLUP
    `,
      params,
    ),
    query(
      `
      SELECT DATE_FORMAT(fecha, '%d/%m/%Y') Fecha,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN sin_igv ELSE 0 END), 2) neto_sin_igv,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN igv ELSE 0 END), 2) igv,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN con_igv ELSE 0 END), 2) con_igv,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN 1 END) documentos,
        COUNT(DISTINCT CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN cliente_documento END) clientes,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN sin_igv ELSE 0 END) / NULLIF(COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN 1 END), 0), 2) ticket,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND (UPPER(tipo_documento) LIKE '%FACT%' OR UPPER(tipo_documento) = 'FA') THEN 1 END) facturas,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND (UPPER(tipo_documento) LIKE '%BOLE%' OR UPPER(tipo_documento) = 'BV') THEN 1 END) boletas,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND UPPER(tipo_documento) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO') THEN 1 END) notas_credito,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND UPPER(tipo_documento) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO') THEN ABS(sin_igv) ELSE 0 END), 2) descuento_nc,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND UPPER(TRIM(clase_venta)) = 'MOSTRADOR' THEN sin_igv ELSE 0 END), 2) mostrador,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND UPPER(forma_pago) LIKE '%CREDITO%' THEN 1 END) credito,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND UPPER(forma_pago) LIKE '%CONTADO%' THEN 1 END) contado
      FROM (${base}) d GROUP BY fecha ORDER BY fecha
    `,
      params,
    ),
    query(
      `
      SELECT DATE_FORMAT(fecha, '%d/%m/%Y') Fecha, tipo_documento AS Tipo, nro_documento AS Documento,
        cliente_documento AS 'Documento cliente', cliente AS Cliente, local_nombre AS Local, moneda AS Moneda,
        moneda_usd AS 'Importe USD', sin_igv AS 'Sin IGV', igv AS IGV, con_igv AS 'Con IGV',
        clase_venta AS 'Clase venta', asesor AS Asesor, forma_pago AS 'Forma pago', estado AS Estado,
        estado_sunat AS 'Estado SUNAT', operacion_relacionada AS 'Operación relacionada'
      FROM (${base}) d ORDER BY fecha, nro_documento
    `,
      params,
    ),
    query(
      `
      SELECT DATE_FORMAT(fecha, '%d/%m/%Y') Fecha, tipo_documento AS Tipo, nro_documento AS Documento,
        operacion_relacionada AS 'Documento afectado', cliente AS Cliente, local_nombre AS Local,
        asesor AS Asesor, sin_igv AS 'Impacto sin IGV', estado AS Estado, estado_sunat AS 'Estado SUNAT'
      FROM (${base}) d
      WHERE ${esNotaCredito} OR UPPER(TRIM(estado)) = 'ANULADO'
      ORDER BY fecha, nro_documento
    `,
      params,
    ),
    query(
      `
      SELECT DATE_FORMAT(df.fec_emision, '%d/%m/%Y') Fecha, df.local_nombre AS Local,
        df.nro_documento AS Documento, df.nro_ot AS OT, df.asesor AS Asesor, df.placa AS Placa,
        df.grupo_servicio AS 'Grupo servicio', df.clase_ot AS 'Clase OT', df.tipo_ot AS 'Tipo OT',
        df.descripcion AS Descripción, df.cantidad AS Cantidad, df.total_con_igv AS 'Total línea con IGV',
        df.departamento AS Departamento, df.provincia AS Provincia, df.distrito AS Distrito
      FROM detalle_factura_ot df
      WHERE df.fec_emision >= :start AND df.fec_emision < DATE_ADD(:start, INTERVAL 1 MONTH)
        ${local ? "AND df.local_nombre = :local" : ""}
      ORDER BY df.fec_emision, df.nro_documento, df.nro_ot
    `,
      params,
    ),
    query(
      `
      SELECT DATE_FORMAT(fecha, '%d/%m/%Y') Fecha, nro_documento AS Documento, cliente AS Cliente,
        local_nombre AS Local, asesor AS Asesor, clase_venta AS 'Clase venta', sin_igv AS 'Sin IGV',
        CASE
          WHEN UPPER(TRIM(estado)) = 'ANULADO' THEN 'Documento anulado'
          WHEN UPPER(TRIM(estado_sunat)) <> 'APROBADO' THEN CONCAT('SUNAT: ', COALESCE(estado_sunat, 'Sin estado'))
          WHEN COALESCE(TRIM(asesor), '') = '' THEN 'Sin asesor'
          WHEN NOT EXISTS (SELECT 1 FROM detalle_factura_ot df WHERE df.local_nombre = d.local_nombre AND df.nro_documento = d.nro_documento) THEN 'Sin detalle factura-OT'
          ELSE 'Revisar clasificación'
        END AS Motivo
      FROM (${base}) d
      WHERE UPPER(TRIM(estado)) = 'ANULADO' OR UPPER(TRIM(estado_sunat)) <> 'APROBADO'
        OR COALESCE(TRIM(asesor), '') = ''
        OR NOT EXISTS (SELECT 1 FROM detalle_factura_ot df WHERE df.local_nombre = d.local_nombre AND df.nro_documento = d.nro_documento)
      ORDER BY fecha, nro_documento
    `,
      params,
    ),
    query(
      `
      SELECT CASE
        WHEN UPPER(COALESCE(asesor, '')) LIKE '%DURAN MENDOZA KARLISMAR%' OR UPPER(COALESCE(asesor, '')) LIKE '%TEQUEN ACOSTA ALEXANDER%' THEN 'P&P LIMA'
        WHEN UPPER(COALESCE(asesor, '')) LIKE '%GENESIS%' THEN 'GENESIS'
        WHEN UPPER(COALESCE(asesor, '')) LIKE '%ROGEIRIS%' THEN 'ROGEIRIS'
        WHEN COALESCE(TRIM(asesor), '') = '' THEN 'SIN CLASIFICAR'
        ELSE UPPER(TRIM(asesor)) END AS Area,
        ROUND(SUM(sin_igv), 2) sin_igv, COUNT(*) documentos,
        ROUND(SUM(sin_igv) / NULLIF(COUNT(*), 0), 2) ticket_promedio
      FROM (${base}) d
      WHERE UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO'
        AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR'
      GROUP BY Area ORDER BY sin_igv DESC
    `,
      params,
    ),
    query(
      `
      SELECT
        SUM(CASE WHEN ${fechaDocumento} >= :start AND ${fechaDocumento} < DATE_ADD(:start, INTERVAL 1 MONTH) THEN ${importeContable(importeSinIgv)} ELSE 0 END) actual,
        SUM(CASE WHEN ${fechaDocumento} >= DATE_SUB(:start, INTERVAL 1 MONTH) AND ${fechaDocumento} < :start THEN ${importeContable(importeSinIgv)} ELSE 0 END) anterior
      FROM registro_venta
      WHERE ${fechaDocumento} >= DATE_SUB(:start, INTERVAL 1 MONTH) AND ${fechaDocumento} < DATE_ADD(:start, INTERVAL 1 MONTH)
        AND UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO'
        AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' ${local ? "AND local_nombre = :local" : ""}
    `,
      params,
    ).then((rows) => rows[0] || {}),
    query(
      `
      SELECT df.local_nombre AS Local, COUNT(DISTINCT df.nro_ot) AS OT,
        COUNT(DISTINCT NULLIF(df.placa, '')) AS Vehiculos, ROUND(SUM(df.total_con_igv), 2) AS 'Valor operativo con IGV',
        ROUND(SUM(df.nro_panos), 2) AS Paños, ROUND(SUM(df.horas_hombre), 2) AS 'Horas hombre',
        ROUND(SUM(df.total_con_igv) / NULLIF(COUNT(DISTINCT df.nro_ot), 0), 2) AS 'Ticket por OT'
      FROM detalle_factura_ot df
      WHERE df.fec_emision >= :start AND df.fec_emision < DATE_ADD(:start, INTERVAL 1 MONTH)
        AND (UPPER(COALESCE(df.asesor, '')) LIKE '%DURAN MENDOZA KARLISMAR%' OR UPPER(COALESCE(df.asesor, '')) LIKE '%TEQUEN ACOSTA ALEXANDER%')
        ${local ? "AND df.local_nombre = :local" : ""}
      GROUP BY df.local_nombre
    `,
      params,
    ),
    query(
      `
      WITH documentos AS (${annualBase}),
      referencia AS (
        SELECT d.*,
          CASE WHEN UPPER(d.tipo_documento) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')
            THEN COALESCE((SELECT MIN(x.nro_documento) FROM detalle_factura_ot x
              WHERE x.local_nombre = d.local_nombre
                AND (x.nro_documento = d.operacion_relacionada OR x.nro_ot = REPLACE(UPPER(d.operacion_relacionada), 'OT-', ''))), d.nro_documento)
            ELSE d.nro_documento END AS documento_detalle
        FROM documentos d
        WHERE UPPER(TRIM(d.estado)) <> 'ANULADO' AND UPPER(TRIM(d.estado_sunat)) = 'APROBADO'
          AND COALESCE(UPPER(TRIM(d.clase_venta)), '') <> 'MOSTRADOR'
      ),
      peso_asesor AS (
        SELECT local_nombre, nro_documento, COALESCE(NULLIF(TRIM(asesor), ''), 'Sin asesor') asesor,
          SUM(ABS(total_con_igv)) peso
        FROM detalle_factura_ot GROUP BY local_nombre, nro_documento, COALESCE(NULLIF(TRIM(asesor), ''), 'Sin asesor')
      ),
      peso_total AS (
        SELECT local_nombre, nro_documento, SUM(ABS(total_con_igv)) peso
        FROM detalle_factura_ot GROUP BY local_nombre, nro_documento
      ),
      asignado AS (
        SELECT r.nro_documento, r.fecha, COALESCE(pa.asesor, r.asesor, 'Sin asesor') asesor,
          r.sin_igv * CASE WHEN COALESCE(pt.peso, 0) > 0 THEN pa.peso / pt.peso ELSE 1 END sin_igv
        FROM referencia r
        LEFT JOIN peso_total pt ON pt.local_nombre = r.local_nombre AND pt.nro_documento = r.documento_detalle
        LEFT JOIN peso_asesor pa ON pa.local_nombre = pt.local_nombre AND pa.nro_documento = pt.nro_documento
      )
      SELECT MONTH(fecha) mes,
        CASE
          WHEN UPPER(asesor) LIKE '%DURAN MENDOZA KARLISMAR%' OR UPPER(asesor) LIKE '%TEQUEN ACOSTA ALEXANDER%' THEN 'P&P LIMA'
          WHEN UPPER(asesor) LIKE '%GENESIS%' THEN 'GENESIS'
          WHEN UPPER(asesor) LIKE '%ROGEIRIS%' THEN 'ROGEIRIS'
          WHEN COALESCE(TRIM(asesor), '') = '' OR UPPER(asesor) = 'SIN ASESOR' THEN 'SIN CLASIFICAR'
          ELSE UPPER(TRIM(asesor))
        END area,
        ROUND(SUM(sin_igv), 2) sin_igv,
        COUNT(DISTINCT nro_documento) documentos
      FROM asignado GROUP BY MONTH(fecha), area ORDER BY MONTH(fecha), area
    `,
      annualParams,
    ),
    query(
      `
      SELECT MONTH(fecha) mes,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN sin_igv ELSE 0 END), 2) sin_igv,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN 1 END) documentos,
        COUNT(DISTINCT CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN cliente_documento END) clientes,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN sin_igv ELSE 0 END) /
          NULLIF(COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN 1 END), 0), 2) ticket
      FROM (${annualBase}) d GROUP BY MONTH(fecha) ORDER BY MONTH(fecha)
    `,
      annualParams,
    ),
    query(
      `
      WITH documentos AS (${base}), referencia AS (
        SELECT d.*, CASE WHEN UPPER(d.tipo_documento) IN ('NC', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')
          THEN COALESCE((SELECT MIN(x.nro_documento) FROM detalle_factura_ot x WHERE x.local_nombre = d.local_nombre AND (x.nro_documento = d.operacion_relacionada OR x.nro_ot = REPLACE(UPPER(d.operacion_relacionada), 'OT-', ''))), d.nro_documento)
          ELSE d.nro_documento END documento_detalle
        FROM documentos d WHERE UPPER(TRIM(d.estado)) <> 'ANULADO' AND UPPER(TRIM(d.estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(d.clase_venta)), '') <> 'MOSTRADOR'
      ), peso_asesor AS (
        SELECT local_nombre, nro_documento, COALESCE(NULLIF(TRIM(asesor), ''), 'Sin asesor') asesor, SUM(ABS(total_con_igv)) peso
        FROM detalle_factura_ot GROUP BY local_nombre, nro_documento, COALESCE(NULLIF(TRIM(asesor), ''), 'Sin asesor')
      ), peso_total AS (
        SELECT local_nombre, nro_documento, SUM(ABS(total_con_igv)) peso FROM detalle_factura_ot GROUP BY local_nombre, nro_documento
      ), asignado AS (
        SELECT r.fecha, COALESCE(pa.asesor, r.asesor, 'Sin asesor') asesor, r.sin_igv * CASE WHEN COALESCE(pt.peso, 0) > 0 THEN pa.peso / pt.peso ELSE 1 END sin_igv
        FROM referencia r LEFT JOIN peso_total pt ON pt.local_nombre = r.local_nombre AND pt.nro_documento = r.documento_detalle
        LEFT JOIN peso_asesor pa ON pa.local_nombre = pt.local_nombre AND pa.nro_documento = pt.nro_documento
      )
      SELECT DATE_FORMAT(fecha, '%d/%m/%Y') Fecha,
        CASE WHEN UPPER(asesor) LIKE '%DURAN MENDOZA KARLISMAR%' OR UPPER(asesor) LIKE '%TEQUEN ACOSTA ALEXANDER%' THEN 'P&P LIMA'
          WHEN UPPER(asesor) LIKE '%GENESIS%' THEN 'GENESIS' WHEN UPPER(asesor) LIKE '%ROGEIRIS%' THEN 'ROGEIRIS'
          WHEN COALESCE(TRIM(asesor), '') = '' OR UPPER(asesor) = 'SIN ASESOR' THEN 'SIN CLASIFICAR' ELSE UPPER(TRIM(asesor)) END area,
        ROUND(SUM(sin_igv), 2) sin_igv
      FROM asignado GROUP BY fecha, area ORDER BY fecha, area
    `,
      params,
    ),
    query(
      `
      SELECT local_nombre, YEAR(fecha) anio, MONTH(fecha) mes,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN sin_igv ELSE 0 END), 2) sin_igv,
        COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN 1 END) documentos,
        COUNT(DISTINCT CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN cliente_documento END) clientes,
        ROUND(SUM(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN sin_igv ELSE 0 END) /
          NULLIF(COUNT(CASE WHEN UPPER(TRIM(estado)) <> 'ANULADO' AND UPPER(TRIM(estado_sunat)) = 'APROBADO' AND COALESCE(UPPER(TRIM(clase_venta)), '') <> 'MOSTRADOR' THEN 1 END), 0), 2) ticket
      FROM (${comparisonBase}) d
      GROUP BY local_nombre, YEAR(fecha), MONTH(fecha) ORDER BY local_nombre, YEAR(fecha), MONTH(fecha)
    `,
      comparisonParams,
    ),
    // Arrastre histórico: OT que continúa APERTURADA al cierre del mes elegido.
    query(
      `
      SELECT
        DATE_FORMAT(MIN(STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d')), '%d/%m/%Y') AS 'Fecha apertura',
        DATEDIFF(LEAST(CURDATE(), LAST_DAY(:start)), MIN(STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d'))) AS 'Días aperturada',
        nro_orden AS OT, MAX(cliente_nombre) AS Cliente, MAX(placa) AS Placa,
        MAX(asesor) AS Asesor, MAX(grupo_servicio) AS 'Grupo servicio',
        MAX(clase_ot) AS 'Clase OT', MAX(tipo_ot) AS 'Tipo OT', MAX(moneda) AS Moneda,
        ROUND(SUM(${numero("valor_venta")}), 2) AS 'Valor pendiente sin IGV',
        DATE_FORMAT(MAX(STR_TO_DATE(NULLIF(TRIM(fec_factura), ''), '%Y-%m-%d')), '%d/%m/%Y') AS 'Fecha factura',
        MAX(nro_factura) AS 'Nro. factura', MAX(estado) AS Estado, local_nombre AS Local
      FROM orden_trabajo
      WHERE UPPER(TRIM(estado)) = 'APERTURADO'
        AND STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') < DATE_ADD(:start, INTERVAL 1 MONTH)
        ${local ? "AND local_nombre = :local" : ""}
      GROUP BY local_nombre, nro_orden
      ORDER BY local_nombre, MIN(STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d')), nro_orden
    `,
      params,
    ),
    // OT del mes: solo las que ABRIERON dentro del mes elegido (sin importar
    // el mes en que se cierren), para que el ticket promedio nunca arrastre OT
    // de otro mes. Y solo estado APERTURADO/CERRADO: FACTURADO, LIQUIDADO y
    // "FACTURADO INT" ya pasaron por facturación y no son "pendiente" para
    // este reporte (eso ya se ve en Registro de Venta).
    query(
      `
      SELECT
        local_nombre AS Local,
        nro_orden AS OT,
        COALESCE(NULLIF(TRIM(MAX(asesor)), ''), 'Sin asesor') AS Asesor,
        COALESCE(NULLIF(TRIM(MAX(cliente_nombre)), ''), 'Sin cliente') AS Cliente,
        UPPER(TRIM(MAX(estado))) AS Estado,
        SUM(${numero("precio_venta")}) AS Ticket
      FROM orden_trabajo
      WHERE STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') >= :start
        AND STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') < DATE_ADD(:start, INTERVAL 1 MONTH)
        AND UPPER(TRIM(estado)) IN ('APERTURADO', 'CERRADO')
        ${local ? "AND local_nombre = :local" : ""}
      GROUP BY local_nombre, nro_orden
    `,
      params,
    ),
    // Unidades atendidas: a diferencia de "OT del mes" (que cuenta ORDENES),
    // esto cuenta VEHICULOS distintos (por placa) con al menos una OT abierta
    // en el mes, sin importar en que estado terminen. "Pendiente" marca los
    // que todavia tienen alguna OT sin cerrar (siguen en el taller).
    query(
      `
      SELECT
        local_nombre AS Local,
        COALESCE(NULLIF(TRIM(placa), ''), 'Sin placa') AS Placa,
        COALESCE(NULLIF(TRIM(MAX(cliente_nombre)), ''), 'Sin cliente') AS Cliente,
        SUM(${numero("precio_venta")}) AS Ticket,
        MAX(CASE WHEN UPPER(TRIM(estado)) = 'APERTURADO' THEN 1 ELSE 0 END) AS Pendiente
      FROM orden_trabajo
      WHERE STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') >= :start
        AND STR_TO_DATE(NULLIF(TRIM(fec_apertura), ''), '%Y-%m-%d') < DATE_ADD(:start, INTERVAL 1 MONTH)
        ${local ? "AND local_nombre = :local" : ""}
      GROUP BY local_nombre, COALESCE(NULLIF(TRIM(placa), ''), 'Sin placa')
    `,
      params,
    ),
  ]);

  const libro = XLSX.utils.book_new();
  agregarResumenAnual(libro, {
    month,
    local,
    meta,
    movimientos: matrizAnual,
    general: generalAnual,
  });
  agregarComparacionAnual(libro, { month, local, datos: comparacionAnual });
  agregarResumenEjecutivo(libro, {
    month,
    local,
    meta,
    resumen,
    avanceDiario,
    areas,
    comparativo,
  });
  agregarAvanceDiario(libro, {
    month,
    local,
    meta,
    dias: avanceDiario,
    areas: areasDiarias,
    detalleOt,
  });
  agregarHoja(libro, "Documentos", documentos);
  agregarHoja(libro, "NC y anulaciones", incidencias);
  agregarPendientesAperturados(libro, aperturadas);
  agregarOtDelMes(libro, otDelMes, { month, local });
  agregarUnidadesAtendidas(libro, unidadesAtendidas, { month, local });

  const baseBuffer = XLSX.write(libro, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });
  return {
    buffer: await aplicarPresentacionCorporativa(baseBuffer),
    filename:
      `reporte_facturacion_${month}_${local || "todos"}.xlsx`.replaceAll(
        /[^a-zA-Z0-9_.-]/g,
        "_",
      ),
  };
}

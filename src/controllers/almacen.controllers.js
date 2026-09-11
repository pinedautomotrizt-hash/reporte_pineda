import { pool as db } from "../db.js";

/**
 * Controller para consultar la Lista Maestra de Almacén desde la vista relacional v_lista_maestra_almacen
 */
export async function getListaMaestraAlmacen(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const offset = (page - 1) * limit;

    const {
      busqueda,
      descripcion,
      sistema,
      sub_sistema,
      marca_vehiculo,
      modelo,
      sede,
      tipo,
      origen,
      familia,
      con_stock,
    } = req.query;

    const whereClauses = [];
    const params = [];

    if (busqueda && busqueda.trim() !== "") {
      const term = `%${busqueda.trim()}%`;
      whereClauses.push(
        "(codigo_actual LIKE ? OR codigo_nuevo_propuesto LIKE ? OR descripcion_original_erp LIKE ? OR descripcion LIKE ? OR modelo LIKE ? OR marca_vehiculo LIKE ?)"
      );
      params.push(term, term, term, term, term, term);
    }

    if (descripcion && descripcion.trim() !== "") {
      whereClauses.push("descripcion = ?");
      params.push(descripcion.trim());
    }

    if (sistema && sistema.trim() !== "") {
      whereClauses.push("sistema = ?");
      params.push(sistema.trim());
    }

    if (sub_sistema && sub_sistema.trim() !== "") {
      whereClauses.push("sub_sistema = ?");
      params.push(sub_sistema.trim());
    }

    if (marca_vehiculo && marca_vehiculo.trim() !== "") {
      whereClauses.push("marca_vehiculo = ?");
      params.push(marca_vehiculo.trim());
    }

    if (modelo && modelo.trim() !== "") {
      whereClauses.push("modelo = ?");
      params.push(modelo.trim());
    }

    if (sede && sede.trim() !== "") {
      whereClauses.push("sede = ?");
      params.push(sede.trim());
    }

    if (tipo && tipo.trim() !== "") {
      whereClauses.push("tipo = ?");
      params.push(tipo.trim());
    }

    if (origen && origen.trim() !== "") {
      whereClauses.push("origen = ?");
      params.push(origen.trim());
    }

    if (familia && familia.trim() !== "") {
      whereClauses.push("familia_original_erp = ?");
      params.push(familia.trim());
    }

    if (con_stock === "true" || con_stock === "1") {
      whereClauses.push("stock_disponible > 0");
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countSql = `
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(stock_disponible), 0) as total_stock,
        COALESCE(SUM(valor_total_stock), 0) as total_valor
      FROM v_lista_maestra_almacen
      ${whereSQL}
    `;
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0]?.total || 0;
    const totalStock = countRows[0]?.total_stock || 0;
    const totalValor = countRows[0]?.total_valor || 0;

    const dataSql = `
      SELECT *
      FROM v_lista_maestra_almacen
      ${whereSQL}
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.query(dataSql, [...params, limit, offset]);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      resumen: {
        totalStock,
        totalValor,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller para obtener todos los catálogos relacionales de almacén
 */
export async function getResumenCategoriasAlmacen(_req, res, next) {
  try {
    const [sedes] = await db.query("SELECT id, nombre FROM cat_sede ORDER BY nombre ASC");
    const [tipos] = await db.query("SELECT id, codigo, nombre FROM cat_tipo ORDER BY nombre ASC");
    const [origenes] = await db.query("SELECT id, codigo, nombre FROM cat_origen ORDER BY nombre ASC");
    const [sistemas] = await db.query("SELECT id, codigo, nombre FROM cat_sistema ORDER BY nombre ASC");
    const [subsistemas] = await db.query("SELECT id, codigo, nombre FROM cat_subsistema ORDER BY nombre ASC");
    const [marcas] = await db.query("SELECT id, codigo, nombre FROM cat_marca_vehiculo ORDER BY nombre ASC");
    const [modelos] = await db.query("SELECT id, codigo, nombre FROM cat_modelo ORDER BY nombre ASC");
    const [familias] = await db.query("SELECT id, nombre FROM cat_familia ORDER BY nombre ASC");

    const [descripciones] = await db.query(`
      SELECT descripcion, COUNT(*) as cantidad, SUM(stock_disponible) as total_stock
      FROM lista_maestra_almacen
      WHERE descripcion IS NOT NULL AND descripcion != ''
      GROUP BY descripcion
      ORDER BY cantidad DESC
    `);

    res.json({
      sedes,
      tipos,
      origenes,
      sistemas,
      subsistemas,
      marcas,
      modelos,
      familias,
      descripciones,
    });
  } catch (error) {
    next(error);
  }
}

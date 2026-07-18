// Error con status HTTP explícito: el manejador global en server.js confía en
// este mensaje y lo manda tal cual al cliente (son validaciones pensadas para
// que el usuario las lea, ej. "la fila X tiene menos columnas..."). Cualquier
// otro error (sin status) se trata como inesperado y no se expone su detalle.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

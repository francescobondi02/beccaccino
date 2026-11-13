export class ClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ClientError";
  }
}

export const badRequest = (message: string) => new ClientError(400, message);
export const unauthorized = (message = "Authentication required") =>
  new ClientError(401, message);
export const forbidden = (message: string) => new ClientError(403, message);
export const notFound = (message: string) => new ClientError(404, message);
export const conflict = (
  message: string,
  details?: Record<string, unknown>,
) => new ClientError(409, message, details);

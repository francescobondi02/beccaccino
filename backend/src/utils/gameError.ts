import { ClientError } from "../http/errors";

/**
 * A game-rule violation with the HTTP status it should map to. Controllers
 * used to derive statuses by substring-matching error messages, which meant
 * rewording a message silently changed the response code.
 */
export class GameError extends ClientError {
  constructor(
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(status, message, details);
    this.name = "GameError";
  }
}

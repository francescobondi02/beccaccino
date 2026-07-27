/**
 * A game-rule violation with the HTTP status it should map to. Controllers
 * used to derive statuses by substring-matching error messages, which meant
 * rewording a message silently changed the response code.
 */
export class GameError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GameError";
  }
}

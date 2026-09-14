import { badRequest } from "../errors";
import { validateUsername } from "../../utils/validateUsername";

type Body = Record<string, unknown> | null | undefined;

export function parseRegistrationInput(body: Body) {
  const username = body?.username;
  const password = body?.password;
  const email = body?.email;
  if (typeof username !== "string" || typeof password !== "string") {
    throw badRequest("Username and password are required");
  }

  const validated = validateUsername(username);
  if (!validated.ok) throw badRequest(validated.error);
  if (password.length < 6) {
    throw badRequest("Password must be at least 6 characters");
  }
  if (email !== undefined && email !== null && typeof email !== "string") {
    throw badRequest("Email must be a string");
  }

  return {
    username: validated.value,
    password,
    email: email || null,
  };
}

export function parseLoginInput(body: Body) {
  const username = body?.username;
  const password = body?.password;
  if (
    typeof username !== "string" ||
    username.length === 0 ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    throw badRequest("Username and password are required");
  }
  return { username, password };
}

export function parseUsernameUpdate(body: Body): string {
  const validated = validateUsername(body?.username);
  if (!validated.ok) throw badRequest(validated.error);
  return validated.value;
}

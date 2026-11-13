import { Request } from "express";
import { JwtPayload } from "../utils/jwt";
import { unauthorized } from "./errors";

export function requireUser(req: Request): JwtPayload {
  if (!req.user) throw unauthorized();
  return req.user;
}

import { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { forbidden, unauthorized } from "../http/errors";

export async function requireAnnotationAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return next(unauthorized());
  }
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { deletedAt: true, expertAccessGrantedAt: true },
  });
  if (!user || user.deletedAt) {
    return next(unauthorized());
  }
  if (!user.expertAccessGrantedAt) {
    return next(forbidden("Expert access required"));
  }
  next();
}

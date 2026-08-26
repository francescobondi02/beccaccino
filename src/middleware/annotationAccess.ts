import { NextFunction, Request, Response } from "express";
import { prisma } from "../db";

export async function requireAnnotationAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { deletedAt: true, expertAccessGrantedAt: true },
  });
  if (!user || user.deletedAt) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!user.expertAccessGrantedAt) {
    return res.status(403).json({ error: "Expert access required" });
  }
  next();
}

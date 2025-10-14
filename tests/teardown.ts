// tests/teardown.ts
import { prisma } from "../src/db";

export default async function globalTeardown() {
  await prisma.$disconnect();
}

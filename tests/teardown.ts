// tests/teardown.ts
// globalTeardown runs in Jest's parent process, where no setupFiles apply —
// load the test env first or src/db.ts constructs PrismaClient with no URL.
import "./loadTestEnv";
import { prisma } from "../src/db";

export default async function globalTeardown() {
  await prisma.$disconnect();
}

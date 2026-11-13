// Creates the local development accounts alice, bob, carol and dave (password "password").
// Run only by docker-compose.yml; it lives outside src/, so the production image never contains it.
import { prisma } from "../src/db";
import { registerUser } from "../src/services/userAuth";

const host = new URL(process.env.DATABASE_URL ?? "").hostname;
if (process.env.NODE_ENV !== "development" || !["db", "localhost"].includes(host)) {
  throw new Error("Refusing to seed: only for NODE_ENV=development on the local database");
}

async function main(): Promise<void> {
  for (const username of ["alice", "bob", "carol", "dave"]) {
    if (await prisma.user.findUnique({ where: { username } })) continue;
    await registerUser({ username, password: "password", email: null });
    console.log(`Seeded dev user ${username}`);
  }
}

main().finally(() => prisma.$disconnect());

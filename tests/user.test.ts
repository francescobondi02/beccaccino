// tests/user.test.ts
import request from "supertest";
import { prisma } from "../src/db";
import app from "../src/app"; // Assuming your Express app is exported from index.ts

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.gameRoom.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("User API", () => {
  it("Should create a new user", async () => {
    const res = await request(app)
      .post("/api/users")
      .send({ username: "Francesco" });

    expect(res.statusCode).toBe(201);
    expect(res.body.username).toBe("Francesco");

    const dbUser = await prisma.user.findUnique({
      where: { id: res.body.id },
    });

    expect(dbUser).not.toBeNull();
    expect(dbUser!.username).toBe("Francesco");
  });
});

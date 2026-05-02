import request from "supertest";
import { prisma } from "../../src/db";
import app from "../../src/app";
import { clearDatabase } from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

describe("User API", () => {
  it("creates a new user", async () => {
    const res = await request(app)
      .post("/api/users")
      .send({ username: "Francesco" });

    expect(res.statusCode).toBe(201);
    expect(res.body.username).toBe("Francesco");

    const dbUser = await prisma.user.findUnique({ where: { id: res.body.id } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.username).toBe("Francesco");
  });
});

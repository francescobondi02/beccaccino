import request from "supertest";
import { prisma } from "../../src/db";

import { clearDatabase, getServer } from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

describe("User API", () => {
  it("registers a new user", async () => {
    const res = await request(getServer())
      .post("/api/users/register")
      .send({ username: "Francesco", password: "test123" });

    expect(res.statusCode).toBe(201);
    expect(res.body.username).toBe("Francesco");
    expect(res.body.password).toBeUndefined(); // password should not be returned

    const dbUser = await prisma.user.findUnique({ where: { id: res.body.id } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.username).toBe("Francesco");
  });

  it("rejects duplicate username", async () => {
    await request(getServer())
      .post("/api/users/register")
      .send({ username: "Francesco", password: "test123" });

    const res = await request(getServer())
      .post("/api/users/register")
      .send({ username: "Francesco", password: "test456" });

    expect(res.statusCode).toBe(409);
  });

  it("rejects short password", async () => {
    const res = await request(getServer())
      .post("/api/users/register")
      .send({ username: "Francesco", password: "abc" });

    expect(res.statusCode).toBe(400);
  });
});

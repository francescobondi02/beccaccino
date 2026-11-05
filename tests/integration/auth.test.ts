import request from "supertest";

import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import { getServer } from "../helpers/serverHarness";

beforeEach(async () => {
  await clearDatabase();
});

describe("Auth Lifecycle", () => {
  const credentials = { username: "testuser", password: "secure123" };

  describe("Registration", () => {
    it("registers successfully and returns user without password", async () => {
      const res = await request(getServer())
        .post("/api/users/register")
        .send(credentials);

      expect(res.statusCode).toBe(201);
      expect(res.body.username).toBe("testuser");
      expect(res.body.id).toBeDefined();
      expect(res.body.password).toBeUndefined();
    });

    it("sets an httpOnly auth cookie on registration", async () => {
      const res = await request(getServer())
        .post("/api/users/register")
        .send(credentials);

      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain("authToken");
      expect(cookies[0]).toContain("HttpOnly");
    });

    it("rejects registration with missing username", async () => {
      const res = await request(getServer())
        .post("/api/users/register")
        .send({ password: "123456" });

      expect(res.statusCode).toBe(400);
    });

    it("rejects registration with missing password", async () => {
      const res = await request(getServer())
        .post("/api/users/register")
        .send({ username: "user" });

      expect(res.statusCode).toBe(400);
    });

    it("rejects registration with short password (< 6 chars)", async () => {
      const res = await request(getServer())
        .post("/api/users/register")
        .send({ username: "user", password: "abc" });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/6 characters/i);
    });

    it("rejects duplicate username", async () => {
      await request(getServer()).post("/api/users/register").send(credentials);

      const res = await request(getServer())
        .post("/api/users/register")
        .send({ username: "testuser", password: "different" });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/already/i);
    });
  });

  describe("Login", () => {
    beforeEach(async () => {
      await request(getServer()).post("/api/users/register").send(credentials);
    });

    it("logs in successfully with correct credentials", async () => {
      const res = await request(getServer())
        .post("/api/users/login")
        .send(credentials);

      expect(res.statusCode).toBe(200);
      expect(res.body.username).toBe("testuser");
      expect(res.body.password).toBeUndefined();
    });

    it("sets auth cookie on login", async () => {
      const res = await request(getServer())
        .post("/api/users/login")
        .send(credentials);

      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain("authToken");
    });

    it("rejects login with wrong password", async () => {
      const res = await request(getServer())
        .post("/api/users/login")
        .send({ username: "testuser", password: "wrongpass" });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it("rejects login with non-existent username", async () => {
      const res = await request(getServer())
        .post("/api/users/login")
        .send({ username: "ghost", password: "nope123" });

      expect(res.statusCode).toBe(401);
    });

    it("rejects login with missing fields", async () => {
      const res = await request(getServer())
        .post("/api/users/login")
        .send({ username: "testuser" });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/users/me (session check)", () => {
    describe("Native login", () => {
      beforeEach(async () => {
        await request(getServer()).post("/api/users/register").send(credentials);
      });

      it("returns a bearer session without changing the browser cookie contract", async () => {
        const login = await request(getServer())
          .post("/api/users/native/login")
          .send(credentials);

        expect(login.statusCode).toBe(200);
        expect(login.headers["set-cookie"]).toBeUndefined();
        expect(login.headers["cache-control"]).toBe("no-store");
        expect(login.body.user.username).toBe(credentials.username);
        expect(login.body.user.password).toBeUndefined();
        expect(typeof login.body.token).toBe("string");

        const me = await request(getServer())
          .get("/api/users/me")
          .set("Authorization", `Bearer ${login.body.token}`);
        expect(me.statusCode).toBe(200);
        expect(me.body.id).toBe(login.body.user.id);

        const browser = await request(getServer())
          .post("/api/users/login")
          .send(credentials);
        expect(browser.statusCode).toBe(200);
        expect(browser.body.token).toBeUndefined();
        const cookie = browser.headers["set-cookie"][0].split(";")[0];
        const browserMe = await request(getServer())
          .get("/api/users/me")
          .set("Cookie", cookie);
        expect(browserMe.statusCode).toBe(200);
        expect(browserMe.body.id).toBe(login.body.user.id);
      });

      it("rejects incorrect native credentials without issuing a token or cookie", async () => {
        const response = await request(getServer())
          .post("/api/users/native/login")
          .send({ ...credentials, password: "wrongpass" });
        expect(response.statusCode).toBe(401);
        expect(response.body.token).toBeUndefined();
        expect(response.headers["set-cookie"]).toBeUndefined();
      });

      it.each(["Basic invalid", "Bearer", "Bearer invalid.token.value"])(
        "does not let invalid explicit authorization fall through to a cookie or test identity: %s",
        async (authorization) => {
          const browser = await request(getServer()).post("/api/users/login").send(credentials);
          const response = await request(getServer())
            .get("/api/users/me")
            .set("Cookie", browser.headers["set-cookie"][0].split(";")[0])
            .set("Authorization", authorization)
            .set("x-test-user-id", String(browser.body.id));
          expect(response.statusCode).toBe(401);
        },
      );

      it("rejects a native token after the account is deleted", async () => {
        const login = await request(getServer()).post("/api/users/native/login").send(credentials);
        expect(login.statusCode).toBe(200);
        await prisma.user.update({
          where: { id: login.body.user.id },
          data: { deletedAt: new Date(), password: null },
        });
        const response = await request(getServer())
          .get("/api/users/me")
          .set("Authorization", `Bearer ${login.body.token}`);
        expect(response.statusCode).toBe(401);
      });
    });

    it("rejects a valid cookie after its user is deleted", async () => {
      const registerRes = await request(getServer())
        .post("/api/users/register")
        .send(credentials);
      const cookie = registerRes.headers["set-cookie"][0].split(";")[0];

      await prisma.user.update({
        where: { id: registerRes.body.id },
        data: {
          deletedAt: new Date(),
          username: `deleted_${registerRes.body.id}`,
          password: null,
        },
      });

      const res = await request(getServer())
        .get("/api/users/me")
        .set("Cookie", cookie);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Invalid or expired token" });
    });
  });

  describe("Cross-site cookie requests", () => {
    const frontendUrl = process.env.FRONTEND_URL;
    beforeAll(() => {
      process.env.FRONTEND_URL = "https://becca.example";
    });
    afterAll(() => {
      process.env.FRONTEND_URL = frontendUrl;
    });

    const leave = (headers: Record<string, string>) =>
      request(getServer()).post("/api/rooms/NOROOM/leave").set(headers);

    it("rejects cookie mutations from a foreign origin but not same-origin, allowed or bearer ones", async () => {
      const browser = await request(getServer()).post("/api/users/register").send(credentials);
      const Cookie = browser.headers["set-cookie"][0].split(";")[0];
      const native = await request(getServer()).post("/api/users/native/login").send(credentials);
      const evil = "https://evil.example";

      expect((await leave({ Cookie, Origin: evil })).statusCode).toBe(403);
      expect((await leave({ Cookie, Origin: "https://becca.example" })).statusCode).toBe(404);
      expect((await leave({ Cookie })).statusCode).toBe(404);
      expect(
        (await leave({ Cookie, Origin: "https://preview.example", "Sec-Fetch-Site": "same-origin" }))
          .statusCode,
      ).toBe(404);
      expect(
        (await leave({ Origin: evil, Authorization: `Bearer ${native.body.token}` })).statusCode,
      ).toBe(404);
    });
  });

  describe("POST /api/users/logout", () => {
    it("clears the auth cookie even when the session is no longer valid", async () => {
      const res = await request(getServer())
        .post("/api/users/logout")
        .set("Cookie", "authToken=expired.or.deleted");

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/logged out/i);
      expect(res.headers["set-cookie"][0]).toMatch(/^authToken=;.*Expires=Thu, 01 Jan 1970/);
    });
  });
});

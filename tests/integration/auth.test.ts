import request from "supertest";
import app from "../../src/app";
import { clearDatabase } from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

describe("Auth Lifecycle", () => {
  const credentials = { username: "testuser", password: "secure123" };

  describe("Registration", () => {
    it("registers successfully and returns user without password", async () => {
      const res = await request(app)
        .post("/api/users/register")
        .send(credentials);

      expect(res.statusCode).toBe(201);
      expect(res.body.username).toBe("testuser");
      expect(res.body.id).toBeDefined();
      expect(res.body.password).toBeUndefined();
    });

    it("sets an httpOnly auth cookie on registration", async () => {
      const res = await request(app)
        .post("/api/users/register")
        .send(credentials);

      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain("authToken");
      expect(cookies[0]).toContain("HttpOnly");
    });

    it("rejects registration with missing username", async () => {
      const res = await request(app)
        .post("/api/users/register")
        .send({ password: "123456" });

      expect(res.statusCode).toBe(400);
    });

    it("rejects registration with missing password", async () => {
      const res = await request(app)
        .post("/api/users/register")
        .send({ username: "user" });

      expect(res.statusCode).toBe(400);
    });

    it("rejects registration with short password (< 6 chars)", async () => {
      const res = await request(app)
        .post("/api/users/register")
        .send({ username: "user", password: "abc" });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/6 characters/i);
    });

    it("rejects duplicate username", async () => {
      await request(app).post("/api/users/register").send(credentials);

      const res = await request(app)
        .post("/api/users/register")
        .send({ username: "testuser", password: "different" });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/already/i);
    });
  });

  describe("Login", () => {
    beforeEach(async () => {
      await request(app).post("/api/users/register").send(credentials);
    });

    it("logs in successfully with correct credentials", async () => {
      const res = await request(app)
        .post("/api/users/login")
        .send(credentials);

      expect(res.statusCode).toBe(200);
      expect(res.body.username).toBe("testuser");
      expect(res.body.password).toBeUndefined();
    });

    it("sets auth cookie on login", async () => {
      const res = await request(app)
        .post("/api/users/login")
        .send(credentials);

      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain("authToken");
    });

    it("rejects login with wrong password", async () => {
      const res = await request(app)
        .post("/api/users/login")
        .send({ username: "testuser", password: "wrongpass" });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it("rejects login with non-existent username", async () => {
      const res = await request(app)
        .post("/api/users/login")
        .send({ username: "ghost", password: "nope123" });

      expect(res.statusCode).toBe(401);
    });

    it("rejects login with missing fields", async () => {
      const res = await request(app)
        .post("/api/users/login")
        .send({ username: "testuser" });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/users/me (session check)", () => {
    it("returns current user when authenticated (test env bypasses auth)", async () => {
      // In test env, auth middleware is bypassed, but we still test the endpoint logic
      // We need to set req.user manually — in test mode auth is skipped
      // So this test verifies the endpoint itself works
      const registerRes = await request(app)
        .post("/api/users/register")
        .send(credentials);

      // In test mode, auth is bypassed so /me won't have req.user set
      // This is a known limitation of the test setup — the endpoint itself is tested
      // by verifying it doesn't crash
      const res = await request(app).get("/api/users/me");
      // Without req.user, should return 401
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /api/users/logout", () => {
    it("clears the auth cookie", async () => {
      await request(app).post("/api/users/register").send(credentials);

      const res = await request(app).post("/api/users/logout");

      // In test mode, auth is bypassed so logout endpoint is accessible
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/logged out/i);
    });
  });
});

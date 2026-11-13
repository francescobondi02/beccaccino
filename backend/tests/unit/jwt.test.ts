import jwt from "jsonwebtoken";
import { authenticateToken } from "../../src/middleware/auth";
import { generateToken, verifyToken } from "../../src/utils/jwt";

describe("account JWTs", () => {
  it("round-trips a valid account identity", () => {
    const token = generateToken({ userId: 42, username: "expert" });

    expect(verifyToken(token)).toEqual({ userId: 42, username: "expert" });
  });

  it("rejects signed payloads without a valid account identity", () => {
    const secret = process.env.JWT_SECRET!;
    const malformedTokens = [
      jwt.sign({ sessionId: "session" }, secret),
      jwt.sign({ userId: "42", username: "expert" }, secret),
      jwt.sign({ userId: 42, username: "" }, secret),
    ];

    for (const token of malformedTokens) {
      expect(verifyToken(token)).toBeNull();
    }
  });

  it("rejects invalid and expired account tokens", () => {
    const payload = { userId: 42, username: "expert" };
    const invalid = jwt.sign(payload, "incorrect-jwt-test-secret");
    const expired = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: -1,
    });

    expect(verifyToken(invalid)).toBeNull();
    expect(verifyToken(expired)).toBeNull();
  });

  it.each([
    ["invalid", "not-a-jwt"],
    [
      "expired",
      jwt.sign(
        { userId: 42, username: "expert" },
        process.env.JWT_SECRET!,
        { expiresIn: -1 },
      ),
    ],
  ])(
    "returns 401 for an %s real cookie even when test bypass headers exist",
    async (_kind, token) => {
      const req = {
        cookies: { authToken: token },
        headers: {
          "x-test-user-id": "42",
          "x-test-username": "expert",
        },
      } as unknown as Parameters<typeof authenticateToken>[0];
      const response = {
        status: jest.fn(),
        json: jest.fn(),
      };
      response.status.mockReturnValue(response);
      const next = jest.fn();

      await authenticateToken(
        req,
        response as unknown as Parameters<typeof authenticateToken>[1],
        next,
      );

      expect(process.env.ALLOW_TEST_AUTH_BYPASS).toBe("true");
      expect(response.status).not.toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 401,
          message: "Invalid or expired token",
        }),
      );
    },
  );
});

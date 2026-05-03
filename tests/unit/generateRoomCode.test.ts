import { generateRoomCode } from "../../src/utils/generateRoomCode";

describe("generateRoomCode", () => {
  it("generates a code of default length 6", () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(6);
  });

  it("generates a code of custom length", () => {
    expect(generateRoomCode(4)).toHaveLength(4);
    expect(generateRoomCode(10)).toHaveLength(10);
    expect(generateRoomCode(1)).toHaveLength(1);
  });

  it("only contains uppercase letters and digits", () => {
    // Run multiple times to reduce flakiness
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z0-9]+$/);
    }
  });

  it("generates unique codes (no collisions in 1000 runs)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateRoomCode());
    }
    // With 36^6 = ~2.1 billion possibilities, collisions in 1000 are nearly impossible
    expect(codes.size).toBe(1000);
  });
});

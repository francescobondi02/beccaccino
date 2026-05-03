import { generateRoomCode } from "../../src/utils/generateRoomCode";
import { setRng, createSeededRng } from "../../src/utils/random";

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
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z0-9]+$/);
    }
  });

  it("produces the same code sequence given the same seed", () => {
    // Reset to a known seed and generate codes
    const restore = setRng(createSeededRng(123));
    const first = generateRoomCode();
    const second = generateRoomCode();
    restore();

    // Reset to the same seed — should produce identical codes
    const restore2 = setRng(createSeededRng(123));
    expect(generateRoomCode()).toBe(first);
    expect(generateRoomCode()).toBe(second);
    restore2();
  });

  it("generates unique codes with default (seeded) RNG over 1000 runs", () => {
    // With a seeded RNG this is fully deterministic, no luck involved
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateRoomCode());
    }
    expect(codes.size).toBe(1000);
  });
});

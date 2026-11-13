import { sanitizeChatMessage } from "../../src/utils/sanitizeChatMessage";

describe("Chat message sanitization", () => {
  it("returns null for empty string", () => {
    expect(sanitizeChatMessage("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(sanitizeChatMessage("   ")).toBeNull();
    expect(sanitizeChatMessage("\t\n")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(sanitizeChatMessage(null)).toBeNull();
    expect(sanitizeChatMessage(undefined)).toBeNull();
    expect(sanitizeChatMessage(123)).toBeNull();
    expect(sanitizeChatMessage({})).toBeNull();
    expect(sanitizeChatMessage([])).toBeNull();
  });

  it("trims whitespace from both ends", () => {
    expect(sanitizeChatMessage("  hello  ")).toBe("hello");
    expect(sanitizeChatMessage("\nhello\n")).toBe("hello");
  });

  it("truncates messages longer than 200 characters", () => {
    const longMessage = "a".repeat(300);
    const result = sanitizeChatMessage(longMessage);
    expect(result).toHaveLength(200);
  });

  it("preserves messages exactly 200 characters", () => {
    const msg = "b".repeat(200);
    expect(sanitizeChatMessage(msg)).toBe(msg);
  });

  it("strips null bytes", () => {
    expect(sanitizeChatMessage("hello\x00world")).toBe("helloworld");
  });

  it("strips control characters (0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F)", () => {
    // Bell character (0x07)
    expect(sanitizeChatMessage("hello\x07world")).toBe("helloworld");
    // Backspace (0x08)
    expect(sanitizeChatMessage("hello\x08world")).toBe("helloworld");
    // Vertical tab (0x0B)
    expect(sanitizeChatMessage("hello\x0Bworld")).toBe("helloworld");
    // Form feed (0x0C)
    expect(sanitizeChatMessage("hello\x0Cworld")).toBe("helloworld");
    // Escape (0x1B)
    expect(sanitizeChatMessage("hello\x1Bworld")).toBe("helloworld");
    // DEL (0x7F)
    expect(sanitizeChatMessage("hello\x7Fworld")).toBe("helloworld");
  });

  it("preserves newlines (0x0A) and carriage returns (0x0D)", () => {
    // These are NOT stripped — they're normal whitespace
    // But since we trim, standalone \n at start/end will be removed
    expect(sanitizeChatMessage("line1\nline2")).toBe("line1\nline2");
    expect(sanitizeChatMessage("line1\r\nline2")).toBe("line1\r\nline2");
  });

  it("preserves tabs (0x09)", () => {
    // Tab is NOT in the stripped range (0x09 is between 0x08 and 0x0A)
    expect(sanitizeChatMessage("hello\tworld")).toBe("hello\tworld");
  });

  it("preserves unicode characters (emoji, accents, etc.)", () => {
    expect(sanitizeChatMessage("Bravo! 🎉")).toBe("Bravo! 🎉");
    expect(sanitizeChatMessage("Così è la vita")).toBe("Così è la vita");
    expect(sanitizeChatMessage("日本語テスト")).toBe("日本語テスト");
  });

  it("handles combined edge cases", () => {
    // Leading/trailing whitespace + control chars + long
    const input = "  \x00\x07" + "a".repeat(250) + "\x1B  ";
    const result = sanitizeChatMessage(input);
    // After trim: removes leading "  \x00\x07" becomes "\x00\x07" + "a"*250 + "\x1B"
    // After slice(200): first 200 chars
    // After regex: strips control chars
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(200);
    expect(result).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  });
});

/**
 * Unit tests for chat message sanitization logic.
 * Tests the same sanitization rules applied in backend/src/sockets/room.ts
 * for the send_chat_message handler.
 */

// Reproduce the sanitization logic from the socket handler
function sanitizeMessage(input: unknown): string | null {
  if (!input || typeof input !== "string") return null;

  const sanitized = input
    .trim()
    .slice(0, 200)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  return sanitized || null;
}

describe("Chat message sanitization", () => {
  it("returns null for empty string", () => {
    expect(sanitizeMessage("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(sanitizeMessage("   ")).toBeNull();
    expect(sanitizeMessage("\t\n")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(sanitizeMessage(null)).toBeNull();
    expect(sanitizeMessage(undefined)).toBeNull();
    expect(sanitizeMessage(123)).toBeNull();
    expect(sanitizeMessage({})).toBeNull();
    expect(sanitizeMessage([])).toBeNull();
  });

  it("trims whitespace from both ends", () => {
    expect(sanitizeMessage("  hello  ")).toBe("hello");
    expect(sanitizeMessage("\nhello\n")).toBe("hello");
  });

  it("truncates messages longer than 200 characters", () => {
    const longMessage = "a".repeat(300);
    const result = sanitizeMessage(longMessage);
    expect(result).toHaveLength(200);
  });

  it("preserves messages exactly 200 characters", () => {
    const msg = "b".repeat(200);
    expect(sanitizeMessage(msg)).toBe(msg);
  });

  it("strips null bytes", () => {
    expect(sanitizeMessage("hello\x00world")).toBe("helloworld");
  });

  it("strips control characters (0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F)", () => {
    // Bell character (0x07)
    expect(sanitizeMessage("hello\x07world")).toBe("helloworld");
    // Backspace (0x08)
    expect(sanitizeMessage("hello\x08world")).toBe("helloworld");
    // Vertical tab (0x0B)
    expect(sanitizeMessage("hello\x0Bworld")).toBe("helloworld");
    // Form feed (0x0C)
    expect(sanitizeMessage("hello\x0Cworld")).toBe("helloworld");
    // Escape (0x1B)
    expect(sanitizeMessage("hello\x1Bworld")).toBe("helloworld");
    // DEL (0x7F)
    expect(sanitizeMessage("hello\x7Fworld")).toBe("helloworld");
  });

  it("preserves newlines (0x0A) and carriage returns (0x0D)", () => {
    // These are NOT stripped — they're normal whitespace
    // But since we trim, standalone \n at start/end will be removed
    expect(sanitizeMessage("line1\nline2")).toBe("line1\nline2");
    expect(sanitizeMessage("line1\r\nline2")).toBe("line1\r\nline2");
  });

  it("preserves tabs (0x09)", () => {
    // Tab is NOT in the stripped range (0x09 is between 0x08 and 0x0A)
    expect(sanitizeMessage("hello\tworld")).toBe("hello\tworld");
  });

  it("preserves unicode characters (emoji, accents, etc.)", () => {
    expect(sanitizeMessage("Bravo! 🎉")).toBe("Bravo! 🎉");
    expect(sanitizeMessage("Così è la vita")).toBe("Così è la vita");
    expect(sanitizeMessage("日本語テスト")).toBe("日本語テスト");
  });

  it("handles combined edge cases", () => {
    // Leading/trailing whitespace + control chars + long
    const input = "  \x00\x07" + "a".repeat(250) + "\x1B  ";
    const result = sanitizeMessage(input);
    // After trim: removes leading "  \x00\x07" becomes "\x00\x07" + "a"*250 + "\x1B"
    // After slice(200): first 200 chars
    // After regex: strips control chars
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(200);
    expect(result).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  });
});

describe("Chat rate limiting logic", () => {
  it("allows up to CHAT_RATE_MAX messages within the window", () => {
    const CHAT_RATE_MAX = 5;
    const CHAT_RATE_WINDOW_MS = 3000;
    const rateLimit = { count: 0, resetTime: Date.now() };

    // Simulate sending 5 messages — all should pass
    for (let i = 0; i < CHAT_RATE_MAX; i++) {
      const now = Date.now();
      if (now - rateLimit.resetTime > CHAT_RATE_WINDOW_MS) {
        rateLimit.count = 0;
        rateLimit.resetTime = now;
      }
      rateLimit.count++;
      expect(rateLimit.count).toBeLessThanOrEqual(CHAT_RATE_MAX);
    }
  });

  it("blocks the 6th message within the window", () => {
    const CHAT_RATE_MAX = 5;
    const CHAT_RATE_WINDOW_MS = 3000;
    const rateLimit = { count: 0, resetTime: Date.now() };

    // Send 6 messages rapidly
    let blocked = false;
    for (let i = 0; i < 6; i++) {
      const now = Date.now();
      if (now - rateLimit.resetTime > CHAT_RATE_WINDOW_MS) {
        rateLimit.count = 0;
        rateLimit.resetTime = now;
      }
      rateLimit.count++;
      if (rateLimit.count > CHAT_RATE_MAX) {
        blocked = true;
        break;
      }
    }

    expect(blocked).toBe(true);
    expect(rateLimit.count).toBe(6);
  });

  it("resets counter after the time window expires", () => {
    const CHAT_RATE_MAX = 5;
    const CHAT_RATE_WINDOW_MS = 3000;
    const rateLimit = { count: 5, resetTime: Date.now() - 4000 }; // Window expired

    // Simulate a new message after window expired
    const now = Date.now();
    if (now - rateLimit.resetTime > CHAT_RATE_WINDOW_MS) {
      rateLimit.count = 0;
      rateLimit.resetTime = now;
    }
    rateLimit.count++;

    expect(rateLimit.count).toBe(1); // Reset happened
  });
});

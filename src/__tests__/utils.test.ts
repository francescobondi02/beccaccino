import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn (className merger)", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes via clsx", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("resolves tailwind conflicts (last wins)", () => {
    const result = cn("p-4", "p-2");
    expect(result).toBe("p-2");
  });

  it("handles undefined and null gracefully", () => {
    expect(cn("base", undefined, null, "end")).toBe("base end");
  });

  it("returns empty string for no arguments", () => {
    expect(cn()).toBe("");
  });
});

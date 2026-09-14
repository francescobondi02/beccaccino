import { ClientError } from "../../src/http/errors";
import {
  parseJoinRoom,
  parsePracticeTier,
  parseReady,
  parseTeam,
} from "../../src/http/input/rooms";
import {
  parseLoginInput,
  parseRegistrationInput,
  parseUsernameUpdate,
} from "../../src/http/input/users";

function expectBadRequest(operation: () => unknown) {
  try {
    operation();
    throw new Error("Expected parser to reject input");
  } catch (error) {
    expect(error).toBeInstanceOf(ClientError);
    expect(error).toMatchObject({ status: 400 });
  }
}

describe("HTTP input parsers", () => {
  it.each([
    [() => parseRegistrationInput({ username: "ab", password: "123456" })],
    [() => parseRegistrationInput({ username: "valid", password: "123" })],
    [() => parseLoginInput({ username: "valid" })],
    [() => parseUsernameUpdate({ username: 42 })],
    [() => parseJoinRoom({ roomCode: "" })],
    [() => parsePracticeTier({ tier: "impossible" })],
    [() => parseReady({ isReady: "yes" })],
    [() => parseTeam({ team: 2 })],
  ])("rejects invalid endpoint input", (operation) => {
    expectBadRequest(operation);
  });

  it("normalizes valid user and room inputs", () => {
    expect(
      parseRegistrationInput({
        username: "  Francesco  ",
        password: "secret",
        email: "f@example.com",
      }),
    ).toEqual({
      username: "Francesco",
      password: "secret",
      email: "f@example.com",
    });
    expect(parsePracticeTier({ tier: "esperto" })).toBe("esperto");
    expect(parseJoinRoom({ roomCode: "ABC123" })).toBe("ABC123");
    expect(parseReady({ isReady: false })).toBe(false);
    expect(parseTeam({ team: 1 })).toBe(1);
  });
});

import { errorHandler } from "../../src/http/errorHandler";
import { ClientError } from "../../src/http/errors";

function responseDouble() {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe("HTTP error mapping", () => {
  it("maps typed client errors and their structured details", () => {
    const response = responseDouble();
    errorHandler(
      new ClientError(409, "Already active", { activeRoomCode: "ABC123" }),
      { log: { warn: jest.fn(), error: jest.fn() } } as never,
      response as never,
      jest.fn(),
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      error: "Already active",
      activeRoomCode: "ABC123",
    });
  });

  it("sanitizes unexpected errors", () => {
    const response = responseDouble();
    const error = new Error("postgresql://secret@production.example");
    const requestLog = { warn: jest.fn(), error: jest.fn() };
    errorHandler(
      error,
      { log: requestLog } as never,
      response as never,
      jest.fn(),
    );

    expect(requestLog.error).toHaveBeenCalledWith(
      { err: error },
      "unhandled_error",
    );
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: "Internal server error",
    });
  });
});

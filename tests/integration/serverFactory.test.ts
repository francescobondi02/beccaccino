import { AddressInfo } from "net";
import { io as createClient, Socket as ClientSocket } from "socket.io-client";
import { createServer, CreatedServer } from "../../src/server";
import { generateToken } from "../../src/utils/jwt";

let runtime: CreatedServer | null;
let clients: ClientSocket[];

beforeEach(() => {
  runtime = null;
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.disconnect();
  if (runtime) await runtime.close();
});

async function startServer(maxSocketsPerIp = 1): Promise<string> {
  runtime = createServer({
    allowTestAuthBypass: false,
    corsOrigin: "*",
    maxSocketsPerIp,
  });
  await new Promise<void>((resolve) => runtime!.httpServer.listen(0, resolve));
  const address = runtime.httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function clientFor(url: string, authenticated: boolean): ClientSocket {
  const token = generateToken({ userId: 1, username: "socket-user" });
  const client = createClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: authenticated
      ? { Cookie: `authToken=${token}` }
      : undefined,
  });
  clients.push(client);
  return client;
}

function waitForConnect(client: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("connect_error", reject);
  });
}

function waitForConnectError(client: ClientSocket): Promise<Error> {
  return new Promise((resolve) => client.once("connect_error", resolve));
}

describe("Production server factory", () => {
  it("does not consume an IP slot when authentication is rejected", async () => {
    const url = await startServer();
    const rejected = clientFor(url, false);
    await expect(waitForConnectError(rejected)).resolves.toMatchObject({
      message: "Authentication required",
    });
    rejected.disconnect();

    const accepted = clientFor(url, true);
    await expect(waitForConnect(accepted)).resolves.toBeUndefined();
  });

  it("releases an IP slot after disconnect", async () => {
    const url = await startServer();
    const first = clientFor(url, true);
    await waitForConnect(first);

    const rejected = clientFor(url, true);
    await expect(waitForConnectError(rejected)).resolves.toMatchObject({
      message: "Too many connections from this IP",
    });

    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const replacement = clientFor(url, true);
    await expect(waitForConnect(replacement)).resolves.toBeUndefined();
  });

  it("closes sockets and the HTTP listener", async () => {
    const url = await startServer();
    const client = clientFor(url, true);
    await waitForConnect(client);
    const disconnected = new Promise<void>((resolve) => {
      client.once("disconnect", () => resolve());
    });

    await Promise.all([runtime!.close(), runtime!.close()]);
    await runtime!.close();
    await disconnected;

    expect(client.connected).toBe(false);
    expect(runtime!.httpServer.listening).toBe(false);
    runtime = null;
  });
});

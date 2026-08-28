import { AddressInfo } from "net";
import { io as createClient, Socket as ClientSocket } from "socket.io-client";
import { prisma } from "../../src/db";
import { createServer, CreatedServer } from "../../src/server";
import { generateToken } from "../../src/utils/jwt";
import { clearDatabase } from "../helpers/database";

let runtime: CreatedServer | null;
let clients: ClientSocket[];

beforeEach(async () => {
  await clearDatabase();
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

function clientFor(url: string, token?: string): ClientSocket {
  const client = createClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: token
      ? { Cookie: `authToken=${token}` }
      : undefined,
  });
  clients.push(client);
  return client;
}

async function createSocketUser() {
  const user = await prisma.user.create({
    data: {
      username: `socket-user-${Date.now()}-${Math.random()}`,
      password: "unused",
    },
  });
  return {
    user,
    token: generateToken({ userId: user.id, username: user.username }),
  };
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
    const rejected = clientFor(url);
    await expect(waitForConnectError(rejected)).resolves.toMatchObject({
      message: "Authentication required",
    });
    rejected.disconnect();

    const { token } = await createSocketUser();
    const accepted = clientFor(url, token);
    await expect(waitForConnect(accepted)).resolves.toBeUndefined();
  });

  it("releases an IP slot after disconnect", async () => {
    const url = await startServer();
    const { token } = await createSocketUser();
    const first = clientFor(url, token);
    await waitForConnect(first);

    const rejected = clientFor(url, token);
    await expect(waitForConnectError(rejected)).resolves.toMatchObject({
      message: "Too many connections from this IP",
    });

    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const replacement = clientFor(url, token);
    await expect(waitForConnect(replacement)).resolves.toBeUndefined();
  });

  it("closes sockets and the HTTP listener", async () => {
    const url = await startServer();
    const { token } = await createSocketUser();
    const client = clientFor(url, token);
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

  it("rejects a valid cookie after its user is deleted", async () => {
    const url = await startServer();
    const { user, token } = await createSocketUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date(), password: null },
    });

    const client = clientFor(url, token);
    await expect(waitForConnectError(client)).resolves.toMatchObject({
      message: "Invalid or expired token",
    });
  });
});

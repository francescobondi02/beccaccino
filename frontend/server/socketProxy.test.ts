import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createSocketProxy } from "./socketProxy";

const servers: Server[] = [];
const clients: WebSocket[] = [];
const origin = "https://beccaccino-client.vercel.app";

async function listen(server: Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server port");
  return `http://127.0.0.1:${address.port}`;
}

function connect(
  url: string,
  cookie = "platformSession=private-platform-session; authToken=test-session",
  clientOrigin = origin,
  host = new URL(origin).host,
) {
  const client = new WebSocket(url.replace("http:", "ws:"), {
    origin: clientOrigin,
    headers: { cookie, host },
    handshakeTimeout: 2000,
  });
  clients.push(client);
  return client;
}

afterEach(async () => {
  clients.splice(0).forEach((client) => client.terminate());
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  vi.restoreAllMocks();
});

describe("same-origin WebSocket proxy", () => {
  it("preserves the cookie, Engine.IO query and text/binary messages across reconnects", async () => {
    const backend = createServer();
    const websocketServer = new WebSocketServer({ server: backend });
    const requests: { url: string | undefined; cookie: string | undefined }[] = [];
    websocketServer.on("connection", (socket, request) => {
      requests.push({ url: request.url, cookie: request.headers.cookie });
      socket.on("message", (data, isBinary) => {
        socket.send(data.toString() === "large" ? Buffer.alloc(16_384, 120) : data, {
          binary: isBinary,
        });
      });
    });
    const target = await listen(backend);
    const proxyUrl = await listen(createSocketProxy(target));

    for (let attempt = 0; attempt < 2; attempt++) {
      const frontendOrigin =
        attempt === 0 ? origin : "https://beccaccino-client-preview.vercel.app";
      const client = connect(
        `${proxyUrl}/api/socket-proxy?EIO=4&transport=websocket&sid=existing-session`,
        undefined,
        frontendOrigin,
        new URL(frontendOrigin).host,
      );
      await once(client, "open");
      const text = once(client, "message");
      client.send('42["join_room",{"roomCode":"ABCD"}]');
      expect(await text).toEqual([
        Buffer.from('42["join_room",{"roomCode":"ABCD"}]'),
        false,
      ]);
      const binary = once(client, "message");
      client.send(Buffer.from([0, 1, 255]));
      expect(await binary).toEqual([Buffer.from([0, 1, 255]), true]);
      const large = once(client, "message");
      client.send("large");
      expect(await large).toEqual([Buffer.alloc(16_384, 120), false]);
      client.close();
      await once(client, "close");
      await vi.waitFor(() => expect(websocketServer.clients.size).toBe(0));
    }

    expect(requests).toEqual(
      Array(2).fill({
        url: "/socket.io/?EIO=4&transport=websocket&sid=existing-session",
        cookie: "authToken=test-session",
      }),
    );
    websocketServer.close();
  });

  it("leaves authentication enforcement to the backend", async () => {
    const backend = createServer();
    const websocketServer = new WebSocketServer({ server: backend });
    websocketServer.on("connection", (socket, request) => {
      socket.send(
        request.headers.cookie === "authToken=test-session"
          ? "authenticated"
          : "Authentication required",
      );
    });
    const proxyUrl = await listen(createSocketProxy(await listen(backend)));
    const client = connect(`${proxyUrl}/socket.io/?EIO=4&transport=websocket`, "");
    const message = once(client, "message");
    await once(client, "open");
    expect((await message)[0].toString()).toBe("Authentication required");
    client.close();
    await once(client, "close");
    await vi.waitFor(() => expect(websocketServer.clients.size).toBe(0));
    websocketServer.close();
  });

  it("rejects cross-origin cookie connections before contacting the backend", async () => {
    const backend = createServer();
    const contacted = vi.fn();
    backend.on("upgrade", contacted);
    const proxyUrl = await listen(createSocketProxy(await listen(backend)));
    const client = connect(
      `${proxyUrl}/socket.io/?EIO=4&transport=websocket`,
      undefined,
      "https://other.example",
    );
    await expect(once(client, "open")).rejects.toThrow(
      "Unexpected server response: 403",
    );
    expect(contacted).not.toHaveBeenCalled();
  });

  it("reports an upstream handshake failure without exposing credentials", async () => {
    const backend = createServer((_request, response) => {
      response.writeHead(503).end("unavailable");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const proxyUrl = await listen(createSocketProxy(await listen(backend)));
    const client = connect(`${proxyUrl}/socket.io/?EIO=4&transport=websocket`);
    await expect(once(client, "open")).rejects.toThrow(
      "Unexpected server response: 502",
    );
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("test-session");
  });

  it("cancels a pending upstream connection when the browser disconnects", async () => {
    const backend = createServer();
    const received = once(backend, "upgrade");
    const proxyUrl = await listen(createSocketProxy(await listen(backend)));
    const client = connect(`${proxyUrl}/socket.io/?EIO=4&transport=websocket`);
    const opened = once(client, "open");
    const [, upstreamSocket] = await received;
    const upstreamClosed = once(upstreamSocket, "end");
    upstreamSocket.once("end", () => upstreamSocket.destroy());
    upstreamSocket.resume();
    client.terminate();
    await expect(opened).rejects.toThrow(
      "WebSocket was closed before the connection was established",
    );
    await upstreamClosed;
  });
});

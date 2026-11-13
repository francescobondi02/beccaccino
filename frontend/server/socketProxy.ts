import { createServer } from "node:http";
import WebSocket, { createWebSocketStream, WebSocketServer } from "ws";

export function createSocketProxy(target: string) {
  const server = createServer((_request, response) => {
    response.writeHead(426, { Upgrade: "websocket" }).end("WebSocket required");
  });
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 10_240,
    perMessageDeflate: false,
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "https://proxy.invalid");
    if (!["/socket.io/", "/api/socket-proxy"].includes(url.pathname)) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    if (
      !request.headers.host ||
      request.headers.origin !== `https://${request.headers.host}`
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }

    const upstreamUrl = new URL(`/socket.io/${url.search}`, target);
    upstreamUrl.protocol = upstreamUrl.protocol === "https:" ? "wss:" : "ws:";
    const authCookie = request.headers.cookie
      ?.split(";")
      .find((cookie) => cookie.trim().startsWith("authToken="))
      ?.trim();
    const upstream = new WebSocket(upstreamUrl, {
      headers: {
        origin: request.headers.origin,
        ...(authCookie && { cookie: authCookie }),
        ...(request.headers["x-forwarded-for"] && {
          "x-forwarded-for": request.headers["x-forwarded-for"],
        }),
      },
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
    });

    const handshakeFailed = (error: Error) => {
      if (socket.destroyed) return;
      console.error("socket_proxy_handshake_failed", error.message);
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    };
    upstream.once("error", handshakeFailed);
    socket.once("close", () => upstream.terminate());
    socket.once("end", () => socket.destroy());
    socket.once("error", (error) => {
      console.error("socket_proxy_client_failed", error.message);
      upstream.terminate();
    });
    upstream.once("open", () => {
      sockets.handleUpgrade(request, socket, head, (downstream) => {
        const options = { readableObjectMode: true, decodeStrings: false };
        const incoming = createWebSocketStream(downstream, options);
        const outgoing = createWebSocketStream(upstream, options);
        upstream.off("error", handshakeFailed);

        const close = (error?: Error) => {
          if (error) console.error("socket_proxy_stream_failed", error.message);
          incoming.destroy();
          outgoing.destroy();
        };
        incoming.on("error", close).once("close", close);
        outgoing.on("error", close).once("close", close);
        incoming.pipe(outgoing).pipe(incoming);
      });
    });
    socket.resume();
  });

  server.once("close", () => sockets.close());
  return server;
}

# Server (Socket Proxy)

## Overview
Node-side WebSocket proxy used by the Vercel function in `../api/`. It accepts a
same-origin browser WebSocket upgrade, opens a matching upstream WebSocket to
the backend's `/socket.io/`, and pipes frames in both directions.

## Interface
- `createSocketProxy(target: string)` — returns a `node:http` `Server`; plain HTTP requests get `426 WebSocket required`, upgrade requests are proxied [socketProxy.ts:createSocketProxy]

## Invariants
- Only upgrade paths `/socket.io/` and `/api/socket-proxy` are accepted; others get `404` [socketProxy.ts:createSocketProxy]
- The `Origin` header must equal `https://<Host>`; otherwise the upgrade is rejected with `403` [socketProxy.ts:createSocketProxy]
- Upstream URL is `/socket.io/` plus the original query string on `target`, with `https:` mapped to `wss:` (else `ws:`) [socketProxy.ts:createSocketProxy]
- Only the `authToken=` cookie, the `Origin` header and `x-forwarded-for` (when present) are forwarded upstream [socketProxy.ts:createSocketProxy]
- Downstream frames are limited to 10,240 bytes (`maxPayload`); per-message deflate is disabled on both sides; upstream handshake timeout is 10 s [socketProxy.ts:createSocketProxy]
- If the upstream handshake fails, the client receives `502 Bad Gateway`; closing or erroring either stream destroys both [socketProxy.ts:createSocketProxy]

## Side Effects
- Outbound WebSocket connections to `target` [socketProxy.ts:createSocketProxy]
- `console.error` logs: `socket_proxy_handshake_failed`, `socket_proxy_client_failed`, `socket_proxy_stream_failed` [socketProxy.ts:createSocketProxy]
- Closing the HTTP server closes the internal `WebSocketServer` [socketProxy.ts:createSocketProxy]

## Verification
- Run: `cd frontend && npx vitest run server/socketProxy.test.ts`
- Run: `cd frontend && npm run typecheck && npm run lint`

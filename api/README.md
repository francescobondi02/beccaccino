# API (Vercel Functions)

## Overview
Vercel serverless function entry points. The only function is the WebSocket
proxy that forwards Socket.IO WebSocket traffic to the Render backend so the
browser stays same-origin with the auth cookie.

## Interface
- `api/socket-proxy.ts` — default export `createSocketProxy("https://beccaccino-server.onrender.com")`, an HTTP server from [../server/README.md](../server/README.md) [socket-proxy.ts:default]
- Routing (from `frontend/vercel.json`): requests to `/socket.io/` with query `transport=websocket` are rewritten to `/api/socket-proxy`; the function's `maxDuration` is 300 s. `vercel.json` also enables Fluid compute (`"fluid": true`) and pins functions to `"regions": ["fra1"]`.

## Invariants
- The upstream target is hard-coded to `https://beccaccino-server.onrender.com` [socket-proxy.ts:default]
- All request validation, header forwarding and streaming rules are implemented in `../server/socketProxy.ts` (see its README).

## Side Effects
- Opens upstream WebSocket connections to the Render backend for every accepted client upgrade (via `createSocketProxy`) [socket-proxy.ts:default]

## Verification
- Run: `cd frontend && npx vitest run server/socketProxy.test.ts`
- Run: `cd frontend && npm run typecheck && npm run lint`

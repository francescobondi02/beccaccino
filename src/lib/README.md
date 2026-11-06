# Library

## Overview
Framework-agnostic helpers: the shared REST client, active-room conflict
redirect, phone fullscreen/orientation control, and Tailwind class merging.

## Interface
- `ApiError` — `Error` with `status: number` and optional parsed `body` (`error?`, `activeRoomCode?`, …) [api.ts:ApiError]
- `apiGet<T>(path, signal?)`, `apiPost<T>(path, body?)`, `apiPatch<T>(path, body?)`, `apiDelete<T>(path)` [api.ts:apiGet], [api.ts:apiPost], [api.ts:apiPatch], [api.ts:apiDelete]
- `handleActiveRoomConflict(err, navigate): boolean` [roomRedirect.ts:handleActiveRoomConflict]
- `canEnterGameFullscreen(): boolean`, `enterGameFullscreen(): Promise<void>`, `exitGameFullscreen(): void` [fullscreen.ts:canEnterGameFullscreen], [fullscreen.ts:enterGameFullscreen], [fullscreen.ts:exitGameFullscreen]
- `cn(...inputs)` — `twMerge(clsx(inputs))` [utils.ts:cn]

## Invariants
- The API base URL is `/api` in development; in production it is `VITE_API_URL`, falling back to `/api` [api.ts:API_URL]
- Every request sends `credentials: "include"`; a JSON `Content-Type` and body are sent only when `body !== undefined` [api.ts:request]
- Any non-2xx response throws `ApiError`, with message `body.error` or `"Request failed (<status>)"`; empty or non-JSON bodies parse to `undefined` [api.ts:request], [api.ts:parseBody]
- Only `apiGet` accepts an `AbortSignal` [api.ts:apiGet]
- `handleActiveRoomConflict` acts only on `ApiError` status `409` with `body.activeRoomCode` [roomRedirect.ts:handleActiveRoomConflict]
- Fullscreen is offered only on phones: `(pointer: coarse)`, shortest screen side `< 600`, and `document.fullscreenEnabled` [fullscreen.ts:isPhone], [fullscreen.ts:canEnterGameFullscreen]
- `enterGameFullscreen` and `exitGameFullscreen` swallow unsupported or denied fullscreen/orientation errors [fullscreen.ts:enterGameFullscreen], [fullscreen.ts:exitGameFullscreen]

## Side Effects
- Network `fetch` to `${API_URL}${path}` [api.ts:request]
- `sonner` error toast and navigation to `/game/<activeRoomCode>` [roomRedirect.ts:handleActiveRoomConflict]
- `document.documentElement.requestFullscreen({ navigationUI: "hide" })` and `screen.orientation.lock("landscape")`; exit unlocks orientation and calls `document.exitFullscreen()` [fullscreen.ts:enterGameFullscreen], [fullscreen.ts:exitGameFullscreen]

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/fullscreen.test.ts src/__tests__/utils.test.ts`
- Run: `cd frontend && npm run typecheck && npm run lint`

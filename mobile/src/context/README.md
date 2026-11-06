# Session context (`src/context`)

## Overview
React context that owns the native account session lifecycle: restore on
start, login, logout, retry, and a silent revalidation when the app returns to
the foreground. Storage and network work is delegated to `@/lib/session`.

## Interface
- `SessionProvider` `[SessionContext.tsx:SessionProvider]`: provides `{ state, login, logout, retry }`.
- `useSession()` `[SessionContext.tsx:useSession]`: returns the context value; throws `useSession requires SessionProvider.` outside the provider.
- `state` has the internal (not exported) type `SessionState` `[SessionContext.tsx:SessionState]`: `{ status: 'loading' }`, `{ status: 'signedOut'; message? }`, `{ status: 'signedIn'; user; message? }`, `{ status: 'error'; message }`.
- `login(username, password)`, `logout()` return `Promise<boolean>`; `retry()` restarts restoration `[SessionContext.tsx:SessionProvider]`. Only `SessionProvider` and `useSession` are exported.

## Invariants
- Only one session operation runs at a time (`pending`); a second call resolves `false`, except that `logout` while signed in aborts a pending silent revalidation `[SessionContext.tsx:SessionProvider]` (`perform`, `logout`).
- A result is applied only if its `AbortController` is still the pending one `[SessionContext.tsx:SessionProvider]` (`perform`).
- `login` sets `loading` before the request starts; a failed login becomes `signedOut` with the error message. `retry()` does nothing while an operation is pending `[SessionContext.tsx:SessionProvider]` (`login`, `retry`).
- A restore failure with HTTP 401 becomes `signedOut` with an expiry message; other failures become `error` `[SessionContext.tsx:restoreFailure]`.
- The foreground revalidation changes state only on HTTP 401; network or server errors keep the user signed in `[SessionContext.tsx:SessionProvider]`.
- A failed logout keeps a signed-in user signed in and shows the error message `[SessionContext.tsx:SessionProvider]` (`logout`).
- The backend origin comes from `process.env.EXPO_PUBLIC_BACKEND_URL` `[SessionContext.tsx:SessionProvider]`.

## Side Effects
- Network requests and secure-storage reads/writes/deletes through `restoreSession`, `signIn` and `clearSession` `[SessionContext.tsx:SessionProvider]`.
- Subscribes to `AppState` changes while signed in `[SessionContext.tsx:SessionProvider]`.
- Aborts the pending operation on provider unmount `[SessionContext.tsx:SessionProvider]`.

## Verification
- Run: `cd mobile && npx jest src/__tests__/account.test.tsx`

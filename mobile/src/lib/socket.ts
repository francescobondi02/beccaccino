import { io } from 'socket.io-client';
import { readSessionCredentials, SessionHttpError } from '@/lib/session';

export const authFailures = ['Authentication required', 'Invalid or expired token'];

// One native Socket.IO client per screen, authenticated with the stored token (never the browser cookie).
export async function openSocket() {
  const credentials = await readSessionCredentials(process.env.EXPO_PUBLIC_BACKEND_URL);
  if (!credentials) throw new SessionHttpError(401);
  return io(credentials.origin, {
    auth: { token: credentials.token }, autoConnect: false,
    transports: ['websocket', 'polling'], tryAllTransports: true,
    timeout: 8_000, reconnectionDelay: 1000, reconnectionDelayMax: 5000,
  });
}

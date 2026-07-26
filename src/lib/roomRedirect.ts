import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";

// The backend rejects create/join with 409 + { activeRoomCode } when the user
// is already in a live game. Redirect them there instead of surfacing an error.
// Returns true when the conflict was handled, so callers can stop processing.
export function handleActiveRoomConflict(
  err: unknown,
  navigate: NavigateFunction,
): boolean {
  if (err instanceof ApiError && err.status === 409 && err.body?.activeRoomCode) {
    toast.error("Sei già in una partita attiva");
    navigate(`/game/${err.body.activeRoomCode}`);
    return true;
  }
  return false;
}

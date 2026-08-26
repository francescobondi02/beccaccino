import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { v2Path } from "@/v2/lib/paths";

// Same contract as the V1 helper (409 + { activeRoomCode }), but the redirect
// stays inside /v2.
export function handleActiveRoomConflictV2(
  err: unknown,
  navigate: NavigateFunction,
): boolean {
  if (
    err instanceof ApiError &&
    err.status === 409 &&
    err.body?.activeRoomCode
  ) {
    toast.error("Sei già in una partita attiva");
    navigate(v2Path.game(err.body.activeRoomCode));
    return true;
  }
  return false;
}

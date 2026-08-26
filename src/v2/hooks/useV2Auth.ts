import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { v2Path } from "@/v2/lib/paths";

interface Options {
  /** Send anonymous visitors back to the V2 lobby instead of the V1 home. */
  requireAuth?: boolean;
}

/**
 * V2 adapter over the shared useAuth hook. The V1 hook hardcodes navigation to
 * "/" on failure and on logout, so V2 disables that and routes to /v2 itself.
 */
export function useV2Auth({ requireAuth = false }: Options = {}) {
  const navigate = useNavigate();
  const auth = useAuth({ redirectOnFail: false });
  const { user, loading, error, clearUser } = auth;

  useEffect(() => {
    if (!requireAuth || loading || error) return;
    if (!user) navigate(v2Path.lobby(), { replace: true });
  }, [error, loading, navigate, requireAuth, user]);

  const logout = useCallback(async () => {
    try {
      await apiPost("/users/logout");
    } catch (err) {
      if (
        !(err instanceof ApiError) ||
        (err.status !== 401 && err.status !== 403)
      ) {
        throw err;
      }
    }
    await clearUser();
    navigate(v2Path.lobby(), { replace: true });
  }, [clearUser, navigate]);

  return { ...auth, logout };
}

import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { disconnectSocket } from "@/sockets/socketClient";

export interface AuthUser {
  id: number;
  username: string;
  email?: string;
}

interface UseAuthOptions {
  /** Redirect signed-out users home, or to the given path if they were never signed in here. */
  redirectOnFail?: boolean | string;
}

export const AUTH_QUERY_KEY = ["auth", "current-user"] as const;
const AUTH_STALE_TIME_MS = 5 * 60 * 1000;
// The singleton socket keeps the handshake identity it connected with.
let socketUserId: number | null | undefined;

async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return await apiGet<AuthUser>("/users/me");
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return null;
    }
    throw error;
  }
}

export function useAuth({ redirectOnFail = false }: UseAuthOptions = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: AUTH_STALE_TIME_MS,
  });

  const currentUserId = query.isSuccess ? query.data?.id ?? null : undefined;
  useEffect(() => {
    if (currentUserId === undefined) return;
    if (socketUserId !== undefined && socketUserId !== currentUserId) {
      disconnectSocket();
    }
    socketUserId = currentUserId;
  }, [currentUserId]);

  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (!query.isSuccess) return;
    if (query.data) {
      wasSignedIn.current = true;
      return;
    }

    if (redirectOnFail) {
      navigate(redirectOnFail === true || wasSignedIn.current ? "/" : redirectOnFail, { replace: true });
    }
  }, [navigate, query.data, query.isSuccess, redirectOnFail]);

  const setUser = useCallback(
    (user: AuthUser) => {
      queryClient.setQueryData<AuthUser | null>(AUTH_QUERY_KEY, user);
    },
    [queryClient],
  );

  const clearUser = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: AUTH_QUERY_KEY });
    queryClient.setQueryData<AuthUser | null>(AUTH_QUERY_KEY, null);
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await apiPost("/users/logout");
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        (error.status !== 401 && error.status !== 403)
      ) {
        throw error;
      }
    }

    await clearUser();
    navigate("/", { replace: true });
  }, [clearUser, navigate]);

  const retry = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    user: query.data ?? null,
    loading: query.isPending,
    error: query.error,
    retry,
    setUser,
    clearUser,
    logout,
  };
}
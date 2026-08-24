import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { setSentryUser, clearSentryUser } from "@/lib/sentryUser";

export interface AuthUser {
  id: number;
  username: string;
  email?: string;
}

interface UseAuthOptions {
  redirectOnFail?: boolean;
}

export const AUTH_QUERY_KEY = ["auth", "current-user"] as const;
const AUTH_STALE_TIME_MS = 5 * 60 * 1000;

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

  useEffect(() => {
    if (!query.isSuccess) return;

    if (query.data) {
      setSentryUser({
        id: query.data.id,
        username: query.data.username,
      });
      return;
    }

    clearSentryUser();
    if (redirectOnFail) {
      navigate("/", { replace: true });
    }
  }, [navigate, query.data, query.isSuccess, redirectOnFail]);

  const setUser = useCallback(
    (user: AuthUser) => {
      queryClient.setQueryData<AuthUser | null>(AUTH_QUERY_KEY, user);
      setSentryUser({ id: user.id, username: user.username });
    },
    [queryClient],
  );

  const clearUser = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: AUTH_QUERY_KEY });
    queryClient.setQueryData<AuthUser | null>(AUTH_QUERY_KEY, null);
    clearSentryUser();
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

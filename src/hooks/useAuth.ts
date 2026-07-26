import { useEffect, useState } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { setSentryUser, clearSentryUser } from "@/lib/sentryUser";

export interface AuthUser {
  id: number;
  username: string;
  email?: string;
}

interface UseAuthOptions {
  // Redirect to "/" when the /users/me check fails for any reason (protected pages).
  redirectOnFail?: boolean;
}

// Fetches the current user once on mount. Sets the Sentry user on success and,
// when `redirectOnFail` is set, sends unauthenticated visitors home.
export function useAuth({ redirectOnFail = false }: UseAuthOptions = {}) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    apiGet<AuthUser>("/users/me")
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setSentryUser({ id: me.id, username: me.username });
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        // Any failure (401, 404, 5xx, or a network error while the backend is
        // down/cold-starting) leaves a protected page unusable — send the
        // visitor home rather than stranding them on the loading spinner.
        if (redirectOnFail) {
          navigate("/");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [redirectOnFail, navigate]);

  return { user, loading };
}

export async function logout(navigate: NavigateFunction) {
  await apiPost("/users/logout");
  clearSentryUser();
  navigate("/");
}

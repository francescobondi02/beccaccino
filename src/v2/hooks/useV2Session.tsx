import { createContext, useContext } from "react";
import type { AuthUser } from "@/hooks/useAuth";

export interface V2SessionValue {
  user: AuthUser | null;
  loading: boolean;
  error: unknown;
  retry: () => void;
  logout: () => Promise<void>;
  /** Opens the shared auth dialog. */
  openAuth: () => void;
  /**
   * Returns true when the visitor is authenticated; otherwise opens the auth
   * dialog so gated actions never fail silently.
   */
  requireAuth: () => boolean;
}

const V2SessionContext = createContext<V2SessionValue | null>(null);

export const V2SessionProvider = V2SessionContext.Provider;

export function useV2Session(): V2SessionValue {
  const value = useContext(V2SessionContext);
  if (!value) {
    throw new Error("useV2Session must be used inside V2App");
  }
  return value;
}

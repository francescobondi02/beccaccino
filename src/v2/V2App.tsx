import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { Loader2 } from "lucide-react";
import AuthDialog from "@/components/AuthDialog";
import AuthErrorState from "@/components/AuthErrorState";
import V2Shell from "@/v2/components/shell/V2Shell";
import V2LiveRegion from "@/v2/components/shell/V2LiveRegion";
import AmbientCards from "@/v2/components/cards/AmbientCards";
import V2Placeholder from "@/v2/pages/V2Placeholder";
import V2NotFound from "@/v2/pages/V2NotFound";
import { useV2Auth } from "@/v2/hooks/useV2Auth";
import { V2SessionProvider } from "@/v2/hooks/useV2Session";
import "@/v2/styles/v2.css";

const V2Lobby = lazy(() => import("@/v2/pages/V2Lobby"));

const Fallback = () => (
  <div
    className="flex min-h-[50vh] items-center justify-center"
    role="status"
    aria-label="Caricamento"
  >
    <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--becca-brass))]" />
  </div>
);

/** Root of the V2 interface. Mounted lazily on /v2/*. */
const V2App = () => {
  const { user, loading, error, retry, logout } = useV2Auth();
  const [authOpen, setAuthOpen] = useState(false);

  const openAuth = useCallback(() => setAuthOpen(true), []);
  const requireAuth = useCallback(() => {
    if (user) return true;
    setAuthOpen(true);
    return false;
  }, [user]);

  const session = useMemo(
    () => ({ user, loading, error, retry, logout, openAuth, requireAuth }),
    [user, loading, error, retry, logout, openAuth, requireAuth],
  );

  if (error) {
    return <AuthErrorState onRetry={retry} />;
  }

  return (
    <V2SessionProvider value={session}>
      <V2LiveRegion>
        <V2Shell
          user={user}
          onLogout={logout}
          onLogin={openAuth}
          backdrop={<AmbientCards />}
        >
          <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
          {loading ? (
            <Fallback />
          ) : (
            <Suspense fallback={<Fallback />}>
              <Routes>
                <Route path="/" element={<V2Lobby />} />
                <Route
                  path="/room/:roomCode"
                  element={<V2Placeholder title="Sala d'attesa" />}
                />
                <Route
                  path="/game/:gameRoomCode"
                  element={<V2Placeholder title="Tavolo da gioco" />}
                />
                <Route
                  path="/practice"
                  element={<V2Placeholder title="Allenamento" />}
                />
                <Route
                  path="/profile"
                  element={<V2Placeholder title="Area personale" />}
                />
                <Route
                  path="/leaderboard"
                  element={<V2Placeholder title="Classifica" />}
                />
                <Route
                  path="/annotate"
                  element={<V2Placeholder title="Annotazioni" />}
                />
                <Route path="*" element={<V2NotFound />} />
              </Routes>
            </Suspense>
          )}
        </V2Shell>
      </V2LiveRegion>
    </V2SessionProvider>
  );
};

export default V2App;

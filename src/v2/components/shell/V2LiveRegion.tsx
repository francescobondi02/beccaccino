import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface LiveRegionValue {
  announce: (message: string) => void;
}

const LiveRegionContext = createContext<LiveRegionValue>({
  announce: () => undefined,
});

export function useAnnounce() {
  return useContext(LiveRegionContext).announce;
}

/**
 * Polite screen-reader channel shared by every V2 route (turn changes,
 * reconnects, briscola, trick winners). Never used for per-second ticks.
 */
const V2LiveRegion = ({ children }: { children: ReactNode }) => {
  const [message, setMessage] = useState("");
  const announce = useCallback((next: string) => setMessage(next), []);
  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <LiveRegionContext.Provider value={value}>
      {children}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </p>
    </LiveRegionContext.Provider>
  );
};

export default V2LiveRegion;

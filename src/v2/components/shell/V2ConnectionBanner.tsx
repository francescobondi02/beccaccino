import { RefreshCw, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "@/sockets/socketClient";

const V2ConnectionBanner = ({ status }: { status: ConnectionStatus }) => {
  if (status === "connected") return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-[hsl(var(--becca-danger))] px-4 py-2 text-sm font-semibold text-[hsl(var(--becca-accent-ink))]"
    >
      {status === "reconnecting" ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          Riconnessione in corso...
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          Connessione persa. Riconnessione automatica...
        </>
      )}
    </div>
  );
};

export default V2ConnectionBanner;

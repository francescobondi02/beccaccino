import { RefreshCw, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "@/sockets/socketClient";

const ConnectionBanner = ({ status }: { status: ConnectionStatus }) => {
  if (status === "connected") return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-destructive/90 text-destructive-foreground px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium backdrop-blur-sm">
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

export default ConnectionBanner;

import { useEffect, useRef, useState } from "react";
import {
  getConnectionStatus,
  onConnectionStatusChange,
  type ConnectionStatus,
} from "@/sockets/socketClient";

export function useConnectionStatus(onReconnect?: () => void) {
  const [status, setStatus] = useState<ConnectionStatus>(
    getConnectionStatus,
  );
  const connectedOnce = useRef(status === "connected");
  const disconnectedAfterConnect = useRef(false);

  useEffect(() => {
    return onConnectionStatusChange((nextStatus) => {
      setStatus(nextStatus);

      if (nextStatus === "connected") {
        if (connectedOnce.current && disconnectedAfterConnect.current) {
          onReconnect?.();
        }
        connectedOnce.current = true;
        disconnectedAfterConnect.current = false;
        return;
      }

      if (connectedOnce.current) {
        disconnectedAfterConnect.current = true;
      }
    });
  }, [onReconnect]);

  return status;
}

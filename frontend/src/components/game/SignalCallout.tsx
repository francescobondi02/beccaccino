import { useEffect, useState } from "react";
import type { Signal } from "@contract/cards";
import type { PlayerPosition } from "@/game/model";

interface SignalCalloutProps {
  signal: Signal;
  position: PlayerPosition;
  username: string;
}

export default function SignalCallout({ signal, position, username }: SignalCalloutProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 2800);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <span className="signal-callout" data-position={position} data-signal={signal} role="status" aria-atomic="true">
      <span className="sr-only">{username} dichiara </span>
      {signal}!
    </span>
  );
}

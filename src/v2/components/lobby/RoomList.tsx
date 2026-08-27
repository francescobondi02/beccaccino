import { Loader2, RefreshCw, Users } from "lucide-react";
import V2Panel from "@/v2/components/ui/V2Panel";
import V2Button from "@/v2/components/ui/V2Button";
import V2Badge from "@/v2/components/ui/V2Badge";
import { stagger } from "@/v2/lib/motion";
import { useReducedMotion } from "@/v2/hooks/useReducedMotion";

export interface LobbyRoom {
  id: number;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
}

interface RoomListProps {
  rooms: LobbyRoom[];
  loading: boolean;
  onJoin: (code: string) => void;
  onRefresh: () => void;
}

const RoomList = ({ rooms, loading, onJoin, onRefresh }: RoomListProps) => {
  const reduced = useReducedMotion();

  return (
    <V2Panel
      title="Stanze disponibili"
      description="Tavoli in attesa di giocatori."
      icon={<Users className="h-5 w-5" />}
    >
      <div className="mb-3 flex justify-end">
        <V2Button variant="ghost" onClick={onRefresh} aria-label="Aggiorna stanze">
          <RefreshCw className="h-4 w-4" />
          Aggiorna
        </V2Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8" role="status" aria-label="Caricamento stanze">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--becca-accent))]" />
        </div>
      ) : rooms.length === 0 ? (
        <p className="py-6 text-center text-sm text-[hsl(var(--becca-ink-soft))]">
          Nessuna stanza disponibile. Creane una tu.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rooms.map((room, index) => (
            <li
              key={room.id}
              className="becca-anim-rise flex items-center justify-between gap-3 rounded-[calc(var(--becca-radius)-0.15rem)] border border-[hsl(var(--becca-line))] bg-[hsl(var(--becca-surface-2))] px-3 py-2.5"
              style={{ animationDelay: stagger(index, reduced) }}
            >
              <div className="min-w-0">
                <p className="font-mono text-sm font-bold tracking-[0.18em]">
                  {room.code}
                </p>
                <p className="text-xs text-[hsl(var(--becca-ink-soft))]">
                  Tavolo in attesa
                </p>
              </div>
              <V2Badge tone={room.currentPlayers >= room.maxPlayers ? "brass" : "cobalt"}>
                <Users className="h-3 w-3" />
                {room.currentPlayers} / {room.maxPlayers}
              </V2Badge>
              <V2Button
                variant="secondary"
                onClick={() => onJoin(room.code)}
                aria-label={`Entra nella stanza ${room.code}`}
              >
                Entra
              </V2Button>
            </li>
          ))}
        </ul>
      )}
    </V2Panel>
  );
};

export default RoomList;

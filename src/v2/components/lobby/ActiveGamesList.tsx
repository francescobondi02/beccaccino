import { PlayCircle } from "lucide-react";
import V2Panel from "@/v2/components/ui/V2Panel";
import V2Button from "@/v2/components/ui/V2Button";
import type { LobbyRoom } from "./RoomList";

interface ActiveGamesListProps {
  games: LobbyRoom[];
  onResume: (code: string) => void;
}

const ActiveGamesList = ({ games, onResume }: ActiveGamesListProps) => {
  if (games.length === 0) return null;

  return (
    <V2Panel
      title="Partite in corso"
      description="Riprendi da dove hai lasciato."
      icon={<PlayCircle className="h-5 w-5" />}
    >
      <ul className="flex flex-col gap-2">
        {games.map((game) => (
          <li
            key={game.id}
            className="flex items-center justify-between gap-3 rounded-[calc(var(--becca-radius)-0.15rem)] border border-[hsl(var(--becca-accent)/0.3)] bg-[hsl(var(--becca-accent)/0.08)] px-3 py-2.5"
          >
            <p className="font-mono text-sm font-bold tracking-[0.18em]">
              {game.code}
            </p>
            <V2Button
              onClick={() => onResume(game.code)}
              aria-label={`Riprendi la partita ${game.code}`}
            >
              Riprendi
            </V2Button>
          </li>
        ))}
      </ul>
    </V2Panel>
  );
};

export default ActiveGamesList;

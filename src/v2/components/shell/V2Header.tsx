import { ClipboardCheck, LogOut, Trophy, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import V2Button from "@/v2/components/ui/V2Button";
import { v2Path } from "@/v2/lib/paths";
import type { AuthUser } from "@/hooks/useAuth";

interface V2HeaderProps {
  user: AuthUser | null;
  onLogout: () => Promise<void>;
  onLogin: () => void;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const V2Header = ({ user, onLogout, onLogin }: V2HeaderProps) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await onLogout();
      toast.success("Logout effettuato");
    } catch {
      toast.error("Errore durante il logout");
    }
  };

  return (
    <header className="relative z-40 border-b border-[hsl(var(--becca-on-felt)/0.14)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <button
          type="button"
          onClick={() => navigate(v2Path.lobby())}
          className="becca-press flex items-center gap-2 rounded-md text-left"
        >
          <span className="text-lg font-bold tracking-tight text-[hsl(var(--becca-on-felt))]">
            Beccaccino
          </span>
          <span className="rounded-full border border-[hsl(var(--becca-brass)/0.6)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--becca-brass))]">
            V2
          </span>
        </button>

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="becca-press flex min-h-11 items-center gap-2 rounded-full border border-[hsl(var(--becca-on-felt)/0.25)] py-1 pl-1 pr-3 text-[hsl(var(--becca-on-felt))]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--becca-accent))] text-xs font-bold text-[hsl(var(--becca-accent-ink))]">
                  {initials(user.username)}
                </span>
                <span className="hidden text-sm font-semibold sm:inline">
                  {user.username}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-50 w-56 bg-popover">
              <DropdownMenuLabel>Il mio account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate(v2Path.profile())}>
                <User className="mr-2 h-4 w-4" />
                <span>Profilo</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(v2Path.leaderboard())}>
                <Trophy className="mr-2 h-4 w-4" />
                <span>Classifica</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(v2Path.annotate())}>
                <ClipboardCheck className="mr-2 h-4 w-4" />
                <span>Dati esperti</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleLogout()}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Esci</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <V2Button variant="outline" onFelt onClick={onLogin}>
            Accedi
          </V2Button>
        )}
      </div>
    </header>
  );
};

export default V2Header;

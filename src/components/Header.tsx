import { ClipboardCheck, User, LogOut, Trophy, PanelsTopLeft, Zap } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface HeaderProps {
  variant?: "default" | "landing";
  onAuthenticate?: () => void;
}

const Header = ({ variant = "default", onAuthenticate }: HeaderProps) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme = "arcade", setTheme } = useTheme();
  const isArcade = theme !== "classic";
  const { user, logout } = useAuth();
  const username = user?.username;

  const handleProfile = () => {
    navigate("/profile");
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Disconnessione effettuata");
    } catch {
      toast.error("Impossibile disconnettersi");
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className={isArcade ? "club-header arcade-header" : variant === "landing" ? "fixed top-0 left-0 right-0 z-50 border-b border-[#d8b76d]/20 bg-[#071b1d]/90 shadow-[0_4px_18px_rgba(0,0,0,.18)] backdrop-blur-sm" : "fixed top-0 left-0 right-0 z-50 border-b border-[hsl(39_45%_50%_/_0.4)] bg-[hsl(var(--card)_/_0.92)] shadow-[0_4px_18px_hsl(157_35%_13%_/_0.10)] backdrop-blur-sm"}>
      <div className={isArcade ? "arcade-header-inner" : "container mx-auto px-4 h-16 flex items-center justify-between"}>
        <button
          type="button"
          aria-label="Beccaccino, torna alla lobby"
          className={isArcade ? "club-brand" : "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-left"}
          onClick={() => navigate("/")}
        >
          {isArcade ? (
            <>
              <span className="club-brand-symbol" aria-hidden="true"><Zap size={31} fill="currentColor" /></span>
              <span>BECCA<span className="club-brand-caption">VECCHIA SCUOLA. NUOVA ENERGIA.</span></span>
            </>
          ) : (
            <>
              <span className="grid h-8 w-8 place-items-center rounded-full border border-[#d8b76d]/70 bg-[#0d493c] text-sm font-bold text-[#fff8ea]" aria-hidden="true">B</span>
              <div>
                <div className={`font-display text-xl font-bold leading-none ${variant === "landing" ? "text-[#fff8ea]" : "text-foreground"}`}>Beccaccino</div>
                <div className="mt-0.5 text-[0.58rem] font-bold uppercase tracking-[0.18em] text-[#c69542]">Circolo online</div>
              </div>
            </>
          )}
        </button>

        {isArcade && (
          <nav aria-label="Navigazione principale">
            <button aria-current={pathname === "/" ? "page" : undefined} onClick={() => navigate("/")}>La lobby</button>
            <button aria-current={pathname === "/leaderboard" ? "page" : undefined} onClick={() => navigate("/leaderboard")}>Classifica</button>
          </nav>
        )}

        {username ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                aria-label="Menu account"
                className="flex items-center gap-2 hover:bg-secondary"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                    {getInitials(username)}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium hidden sm:inline">{username}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover z-50">
              <DropdownMenuLabel>Il mio account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTheme(isArcade ? "classic" : "arcade")}>
                <PanelsTopLeft className="mr-2 h-4 w-4" />
                <span>{isArcade ? "Interfaccia classica" : "Nuova interfaccia"}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleProfile}>
                <User className="mr-2 h-4 w-4" />
                <span>Profilo</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/leaderboard")}>
                <Trophy className="mr-2 h-4 w-4" />
                <span>Classifica</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/annotate")}>
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
          <div className="arcade-header-actions flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label={isArcade ? "Usa interfaccia classica" : "Usa nuova interfaccia"} onClick={() => setTheme(isArcade ? "classic" : "arcade")}>
              <PanelsTopLeft className="h-4 w-4" />
            </Button>
            <Button onClick={() => onAuthenticate ? onAuthenticate() : navigate("/")} data-testid="open-auth-button">Accedi</Button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;

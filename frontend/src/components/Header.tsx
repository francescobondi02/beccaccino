import { User, LogOut, Trophy, Zap } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
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
  onAuthenticate?: () => void;
  onBeforeNavigate?: () => Promise<boolean>;
}

const Header = ({ onAuthenticate, onBeforeNavigate }: HeaderProps) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const username = user?.username;

  const handleNavigate = async (path: string) => {
    if (onBeforeNavigate && !(await onBeforeNavigate())) return;
    navigate(path);
  };

  const handleLogout = async () => {
    let leftRoom = false;
    try {
      if (onBeforeNavigate) {
        if (!(await onBeforeNavigate())) return;
        leftRoom = true;
      }
      await logout();
      toast.success("Disconnessione effettuata");
    } catch {
      toast.error("Impossibile disconnettersi");
      if (leftRoom) navigate("/");
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
    <header className="club-header arcade-header">
      <div className="arcade-header-inner">
        <button
          type="button"
          aria-label="Beccaccino, torna alla lobby"
          className="club-brand"
          onClick={() => void handleNavigate("/")}
        >
          <span className="club-brand-symbol" aria-hidden="true"><Zap size={31} fill="currentColor" /></span>
          <span>BECCA<span className="club-brand-caption">VECCHIA SCUOLA. NUOVA ENERGIA.</span></span>
        </button>

        {pathname !== "/" && (
          <nav aria-label="Navigazione principale">
            <button onClick={() => void handleNavigate("/")}>Gioca</button>
            <button aria-current={pathname === "/leaderboard" ? "page" : undefined} onClick={() => void handleNavigate("/leaderboard")}>Classifica</button>
          </nav>
        )}

        {username ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                aria-label="Menu account"
                className="flex items-center gap-2 text-foreground hover:bg-secondary hover:text-foreground"
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
              <DropdownMenuItem onClick={() => void handleNavigate("/profile")}>
                <User className="mr-2 h-4 w-4" />
                <span>Profilo</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleNavigate("/leaderboard")}>
                <Trophy className="mr-2 h-4 w-4" />
                <span>Classifica</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleLogout()}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Esci</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button onClick={() => onAuthenticate ? onAuthenticate() : void handleNavigate("/")} data-testid="open-auth-button">Accedi</Button>
        )}
      </div>
    </header>
  );
};

export default Header;

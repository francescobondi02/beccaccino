import { ClipboardCheck, User, LogOut, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

const Header = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const username = user?.username;

  const handleProfile = () => {
    navigate("/profile");
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logout effettuato");
    } catch {
      toast.error("Errore durante il logout");
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
    <header className="fixed top-0 left-0 right-0 z-50 bg-card/80 backdrop-blur-sm border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigate("/")}
        >
          <div className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Beccaccino Online
          </div>
        </div>

        {username && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
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
        )}
      </div>
    </header>
  );
};

export default Header;

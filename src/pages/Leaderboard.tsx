import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Medal, Users, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { toast } from "sonner";
import { setSentryUser, clearSentryUser } from "@/lib/sentryUser";

const API_URL = import.meta.env.VITE_API_URL;

interface LeaderboardEntry {
  username: string;
  totalGames: number;
  wins: number;
  winRate: number;
  totalPoints: number;
}

const Leaderboard = () => {
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState<string | undefined>(undefined);

  // Check auth for header display (not required for this page)
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_URL}/users/me`, {
          credentials: "include",
        });
        if (res.ok) {
          const user = await res.json();
          setUsername(user.username);
          setSentryUser({ id: user.id, username: user.username });
        }
      } catch {
        // Not logged in — that's fine, leaderboard is public
      }
    };
    checkAuth();
  }, []);

  // Fetch leaderboard
  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_URL}/users/leaderboard`);
        if (!res.ok) {
          throw new Error("Failed to fetch leaderboard");
        }
        const data = await res.json();
        setLeaderboard(data.leaderboard ?? []);
      } catch (error) {
        console.error("Error fetching leaderboard:", error);
        toast.error("Impossibile caricare la classifica");
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/users/logout`, {
        method: "POST",
        credentials: "include",
      });
      setUsername(undefined);
      clearSentryUser();
      toast.success("Logout effettuato");
      navigate("/");
    } catch {
      toast.error("Errore durante il logout");
    }
  };

  // Podium icon for top 3
  const getRankIcon = (index: number) => {
    if (index === 0) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (index === 1) return <Medal className="h-5 w-5 text-gray-400" />;
    if (index === 2) return <Medal className="h-5 w-5 text-amber-700" />;
    return (
      <span className="text-sm font-bold text-muted-foreground w-5 text-center">
        {index + 1}
      </span>
    );
  };

  const getRankBg = (index: number) => {
    if (index === 0) return "bg-yellow-500/10 border-yellow-500/30";
    if (index === 1) return "bg-gray-300/10 border-gray-400/30";
    if (index === 2) return "bg-amber-700/10 border-amber-700/30";
    return "bg-card border-border/50";
  };

  return (
    <div className="min-h-screen bg-background">
      <Header username={username} onLogout={handleLogout} />

      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-3xl mx-auto">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="mb-4 gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Torna alla home
          </Button>

          {/* Page Header */}
          <Card className="bg-gradient-card border-border/50 mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <Trophy className="h-7 w-7 text-primary" />
                Classifica Globale
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                I migliori giocatori di Beccaccino, ordinati per vittorie e percentuale di successo.
              </p>
            </CardContent>
          </Card>

          {/* Loading State */}
          {isLoading && (
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="p-12 text-center">
                <Loader2 className="h-10 w-10 animate-spin mx-auto mb-3 text-primary" />
                <p className="text-muted-foreground">Caricamento classifica...</p>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {!isLoading && leaderboard.length === 0 && (
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="p-12 text-center">
                <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground text-lg">
                  Nessuna partita completata ancora
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Completa la tua prima partita per apparire in classifica!
                </p>
              </CardContent>
            </Card>
          )}

          {/* Leaderboard Table */}
          {!isLoading && leaderboard.length > 0 && (
            <div className="space-y-3">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div className="col-span-1">#</div>
                <div className="col-span-4">Giocatore</div>
                <div className="col-span-2 text-center">Vittorie</div>
                <div className="col-span-2 text-center">Partite</div>
                <div className="col-span-1 text-center">Win%</div>
                <div className="col-span-2 text-right">Punti</div>
              </div>

              {/* Entries */}
              {leaderboard.map((entry, index) => (
                <Card
                  key={`${entry.username}-${index}`}
                  className={`transition-all duration-200 hover:scale-[1.01] ${getRankBg(index)}`}
                >
                  <CardContent className="p-4">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      {/* Rank */}
                      <div className="col-span-1 flex items-center justify-center">
                        {getRankIcon(index)}
                      </div>

                      {/* Username */}
                      <div className="col-span-4">
                        <p className="font-semibold text-foreground truncate">
                          {entry.username}
                        </p>
                      </div>

                      {/* Wins */}
                      <div className="col-span-2 text-center">
                        <span className="text-lg font-bold text-primary">
                          {entry.wins}
                        </span>
                      </div>

                      {/* Total Games */}
                      <div className="col-span-2 text-center">
                        <span className="text-sm text-muted-foreground">
                          {entry.totalGames}
                        </span>
                      </div>

                      {/* Win Rate */}
                      <div className="col-span-1 text-center">
                        <span className="text-sm font-medium text-accent">
                          {entry.winRate}%
                        </span>
                      </div>

                      {/* Total Points */}
                      <div className="col-span-2 text-right">
                        <span className="text-sm font-medium text-muted-foreground">
                          {entry.totalPoints}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Leaderboard;

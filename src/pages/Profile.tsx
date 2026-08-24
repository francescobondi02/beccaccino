import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Header from "@/components/Header";
import {
  Trophy,
  Users,
  Star,
  Clock,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { setSentryUser, clearSentryUser } from "@/lib/sentryUser";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface RecentGame {
  id: number;
  code: string;
  date: string;
  result: "Vittoria" | "Sconfitta";
  myTeamPoints: number;
  opponentTeamPoints: number;
  teammates: string[];
  opponents: string[];
}

interface UserStats {
  totalGames: number;
  wins: number;
  winRate: number;
  totalPoints: number;
  recentGames: RecentGame[];
}

const Profile = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsStatus, setStatsStatus] = useState<
    "loading" | "error" | "ready"
  >("loading");

  const fetchStats = useCallback(async () => {
    setStatsStatus("loading");
    try {
      const data = await apiGet<UserStats>("/users/me/stats");
      setStats(data);
      setStatsStatus("ready");
    } catch (error) {
      console.error("Error fetching stats:", error);
      setStats(null);
      setStatsStatus("error");
    }
  }, []);

  // Check auth and load user data
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await apiGet<{ id: number; username: string }>(
          "/users/me",
        );
        setUsername(user.username);
        setNewUsername(user.username);
        setUserId(user.id);
        setIsAuthenticated(true);
        setSentryUser({ id: user.id, username: user.username });

        // Fetch stats
        await fetchStats();
      } catch (error) {
        console.error("Auth check error:", error);
        toast.error("Devi effettuare l'accesso");
        navigate("/");
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [fetchStats, navigate]);

  const handleSaveUsername = async () => {
    if (!newUsername.trim()) {
      toast.error("Il nome non può essere vuoto");
      return;
    }

    if (newUsername.trim().length < 3) {
      toast.error("Il nome deve avere almeno 3 caratteri");
      return;
    }

    setIsSaving(true);
    try {
      const updatedUser = await apiPatch<{ username: string }>("/users/me", {
        username: newUsername.trim(),
      });
      setUsername(updatedUser.username);
      setNewUsername(updatedUser.username);
      setIsEditing(false);
      toast.success("Nome aggiornato con successo!");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Errore nell'aggiornamento"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await apiDelete("/users/me");
      toast.success("Account eliminato");
      navigate("/");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Errore nell'eliminazione"
      );
    }
  };

  const handleLogout = async () => {
    try {
      await apiPost("/users/logout");
      clearSentryUser();
      toast.success("Logout effettuato");
      navigate("/");
    } catch (error) {
      toast.error("Errore durante il logout");
    }
  };

  if (isLoading) {
    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center"
        role="status"
        aria-label="Caricamento profilo"
      >
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header username={username} onLogout={handleLogout} />

      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Profile Header */}
          <Card className="bg-gradient-card border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="text-2xl">Il mio profilo</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Nome utente</Label>
                    <Input
                      id="username"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="bg-secondary border-border"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSaveUsername}
                      variant="gradient"
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvataggio...
                        </>
                      ) : (
                        "Salva"
                      )}
                    </Button>
                    <Button
                      onClick={() => {
                        setIsEditing(false);
                        setNewUsername(username);
                      }}
                      variant="outline"
                      disabled={isSaving}
                    >
                      Annulla
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Nome utente</p>
                    <p className="text-xl font-semibold">{username}</p>
                  </div>
                  <Button
                    onClick={() => setIsEditing(true)}
                    variant="outline"
                    size="sm"
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Modifica
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {statsStatus === "loading" && (
            <Card
              className="bg-gradient-card border-border/50"
              role="status"
            >
              <CardContent className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
                <p className="text-muted-foreground">
                  Caricamento statistiche...
                </p>
              </CardContent>
            </Card>
          )}

          {statsStatus === "error" && (
            <Card
              className="bg-gradient-card border-destructive/50"
              role="alert"
            >
              <CardContent className="p-8 text-center">
                <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
                <p className="font-medium">
                  Impossibile caricare le statistiche
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={fetchStats}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Riprova
                </Button>
              </CardContent>
            </Card>
          )}

          {statsStatus === "ready" && stats && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-card border-border/50">
                  <CardContent className="pt-6 text-center">
                    <Users className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <p className="text-2xl font-bold">{stats.totalGames}</p>
                    <p className="text-sm text-muted-foreground">Partite</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-card border-border/50">
                  <CardContent className="pt-6 text-center">
                    <Trophy className="h-8 w-8 mx-auto mb-2 text-accent" />
                    <p className="text-2xl font-bold">{stats.wins}</p>
                    <p className="text-sm text-muted-foreground">Vittorie</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-card border-border/50">
                  <CardContent className="pt-6 text-center">
                    <Star className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <p className="text-2xl font-bold">{stats.winRate}%</p>
                    <p className="text-sm text-muted-foreground">Win Rate</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-card border-border/50">
                  <CardContent className="pt-6 text-center">
                    <Clock className="h-8 w-8 mx-auto mb-2 text-accent" />
                    <p className="text-2xl font-bold">{stats.totalPoints}</p>
                    <p className="text-sm text-muted-foreground">Punti</p>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Games */}
              <Card className="bg-gradient-card border-border/50">
                <CardHeader>
                  <CardTitle>Partite recenti</CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.recentGames.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground">
                        Nessuna partita completata ancora
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Gioca la tua prima partita per vedere le statistiche!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {stats.recentGames.map((game) => (
                        <div
                          key={game.id}
                          className="flex items-center justify-between p-3 bg-secondary rounded-lg"
                        >
                          <div className="flex-1">
                            <p className="font-medium">
                              vs {game.opponents.join(", ")}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {new Date(game.date).toLocaleDateString("it-IT")}
                              {game.teammates.length > 0 && (
                                <span className="ml-2">
                                  (con {game.teammates.join(", ")})
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="text-right">
                            <p
                              className={`font-semibold ${
                                game.result === "Vittoria"
                                  ? "text-accent"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {game.result}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {game.myTeamPoints} - {game.opponentTeamPoints}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* Danger Zone */}
          <Card className="bg-gradient-card border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Zona pericolosa</CardTitle>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Elimina account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Questa azione non può essere annullata. Tutti i tuoi dati
                      verranno eliminati permanentemente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Elimina
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Profile;

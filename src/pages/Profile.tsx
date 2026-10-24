import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Header from "@/components/Header";
import AuthErrorState from "@/components/AuthErrorState";
import {
  Trophy,
  Users,
  Star,
  Zap,
  ArrowUpRight,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiDelete } from "@/lib/api";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import { profileDemo } from "@/preview/profileDemo";
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

export interface UserStats {
  totalGames: number;
  wins: number;
  winRate: number;
  totalPoints: number;
  recentGames: RecentGame[];
}

const Profile = ({ preview = false }: { preview?: boolean }) => {
  const isPreview = import.meta.env.DEV && preview;
  const navigate = useNavigate();
  const {
    user: authenticatedUser,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
    setUser,
    clearUser,
  } = useAuth({ redirectOnFail: !isPreview });
  const user = isPreview ? profileDemo.user : authenticatedUser;
  const username = user?.username ?? "";
  const [isEditing, setIsEditing] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loadedStats, setStats] = useState<UserStats | null>(null);
  const [requestStatus, setStatsStatus] = useState<
    "loading" | "error" | "ready"
  >("loading");
  const stats = isPreview ? profileDemo.stats : loadedStats;
  const statsStatus = isPreview ? "ready" : requestStatus;

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

  useEffect(() => {
    if (!user) return;
    setNewUsername(user.username);
  }, [user]);

  useEffect(() => {
    if (isPreview || !user?.id) return;
    void fetchStats();
  }, [fetchStats, isPreview, user?.id]);

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
      const updatedUser = await apiPatch<AuthUser>("/users/me", {
        username: newUsername.trim(),
      });
      setUser(updatedUser);
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
      await clearUser();
      toast.success("Account eliminato");
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Errore nell'eliminazione"
      );
    }
  };

  if (authError && !isPreview) {
    return <AuthErrorState onRetry={retryAuth} />;
  }

  if (!user || (authLoading && !isPreview)) {
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
    <div className="circolo-shell">
      <Header />

      <main className="arcade-dashboard">
        {isPreview && (
          <div className="mb-6 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm text-primary">
            <p>Anteprima locale · dati dimostrativi · nessun accesso necessario.</p>
            <Link className="club-text-button" to="/">Torna alla landing <ArrowUpRight size={16} /></Link>
          </div>
        )}
        <section className="arcade-dashboard-hero" aria-labelledby="profile-title">
          <div className="arcade-dashboard-copy">
            <span className="club-eyebrow"><Zap size={15} /> IL TUO ANGOLO DI BECCA</span>
            <h1 id="profile-title" className="arcade-page-title">Il mio <em>profilo</em></h1>
            <p>Il tuo nome. Le tue vittorie.<br />La prossima partita è tutta da scrivere.</p>
            <Link className="club-text-button" to="/leaderboard">Sfida la classifica <ArrowUpRight size={19} /></Link>
          </div>
          <Card className="arcade-player-card">
            <CardHeader className="arcade-player-heading flex-row space-y-0">
              <span className="arcade-player-avatar" aria-hidden="true">{username.slice(0, 2).toUpperCase()}</span>
              <h2>La tua identità</h2>
              <Zap size={28} aria-hidden="true" />
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditing && !isPreview ? (
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
                <div className="arcade-player-name">
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Nome utente</p>
                    <p className="arcade-username">{username}</p>
                  </div>
                  {!isPreview && <Button
                    onClick={() => setIsEditing(true)}
                    variant="secondary"
                    size="sm"
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Modifica
                  </Button>}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <div className="space-y-6">
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
              <section aria-labelledby="profile-stats-title">
                <div className="arcade-section-heading">
                  <h2 id="profile-stats-title">I tuoi numeri.</h2>
                  <span>Partite completate</span>
                </div>
                <div className="arcade-stats-grid">
                  {[
                    { label: "Partite", value: stats.totalGames, Icon: Users, tone: "purple" },
                    { label: "Vittorie", value: stats.wins, Icon: Trophy, tone: "lime" },
                    { label: "Percentuale vittorie", value: `${stats.winRate}%`, Icon: Star, tone: "pink" },
                    { label: "Punti", value: stats.totalPoints, Icon: Zap, tone: "purple" },
                  ].map(({ label, value, Icon, tone }) => (
                    <Card key={label} className="arcade-stat" data-tone={tone}>
                      <CardContent>
                        <Icon size={22} aria-hidden="true" />
                        <p className="arcade-stat-value">{value}</p>
                        <p>{label}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              <Card className="arcade-history-card">
                <CardHeader>
                  <div className="arcade-section-heading">
                    <h2>Partite recenti</h2>
                    <span>La tua ultima mano, e non solo.</span>
                  </div>
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
                      <Button asChild className="mt-5"><Link to="/">Vai ai tavoli <ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button>
                    </div>
                  ) : (
                    <ol className="arcade-match-list">
                      {stats.recentGames.map((game) => (
                        <li
                          key={game.id}
                          className="arcade-match-row"
                          data-result={game.result}
                        >
                          <span className="arcade-match-icon" aria-hidden="true">{game.result === "Vittoria" ? <Trophy size={20} /> : <Users size={20} />}</span>
                          <div className="min-w-0 flex-1">
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
                            <p className="arcade-match-result">
                              {game.result}
                            </p>
                            <p className="arcade-match-score">
                              {game.myTeamPoints} - {game.opponentTeamPoints}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {!isPreview && <details className="arcade-account-settings">
            <summary>Gestione account</summary>
            <Card className="mt-4 border-destructive/30">
              <CardHeader>
                <CardTitle className="text-destructive">Eliminazione account</CardTitle>
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
          </details>}
        </div>
      </main>
    </div>
  );
};

export default Profile;

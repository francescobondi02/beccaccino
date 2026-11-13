import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import {
  Trophy,
  Users,
  Loader2,
  ArrowLeft,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";

interface LeaderboardEntry {
  username: string;
  totalGames: number;
  wins: number;
  winRate: number;
  totalPoints: number;
}

const Leaderboard = () => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );

  const fetchLeaderboard = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await apiGet<{ leaderboard: LeaderboardEntry[] }>(
        "/users/leaderboard",
      );
      setLeaderboard(data.leaderboard);
      setStatus("ready");
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      setLeaderboard([]);
      setStatus("error");
      toast.error("Impossibile caricare la classifica");
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  return (
    <div className="circolo-shell">
      <Header />

      <main className="arcade-dashboard arcade-leaderboard">
          <Button variant="ghost" size="sm" asChild className="arcade-page-back mb-6">
            <Link to="/"><ArrowLeft className="mr-2 h-4 w-4" />Torna alla home</Link>
          </Button>

          <section className="arcade-dashboard-hero" aria-labelledby="leaderboard-title">
            <div className="arcade-dashboard-copy">
              <span className="club-eyebrow"><Trophy size={15} /> IL BELLO È ARRIVARE IN ALTO</span>
              <h1 id="leaderboard-title" className="arcade-page-title">Classifica <em>generale</em></h1>
              <p>
                Le vittorie parlano. Le scuse un po' meno.<br />
                Prima le vittorie, poi la percentuale di successo.
              </p>
            </div>
            <div className="arcade-ranking-banner" aria-hidden="true">
              <Trophy size={68} strokeWidth={1.5} />
              <p>GIOCA BENE.<br /><em>LASCIA IL SEGNO.</em></p>
              <span>40 CARTE. NESSUNA SCUSA.</span>
            </div>
          </section>

          <div className="arcade-ranking-content">
          {status === "loading" && (
            <Card
              className="bg-gradient-card border-border/50"
              role="status"
            >
              <CardContent className="p-12 text-center">
                <Loader2 className="h-10 w-10 animate-spin mx-auto mb-3 text-primary" />
                <p className="text-muted-foreground">Caricamento classifica...</p>
              </CardContent>
            </Card>
          )}

          {status === "error" && (
            <Card
              className="bg-gradient-card border-destructive/50"
              role="alert"
            >
              <CardContent className="p-12 text-center">
                <AlertCircle className="h-12 w-12 mx-auto mb-3 text-destructive" />
                <p className="font-medium text-lg">
                  Impossibile caricare la classifica
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={fetchLeaderboard}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Riprova
                </Button>
              </CardContent>
            </Card>
          )}

          {status === "ready" && leaderboard.length === 0 && (
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="p-12 text-center">
                <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground text-lg">
                  Nessuna partita ancora completata
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Completa la tua prima partita per apparire in classifica!
                </p>
                <Button asChild className="mt-5"><Link to="/">Vai ai tavoli</Link></Button>
              </CardContent>
            </Card>
          )}

          {status === "ready" && leaderboard.length > 0 && (
            <>
              <ol className="arcade-podium" aria-label="Podio">
                {leaderboard.slice(0, 3).map((entry, index) => (
                  <li
                    key={`${entry.username}-${index}`}
                    className="arcade-podium-card"
                    data-rank={index + 1}
                  >
                    <div className="arcade-podium-top">
                      <span aria-label={`${index + 1}° posto`}>0{index + 1}</span>
                      <Trophy size={25} aria-hidden="true" />
                    </div>
                    <div className="arcade-podium-avatar" aria-hidden="true">{entry.username.slice(0, 2).toUpperCase()}</div>
                    <h2>{entry.username}</h2>
                    <p className="arcade-podium-wins"><strong>{entry.wins}</strong> vittorie</p>
                    <dl className="arcade-ranking-stats">
                      <div><dt>Partite</dt><dd>{entry.totalGames}</dd></div>
                      <div><dt>% vittorie</dt><dd>{entry.winRate}%</dd></div>
                      <div><dt>Punti</dt><dd>{entry.totalPoints}</dd></div>
                    </dl>
                  </li>
                ))}
              </ol>
              {leaderboard.length > 3 && (
                <section aria-labelledby="rankings-rest-title" className="mt-12">
                  <div className="arcade-section-heading">
                    <h2 id="rankings-rest-title">La sfida continua.</h2>
                    <span>Ogni vittoria conta.</span>
                  </div>
                  <ol className="arcade-ranking-list" start={4} aria-label="Classifica dal quarto posto">
                    {leaderboard.slice(3).map((entry, index) => (
                      <li key={`${entry.username}-${index}`} className="arcade-ranking-row">
                        <span className="arcade-ranking-place">{index + 4}</span>
                        <h3>{entry.username}</h3>
                        <dl className="arcade-ranking-stats">
                          <div><dt>Vittorie</dt><dd>{entry.wins}</dd></div>
                          <div><dt>Partite</dt><dd>{entry.totalGames}</dd></div>
                          <div><dt>% vittorie</dt><dd>{entry.winRate}%</dd></div>
                          <div><dt>Punti</dt><dd>{entry.totalPoints}</dd></div>
                        </dl>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
          </div>
      </main>
    </div>
  );
};

export default Leaderboard;

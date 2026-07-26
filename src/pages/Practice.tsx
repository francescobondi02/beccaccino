import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Bot, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import { toast } from "sonner";
import { setSentryUser } from "@/lib/sentryUser";
import { apiGet, apiPost, ApiError } from "@/lib/api";

interface AuthUser {
  id: number;
  username: string;
}

/**
 * Difficulty tiers, mirroring backend `botService.ts` and `ai/serving/tiers.py`.
 * Kept as a static list rather than fetched from /tiers: the backend rejects an
 * unknown tier anyway, and a hardcoded list means the picker still renders when
 * the Python service is down (you just cannot start a game).
 */
const TIERS = [
  {
    name: "facile",
    label: "Facile",
    description: "Ha imparato imitando il gioco base. Sbaglia spesso.",
  },
  {
    name: "medio",
    label: "Medio",
    description: "Segue regole fisse e sensate. Non usa segni.",
  },
  {
    name: "forte",
    label: "Forte",
    description: "Allenato giocando milioni di partite contro sé stesso.",
  },
  {
    name: "esperto",
    label: "Esperto",
    description: "Come Forte, ma calcola in anticipo le mani possibili.",
  },
] as const;

const Practice = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string | undefined>(undefined);
  const [startingTier, setStartingTier] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await apiGet<AuthUser>("/users/me");
      setUsername(user.username);
      setSentryUser({ id: user.id, username: user.username });
    };

    checkAuth().catch(() => {
      toast.error("Accedi per giocare contro i bot");
      navigate("/");
    });
  }, [navigate]);

  const startPractice = async (tier: string) => {
    setStartingTier(tier);
    try {
      const data = await apiPost<{ code: string }>("/rooms/practice", { tier });
      navigate(`/game/${data.code}`);
    } catch (error) {
      // Already mid-game: send them back to it rather than stranding them.
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.body?.activeRoomCode
      ) {
        toast.error("Sei già in una partita attiva");
        navigate(`/game/${error.body.activeRoomCode}`);
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Impossibile iniziare la partita",
      );
      setStartingTier(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header username={username} />

      <div className="container max-w-3xl mx-auto p-4 pt-24">
        <Button variant="ghost" className="mb-6" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Torna alla home
        </Button>

        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent mb-3">
            Pratica contro i bot
          </h1>
          <p className="text-muted-foreground">
            Gioca da solo contro tre avversari controllati dall'intelligenza
            artificiale. Scegli quanto devono essere forti.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {TIERS.map((tier) => (
            <Card
              key={tier.name}
              className="bg-gradient-card border-border/50 hover:border-primary/50 transition-all"
            >
              <CardContent className="pt-6 flex flex-col h-full">
                <div className="flex items-center gap-2 mb-2">
                  <Bot className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-semibold">{tier.label}</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-6 flex-1">
                  {tier.description}
                </p>
                <Button
                  variant="gradient"
                  className="w-full"
                  disabled={startingTier !== null}
                  onClick={() => startPractice(tier.name)}
                  data-testid={`start-practice-${tier.name}`}
                >
                  {startingTier === tier.name ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Preparo il tavolo…
                    </>
                  ) : (
                    "Gioca"
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-8">
          Le partite di pratica non contano per la classifica.
        </p>
      </div>
    </div>
  );
};

export default Practice;

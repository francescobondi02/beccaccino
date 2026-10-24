import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Bot, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import AuthErrorState from "@/components/AuthErrorState";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { handleActiveRoomConflict } from "@/lib/roomRedirect";

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
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAuth({ redirectOnFail: true });
  const [startingTier, setStartingTier] = useState<string | null>(null);

  const startPractice = async (tier: string) => {
    setStartingTier(tier);
    try {
      const data = await apiPost<{ code: string }>("/rooms/practice", { tier });
      navigate(`/game/${data.code}`);
    } catch (error) {
      if (handleActiveRoomConflict(error, navigate)) return;
      toast.error(
        error instanceof Error ? error.message : "Impossibile iniziare la partita",
      );
      setStartingTier(null);
    }
  };

  if (authError) {
    return <AuthErrorState onRetry={retryAuth} />;
  }

  if (authLoading || !user) {
    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center"
        role="status"
        aria-label="Verifica sessione"
      >
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="circolo-shell">
      <Header />

      <div className="container max-w-3xl mx-auto p-4 pt-24">
        <Button variant="ghost" className="mb-6" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Torna alla home
        </Button>

        <div className="text-center mb-10">
          <p className="circolo-kicker mb-3">Tavolo d'allenamento</p>
          <h1 className="font-display mb-3 text-4xl font-bold text-primary">
            Allenati contro i bot
          </h1>
          <p className="text-muted-foreground">
            Gioca con un socio e due avversari controllati dal computer.
            Scegli il livello di difficoltà.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {TIERS.map((tier) => (
            <Card
              key={tier.name}
              className="circolo-surface transition-[transform,border-color,box-shadow] hover:-translate-y-1 hover:border-accent/70"
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
          Gli allenamenti non contano per la classifica.
        </p>
      </div>
    </div>
  );
};

export default Practice;

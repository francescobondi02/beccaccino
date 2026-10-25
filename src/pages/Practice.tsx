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
import { enterGameFullscreen, exitGameFullscreen } from "@/lib/fullscreen";

const Practice = () => {
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAuth({ redirectOnFail: true });
  const [starting, setStarting] = useState(false);

  const startPractice = async () => {
    setStarting(true);
    // Fullscreen needs this click's user activation, so it starts before the request.
    void enterGameFullscreen();
    try {
      const data = await apiPost<{ code: string }>("/rooms/practice", { tier: "forte" });
      navigate(`/game/${data.code}`);
    } catch (error) {
      exitGameFullscreen();
      if (handleActiveRoomConflict(error, navigate)) return;
      toast.error(
        error instanceof Error ? error.message : "Impossibile iniziare la partita",
      );
      setStarting(false);
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
          </p>
        </div>

        <div className="max-w-md mx-auto">
          <Card className="circolo-surface transition-[transform,border-color,box-shadow] hover:-translate-y-1 hover:border-accent/70">
            <CardContent className="pt-6 flex flex-col h-full">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Bot allenato</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6 flex-1">
                Ha imparato giocando contro sé stesso. Sceglie briscola, carte e segni.
              </p>
              <Button
                variant="gradient"
                className="w-full"
                disabled={starting}
                onClick={startPractice}
                data-testid="start-practice-forte"
              >
                {starting ? (
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
        </div>

        <p className="text-xs text-muted-foreground text-center mt-8">
          Gli allenamenti non contano per la classifica.
        </p>
      </div>
    </div>
  );
};

export default Practice;

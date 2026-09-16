import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import AuthDialog from "@/components/AuthDialog";
import AuthErrorState from "@/components/AuthErrorState";
import Header from "@/components/Header";
import LobbyActions from "@/components/lobby/LobbyActions";
import LobbyCardBackground from "@/components/lobby/LobbyCardBackground";
import LobbyRoomLists from "@/components/lobby/LobbyRoomLists";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useLobbyRooms } from "@/hooks/useLobbyRooms";
import { apiPost } from "@/lib/api";
import { handleActiveRoomConflict } from "@/lib/roomRedirect";

const LobbyPage = () => {
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAuth();
  const userId = user?.id ?? null;
  const isAuthenticated = user !== null;
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [resumingRoomCode, setResumingRoomCode] = useState<string | null>(null);
  const isConnected = useConnectionStatus() === "connected";
  const {
    availableRooms,
    ordinaryActiveGames,
    pausedPracticeGames,
    isLoading,
  } = useLobbyRooms(userId);

  const requireAuthentication = () => {
    if (isAuthenticated) return true;
    setShowAuthDialog(true);
    return false;
  };

  const handlePractice = () => {
    if (requireAuthentication()) navigate("/practice");
  };

  const handleResumePractice = async (code: string) => {
    setResumingRoomCode(code);
    try {
      await apiPost<{ success: boolean; paused: boolean }>(
        `/rooms/${code}/resume`,
        {},
      );
      navigate(`/game/${code}`);
    } catch (error) {
      console.error("Error resuming practice room:", error);
      toast.error("Impossibile riprendere l'allenamento");
      setResumingRoomCode(null);
    }
  };

  const handleCreateRoom = async () => {
    if (!requireAuthentication()) return;
    if (!userId) {
      toast.error("Errore: userId non disponibile");
      return;
    }

    try {
      const room = await apiPost<{ code: string }>("/rooms/", {});
      toast.success("Stanza creata!");
      navigate(`/room/${room.code}`);
    } catch (error) {
      if (handleActiveRoomConflict(error, navigate)) return;
      console.error("Error creating room:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossibile creare la stanza",
      );
    }
  };

  const joinRoom = async (code: string) => {
    if (!requireAuthentication()) return;
    if (!userId) {
      toast.error("Errore: userId non disponibile");
      return;
    }

    try {
      await apiPost("/rooms/join", { roomCode: code });
      toast.success(`Accesso alla stanza ${code}`);
      navigate(`/room/${code}`);
    } catch (error) {
      if (handleActiveRoomConflict(error, navigate)) return;
      console.error("Error joining room:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossibile entrare nella stanza",
      );
    }
  };

  const handleJoinByCode = () => {
    if (!requireAuthentication()) return;

    const code = roomCode.trim();
    if (!code) {
      toast.error("Inserisci un codice stanza");
      return;
    }
    void joinRoom(code);
  };

  if (authError) {
    return <AuthErrorState onRetry={retryAuth} />;
  }

  if (authLoading) {
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
    <div className="min-h-screen bg-background">
      <Header />
      <AuthDialog
        open={showAuthDialog}
        onOpenChange={setShowAuthDialog}
      />

      <div className="min-h-screen flex items-center justify-center p-4 pt-20">
        <div className="w-full max-w-4xl animate-fade-in">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent mb-3">
              Beccaccino Online - Beta
            </h1>
            <p className="text-muted-foreground text-lg">
              Entra in una stanza o creane una nuova per iniziare a giocare
            </p>
          </div>

          <LobbyCardBackground />

          {!isAuthenticated && (
            <Card className="bg-gradient-card border-border/50 mb-6">
              <CardContent className="pt-6 text-center">
                <p className="text-lg mb-4">
                  Effettua l'accesso per creare o entrare in una stanza
                </p>
                <Button
                  variant="gradient"
                  size="lg"
                  onClick={() => setShowAuthDialog(true)}
                  data-testid="open-auth-button"
                >
                  Accedi / Registrati
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <LobbyActions
              roomCode={roomCode}
              onRoomCodeChange={setRoomCode}
              onCreateRoom={() => void handleCreateRoom()}
              onPractice={handlePractice}
              onJoinByCode={handleJoinByCode}
            />

            {isAuthenticated && (
              <LobbyRoomLists
                availableRooms={availableRooms}
                ordinaryActiveGames={ordinaryActiveGames}
                pausedPracticeGames={pausedPracticeGames}
                isConnected={isConnected}
                isLoading={isLoading}
                resumingRoomCode={resumingRoomCode}
                onJoin={(code) => void joinRoom(code)}
                onOpenGame={(code) => navigate(`/game/${code}`)}
                onResumePractice={(code) => void handleResumePractice(code)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LobbyPage;

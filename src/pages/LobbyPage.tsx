import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import AuthDialog from "@/components/AuthDialog";
import AuthErrorState from "@/components/AuthErrorState";
import Header from "@/components/Header";
import LobbyActions from "@/components/lobby/LobbyActions";
import ArcadeLobby from "@/components/lobby/ArcadeLobby";
import LobbyRoomLists from "@/components/lobby/LobbyRoomLists";
import { Button } from "@/components/ui/button";
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
      const room = await apiPost<{ code: string }>("/rooms", {});
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

  const lobbyControls = (
    <>
      <LobbyActions
        roomCode={roomCode}
        onRoomCodeChange={setRoomCode}
        onCreateRoom={() => void handleCreateRoom()}
        onPractice={handlePractice}
        onJoinByCode={handleJoinByCode}
      />
      {isAuthenticated ? (
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
      ) : (
        <div className="arcade-signin">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Partite in tempo reale</p>
            <p className="font-display mt-3 text-3xl font-bold leading-tight">Accedi per vedere i tavoli aperti.</p>
          </div>
          <Button className="shrink-0" onClick={() => setShowAuthDialog(true)}>
            Accedi o registrati <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  );

  return (
    <>
      <Header onAuthenticate={() => setShowAuthDialog(true)} />
      <AuthDialog open={showAuthDialog} onOpenChange={setShowAuthDialog} />
      <ArcadeLobby onPlay={() => void handleCreateRoom()}>
        {lobbyControls}
      </ArcadeLobby>
    </>
  );
};

export default LobbyPage;

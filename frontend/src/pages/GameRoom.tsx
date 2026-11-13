import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Loader2, LogOut, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import AuthErrorState from "@/components/AuthErrorState";
import ConnectionBanner from "@/components/ConnectionBanner";
import Header from "@/components/Header";
import WaitingRoomPlayers from "@/components/rooms/WaitingRoomPlayers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useWaitingRoom } from "@/hooks/useWaitingRoom";
import { apiPost, ApiError } from "@/lib/api";
import { handleActiveRoomConflict } from "@/lib/roomRedirect";
import { waitingRoomSlots } from "@/rooms/waitingRoomState";

const GameRoom = () => {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAuth({ redirectOnFail: `/?join=${roomCode}` });
  const userId = user?.id ?? null;
  const [isUpdating, setIsUpdating] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteUrl = `${window.location.origin}/room/${roomCode}`;

  const handleLoadError = useCallback(
    (error: unknown) => {
      if (handleActiveRoomConflict(error, navigate)) return;
      if (error instanceof ApiError) {
        if (error.status === 404) {
          toast.error("Stanza non trovata");
        } else if (error.status === 403) {
          toast.error("Non sei un giocatore in questa stanza");
        } else {
          toast.error("Errore nel caricamento della stanza");
        }
      } else {
        console.error("Error fetching room:", error);
        toast.error("Impossibile caricare i dati della stanza");
      }
      navigate("/");
    },
    [navigate],
  );

  const handleLeaveError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("La partita è già iniziata: ti riportiamo al tavolo.");
        navigate(`/game/${roomCode}`);
        return;
      }
      console.error("Errore nel lasciare la stanza:", error);
      toast.error("Errore nel lasciare la stanza");
    },
    [navigate, roomCode],
  );

  const {
    room,
    isLoading,
    gameStarted,
    connectionStatus,
    leaveWaitingRoom,
    setPlayerReady,
    setPlayerTeam,
    configureBots,
  } = useWaitingRoom({
    roomCode,
    userId,
    onLoadError: handleLoadError,
    onLeaveError: handleLeaveError,
  });
  const myPlayer =
    room?.players.find((player) => player.userId === userId) ?? null;
  const playerSlots = waitingRoomSlots(room, userId);

  useEffect(() => {
    if ((!gameStarted && !room?.started) || !roomCode) return;

    toast.success("La partita sta per iniziare! Ti portiamo al tavolo.");
    navigate(`/game/${roomCode}`);
  }, [gameStarted, room?.started, navigate, roomCode]);

  const handleReady = async () => {
    if (!myPlayer || !userId || isUpdating) return;
    const isReady = !myPlayer.isReady;

    setIsUpdating(true);
    try {
      const data = await apiPost<{ allReady?: boolean }>(
        `/rooms/${roomCode}/ready`,
        { isReady },
      );
      setPlayerReady(userId, isReady);
      toast.success(isReady ? "Sei pronto!" : "Non più pronto");

      if (data.allReady && (room?.players.length === 4 || room?.botTier)) {
        toast.success("Tutti pronti! La partita sta per iniziare...");
      }
    } catch (error) {
      console.error("Error setting ready:", error);
      toast.error(
        error instanceof ApiError && error.status === 503
          ? "Bot non disponibili. Riprova tra poco."
          : error instanceof Error
            ? error.message
            : "Errore nell'impostare lo stato",
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleConfigureBots = async (tier: string | null) => {
    setIsUpdating(true);
    try {
      await configureBots(tier);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Errore nella configurazione dei bot",
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleShareLink = async () => {
    if (!navigator.clipboard?.writeText) {
      setInviteOpen(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Link di invito copiato!");
    } catch {
      toast.error("Copia automatica non riuscita. Copia il link qui sotto.");
      setInviteOpen(true);
    }
  };

  const handleLeaveRoom = async () => {
    if (await leaveWaitingRoom()) {
      toast.success("Hai lasciato la stanza");
      navigate("/");
    }
  };

  const handleChooseTeam = async (team: number) => {
    if (!userId) return;

    try {
      await apiPost(`/rooms/${roomCode}/choose-team`, { team });
      setPlayerTeam(userId, team);
      toast.success(`Sei nella squadra ${team + 1}!`);
    } catch (error) {
      console.error("Error choosing team:", error);
      toast.error(
        error instanceof Error ? error.message : "Errore nella scelta della squadra",
      );
    }
  };

  if (authError) {
    return <AuthErrorState onRetry={retryAuth} />;
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="bg-gradient-card border-border/50">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground text-lg">
              Caricamento stanza...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="bg-gradient-card border-border/50">
          <CardContent className="p-8 text-center">
            <p className="text-destructive text-lg">Stanza non trovata</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const team0Players = room.players.filter((player) => player.team === 0).length;
  const team1Players = room.players.filter((player) => player.team === 1).length;

  return (
    <div className="circolo-shell">
      <ConnectionBanner status={connectionStatus} />
      <Header onBeforeNavigate={leaveWaitingRoom} />

      <div className="arcade-waiting-room container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-4xl mx-auto animate-fade-in">
          <Card className="circolo-surface mb-8">
            <CardHeader>
              <CardTitle className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Users className="h-6 w-6 text-primary" />
                  <div>
                    <span data-testid="room-code-display">Stanza: {roomCode}</span>
                    <p className="text-sm font-normal text-muted-foreground mt-1">
                      Giocatori: {room.players.length} / 4
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleShareLink()}
                  className="gap-2"
                >
                  <Share2 className="h-4 w-4" />
                  Condividi link
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-center">
                {room.started
                  ? "La partita è iniziata!"
                  : "In attesa che tutti i giocatori siano pronti..."}
              </p>
              {myPlayer?.team === null && (
                <Card className="circolo-surface mt-6">
                  <CardContent className="p-6 text-center">
                    <p className="text-muted-foreground mb-4">
                      Scegli una squadra prima di poterti mettere pronto
                    </p>
                    <div className="flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
                      <Button
                        variant="outline"
                        onClick={() => void handleChooseTeam(0)}
                        disabled={team0Players >= 2}
                        data-testid="team-0-button"
                      >
                        Squadra 1 ({team0Players}/2)
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleChooseTeam(1)}
                        disabled={team1Players >= 2}
                        data-testid="team-1-button"
                      >
                        Squadra 2 ({team1Players}/2)
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="mt-6 space-y-2">
                <label htmlFor="room-bot-tier" className="block text-sm font-medium">
                  Completa i posti liberi con bot
                </label>
                <select
                  id="room-bot-tier"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={room.botTier ?? ""}
                  disabled={isUpdating || room.started}
                  onChange={(event) => void handleConfigureBots(event.target.value || null)}
                  aria-describedby="room-bot-description"
                >
                  <option value="">No, aspettiamo altri giocatori</option>
                  <option value="facile">Facile</option>
                  <option value="medio">Medio</option>
                  <option value="forte">Forte</option>
                  <option value="esperto">Esperto</option>
                </select>
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {room.botTier ? "Partita classificata · dettagli" : "Come funzionano i bot"}
                  </summary>
                  <p id="room-bot-description" className="text-sm text-muted-foreground">
                    {room.botTier
                      ? "I bot entrano quando tutti sono pronti. Prima, ogni posto resta libero per un amico. La partita conta per la classifica e non si può mettere in pausa. Cambiare difficoltà azzera i pronti."
                      : "Potete partire anche in meno di quattro. Cambiare questa impostazione azzera i pronti."}
                  </p>
                </details>
              </div>
            </CardContent>
          </Card>

          <WaitingRoomPlayers players={playerSlots} currentUserId={userId} />

          <div className="grid sm:grid-cols-2 gap-4">
            <Button
              variant={myPlayer?.isReady ? "secondary" : "gradient"}
              size="lg"
              onClick={() => void handleReady()}
              className="w-full"
              disabled={!myPlayer || myPlayer.team === null || isUpdating}
              data-testid="ready-button"
            >
              {isUpdating ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Check className="mr-2 h-5 w-5" />
              )}
              {isUpdating ? "Preparo il tavolo..." : myPlayer?.isReady ? "Non pronto" : "Sono pronto!"}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full border-destructive/50 hover:bg-destructive/10 text-destructive"
              onClick={() => void handleLeaveRoom()}
              data-testid="leave-room-button"
            >
              <LogOut className="mr-2 h-5 w-5" />
              Lascia la stanza
            </Button>
          </div>
        </div>
      </div>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invita i tuoi amici</DialogTitle>
            <DialogDescription>Seleziona e copia il link, oppure condividi il codice {roomCode}.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Link di invito" value={inviteUrl} readOnly onFocus={(event) => event.target.select()} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GameRoom;

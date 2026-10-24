import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, Layers3, Loader2, MessageCircle, Radio, Users } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import AuthDialog from "@/components/AuthDialog";
import AuthErrorState from "@/components/AuthErrorState";
import Header from "@/components/Header";
import LobbyActions from "@/components/lobby/LobbyActions";
import LobbyHero from "@/components/lobby/LobbyHero";
import ArcadeLobby from "@/components/lobby/ArcadeLobby";
import LobbyRoomLists from "@/components/lobby/LobbyRoomLists";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useLobbyRooms } from "@/hooks/useLobbyRooms";
import { apiPost } from "@/lib/api";
import { handleActiveRoomConflict } from "@/lib/roomRedirect";

const gameSignals = [
  ["Striscio", "La mano parla prima della carta.", "/images/cards/asso_denari.png"],
  ["Busso", "Alza la posta quando è il momento.", "/images/cards/tre_spade.png"],
  ["Volo", "Fidati del socio. Lascia andare.", "/images/cards/cavallo_coppe.png"],
];

const LobbyPage = () => {
  const navigate = useNavigate();
  const { theme = "arcade" } = useTheme();
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
        <div className="arcade-signin flex min-h-72 flex-col justify-between rounded-2xl border border-dashed border-border bg-card p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Partite in tempo reale</p>
            <p className="font-display mt-3 text-3xl font-bold leading-tight">Accedi per vedere i tavoli aperti.</p>
          </div>
          <Button className="mt-6 w-fit" onClick={() => setShowAuthDialog(true)}>
            Accedi o registrati <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  );

  if (theme !== "classic") {
    return (
      <>
        <Header onAuthenticate={() => setShowAuthDialog(true)} />
        <AuthDialog open={showAuthDialog} onOpenChange={setShowAuthDialog} />
        <ArcadeLobby onPlay={() => void handleCreateRoom()}>
          {lobbyControls}
        </ArcadeLobby>
      </>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#061d20] text-[#fff8ec]">
      <Header variant="landing" onAuthenticate={() => setShowAuthDialog(true)} />
      <AuthDialog open={showAuthDialog} onOpenChange={setShowAuthDialog} />

      <LobbyHero
        isAuthenticated={isAuthenticated}
        onCreateRoom={() => void handleCreateRoom()}
        onPractice={handlePractice}
        onAuthenticate={() => setShowAuthDialog(true)}
      />

      <main>
        <section id="entra-al-tavolo" className="relative bg-[#f8f2e5] px-5 py-20 text-[#102322] sm:py-28">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,#061d20,transparent)]" />
          <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
            <div className="lg:sticky lg:top-28">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#a66b16]">Trova il tuo posto</p>
              <h2 className="font-display mt-4 max-w-md text-5xl font-bold leading-[0.9] tracking-[-0.055em] sm:text-6xl">
                La partita parte da qui.
              </h2>
              <p className="mt-6 max-w-md text-base leading-7 text-[#4b5e54]">
                Crea un tavolo privato, entra con il codice degli amici o allena lo sguardo contro i bot.
              </p>
              <div className="mt-9 hidden items-center gap-3 text-sm font-semibold text-[#355547] lg:flex">
                <span className="h-px w-10 bg-[#c7984c]" />
                Pronto quando lo sei tu.
              </div>
            </div>
            <div className="relative rounded-[2rem] border border-[#d3bc8d] bg-[#fffaf0] p-3 shadow-[0_30px_80px_rgba(31,38,30,.15)] sm:p-6">
              <div className="mb-5 flex items-center justify-between rounded-[1.3rem] bg-[#123d36] px-5 py-4 text-[#fff7e8]">
                <div>
                  <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-[#e9c674]">Sala di gioco</p>
                  <p className="font-display mt-1 text-2xl font-bold">Scegli il tuo ingresso</p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-full border border-[#e9c674]/40 bg-[#e9c674]/10 text-sm font-bold">B</span>
              </div>
              <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
                {lobbyControls}
              </div>
            </div>
          </div>
        </section>

        <section id="come-si-gioca" className="relative overflow-hidden bg-[#0a2d2e] px-5 py-20 sm:py-28">
          <div className="pointer-events-none absolute left-1/2 top-0 h-80 w-[46rem] -translate-x-1/2 rounded-full bg-[#2c926a]/20 blur-[100px]" />
          <div className="relative mx-auto max-w-7xl">
            <div className="flex max-w-3xl flex-col gap-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#efc66f]">Non è solo una mano</p>
              <h2 className="font-display text-5xl font-bold leading-[0.9] tracking-[-0.055em] text-[#fff8ec] sm:text-6xl">
                Quattro menti. Una conversazione senza parole.
              </h2>
            </div>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {gameSignals.map(([title, description, image], index) => (
                <article key={title} className={`group relative min-h-[23rem] overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0f403c] p-7 ${index === 1 ? "lg:-translate-y-8" : ""}`}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_8%,rgba(240,188,91,.22),transparent_28%),linear-gradient(145deg,rgba(255,255,255,.04),transparent_48%)]" />
                  <img src={image} alt="" className="absolute -bottom-12 -right-7 w-52 rotate-[15deg] opacity-85 transition-transform duration-700 group-hover:-translate-y-5 group-hover:-rotate-[2deg] group-hover:scale-105" />
                  <div className="relative flex h-full flex-col justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-full border border-[#f2c56f]/35 bg-[#f2c56f]/10 text-sm font-bold text-[#f2c56f]">0{index + 1}</span>
                    <div className="max-w-[13rem]">
                      <h3 className="font-display text-4xl font-bold tracking-[-0.04em] text-[#fff8ec]">{title}</h3>
                      <p className="mt-3 text-sm leading-6 text-[#ced8ca]">{description}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#061d20] px-5 py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [Users, "Quattro giocatori", "Ogni posizione al tavolo è parte della strategia."],
                [Layers3, "Due squadre", "La presa vale di più quando il socio legge il tuo gioco."],
                [Eye, "Una briscola", "Un seme cambia il peso di ogni carta."],
                [MessageCircle, "Segnali reali", "Striscio, busso e volo diventano il vostro linguaggio."],
              ].map(([Icon, title, description]) => {
                const FeatureIcon = Icon as typeof Users;
                return (
                  <article key={title as string} className="rounded-2xl border border-white/10 bg-white/[0.045] p-6 backdrop-blur-sm transition-transform duration-300 hover:-translate-y-1 hover:bg-white/[0.075]">
                    <FeatureIcon className="h-5 w-5 text-[#f0bc5b]" aria-hidden="true" />
                    <h3 className="font-display mt-12 text-2xl font-bold text-[#fff8ec]">{title as string}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#c7d4c5]">{description as string}</p>
                  </article>
                );
              })}
            </div>
            <div className="lg:pl-10">
              <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-[#efc66f]">
                <Radio className="h-4 w-4" aria-hidden="true" />
                Multiplayer in tempo reale
              </div>
              <h2 className="font-display mt-5 text-5xl font-bold leading-[0.9] tracking-[-0.055em] text-[#fff8ec] sm:text-6xl">
                Siediti.
                <span className="block text-[#a7e7bd]">Gioca la mano.</span>
              </h2>
              <p className="mt-7 max-w-lg text-base leading-7 text-[#c7d4c5]">
                Crea una stanza, chiama il socio e affronta una partita in cui ogni presa lascia il segno.
              </p>
              <Button size="lg" onClick={() => void handleCreateRoom()} className="mt-9 h-13 rounded-full bg-[#f0bc5b] px-7 text-[#09201f] hover:bg-[#ffe0a0]">
                Crea una stanza <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default LobbyPage;

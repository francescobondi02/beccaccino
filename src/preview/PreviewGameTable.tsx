import { useRef, useState } from "react";
import { ArrowLeft, CircleHelp, Pause, Play, RotateCcw } from "lucide-react";
import GameBoard from "@/components/game/GameBoard";
import GameScoreHeader from "@/components/game/GameScoreHeader";
import SignalDialog from "@/components/SignalDialog";
import ArcadeRules from "@/components/lobby/ArcadeRules";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { PlayedCardData, PlayerCard, Signal } from "@/game/model";
import { positionPlayers } from "@/game/presentation";

const players = positionPlayers(
  ["Alex (tu)", "Luca", "Giulia", "Marta"].map((username, seat) => ({
    id: seat + 1, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
  })),
  1,
);

const hand: PlayerCard[] = [
  ["denara", "asso"], ["spade", "tre"], ["coppe", "re"], ["bastoni", "cavallo"],
  ["denara", "due"], ["denara", "re"], ["bastoni", "sei"], ["spade", "asso"],
  ["coppe", "tre"], ["spade", "sette"],
].map(([suit, value], index) => ({
  id: index + 1, suit, value, playerId: 1, roundId: 1, inHand: true,
}));

interface PreviewGameTableProps {
  room: string;
  onBack: () => void;
  effectsEnabled: boolean;
  motionStopped: boolean;
  onToggleEffects: () => void;
}

export default function PreviewGameTable({
  room, onBack, effectsEnabled, motionStopped, onToggleEffects,
}: PreviewGameTableProps) {
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [pendingCard, setPendingCard] = useState<PlayerCard | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [complete, setComplete] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [calloutsOpen, setCalloutsOpen] = useState(false);
  const [speakerId, setSpeakerId] = useState(1);
  const resetButton = useRef<HTMLButtonElement>(null);
  const playedCards: PlayedCardData[] = card ? [{
    playerId: 1, userId: 1, suit: card.suit, value: card.value, position: 0,
  }] : [];

  if (card && complete) {
    const values = ["quattro", "cinque", "sei", "sette"].filter((value) => value !== card.value);
    players.filter((player) => !player.isLocalPlayer).forEach((player, index) => {
      playedCards.push({
        playerId: player.id, userId: player.userId,
        suit: card.suit, value: values[index], position: index + 1,
      });
    });
  }

  const reset = () => {
    setCard(null);
    setPendingCard(null);
    setSignal(null);
    setComplete(false);
    setSpeakerId(1);
  };

  return (
    <main className="club-preview club-match-preview circolo-shell relative" lang="it" data-motion={motionStopped ? "off" : "on"}>
      <h1 className="sr-only" tabIndex={-1}>{room} · Tavolo demo</h1>
      <GameScoreHeader
        roomCode="DEMO" briscola="denara" roundNumber={3} handNumber={1}
        playerTeam={0} totalPoints={{ team0Points: 24, team1Points: 18, team0Figures: 0, team1Figures: 0 }}
      />
      <GameBoard
        players={players} currentTurnUserId={card ? null : 1}
        currentSignal={signal ? { userId: speakerId, signal } : null}
        countdown={null} playedCards={playedCards} briscola="denara"
        callerUserId={1} currentUserId={1}
        hand={hand.filter((item) => item.id !== card?.id)}
        playableCards={hand} onCardClick={setPendingCard}
      />
      <aside className="club-match-controls" aria-label="Comandi del tavolo demo">
        <span className="club-eyebrow">DEMO · NESSUNA PARTITA REALE</span>
        <p className="club-match-status" role="status" aria-live="polite">
          {!card ? "Gioca una carta, poi completa la presa." : complete
            ? `Presa completa: quattro carte in tavola${signal ? ` · ${signal}` : ""}.`
            : `La tua carta è in tavola${signal ? ` · ${signal}` : ""}. Fai giocare gli altri tre.`}
        </p>
        <Button disabled={!card || complete} onClick={() => setComplete(true)}>Completa la presa</Button>
        <Dialog open={calloutsOpen} onOpenChange={(open) => {
          setCalloutsOpen(open);
          if (open) setSignal(null);
        }}>
          <DialogTrigger asChild><Button variant="secondary">Fumetti</Button></DialogTrigger>
          <DialogContent className="max-w-[calc(100%_-_32px)] sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Fai parlare il tavolo.</DialogTitle>
              <DialogDescription>Prova i fumetti da ogni posto. Solo una simulazione, senza azioni sul server.</DialogDescription>
            </DialogHeader>
            <label className="grid gap-2 text-sm font-medium">
              Chi parla?
              <select className="h-11 rounded-md border border-input bg-background px-3" value={speakerId} onChange={(event) => setSpeakerId(Number(event.target.value))}>
                {players.map((player) => <option key={player.userId} value={player.userId}>{player.username}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["striscio", "busso", "volo"] as const).map((item) => (
                <Button key={item} className="signal-demo-button" data-signal={item} onClick={() => {
                  setSignal(item);
                  setCalloutsOpen(false);
                }}>{item}</Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
        <Button ref={resetButton} variant="secondary" onClick={reset}><RotateCcw size={16} /> Ricomincia</Button>
        <Button variant="secondary" onClick={() => setRulesOpen(true)}><CircleHelp size={16} /> Regole</Button>
        <Button variant="ghost" aria-pressed={effectsEnabled} onClick={onToggleEffects}>
          {effectsEnabled ? <Pause size={16} /> : <Play size={16} />}
          {effectsEnabled ? "Pausa effetti" : "Attiva effetti"}
        </Button>
        <Button variant="ghost" onClick={onBack}><ArrowLeft size={16} /> Tutti i tavoli</Button>
      </aside>
      {pendingCard && <SignalDialog open onOpenChange={(open) => {
        if (!open) setPendingCard(null);
      }} onSelect={(selectedSignal) => {
        setSpeakerId(1);
        setSignal(selectedSignal);
        setCard(pendingCard);
        setPendingCard(null);
        requestAnimationFrame(() => resetButton.current?.focus());
      }} />}
      <ArcadeRules open={rulesOpen} onOpenChange={setRulesOpen} />
    </main>
  );
}

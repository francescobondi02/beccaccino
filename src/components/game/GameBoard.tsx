import PlayerSeat from "@/components/PlayerSeat";
import PlayingCard from "@/components/PlayingCard";
import TableCenter from "@/components/TableCenter";
import type {
  PlayedCardData,
  PlayerCard,
  Signal,
} from "@/game/model";
import type { PositionedPlayer } from "@/game/presentation";

interface GameBoardProps {
  players: PositionedPlayer[];
  currentTurnUserId: number | null;
  currentSignal: { userId: number; signal: Signal } | null;
  countdown: number | null;
  playedCards: PlayedCardData[];
  briscola: string | null | undefined;
  callerUserId: number | null;
  currentUserId: number | null;
  hand: PlayerCard[];
  playableCards: PlayerCard[];
  onCardClick: (card: PlayerCard) => void;
}

export default function GameBoard({
  players,
  currentTurnUserId,
  currentSignal,
  countdown,
  playedCards,
  briscola,
  callerUserId,
  currentUserId,
  hand,
  playableCards,
  onCardClick,
}: GameBoardProps) {
  const playerAt = (position: PositionedPlayer["position"]) =>
    players.find((player) => player.position === position);
  const topPlayer = playerAt("top");
  const leftPlayer = playerAt("left");
  const rightPlayer = playerAt("right");
  const bottomPlayer = playerAt("bottom");
  const waitingUserId = briscola === null ? callerUserId : currentTurnUserId;
  const waitingForUsername =
    players.find((player) => player.userId === waitingUserId)?.username ??
    "giocatore";

  const signalFor = (userId: number): Signal | null =>
    currentSignal?.userId === userId ? currentSignal.signal : null;

  return (
    <div
      className="container mx-auto h-screen flex flex-col items-center pt-32 pb-4 px-4"
      data-testid="game-layout"
    >
      <div className="flex-1 min-h-0 flex items-center justify-center w-full">
        <div className="relative w-full h-full max-h-[34rem] max-w-[50rem] flex items-center justify-center">
          <div
            className="absolute left-1/2 top-0 -translate-x-1/2"
            data-testid="player-position-top"
          >
            {topPlayer && (
              <PlayerSeat
                testId="player-seat-top"
                player={topPlayer}
                isTurn={currentTurnUserId === topPlayer.userId}
                showRole
                countdown={countdown}
                signal={signalFor(topPlayer.userId)}
              />
            )}
          </div>

          <div
            className="absolute left-8 top-1/2 -translate-y-1/2"
            data-testid="player-position-left"
          >
            {leftPlayer && (
              <PlayerSeat
                player={leftPlayer}
                isTurn={currentTurnUserId === leftPlayer.userId}
                showRole
                signal={signalFor(leftPlayer.userId)}
              />
            )}
          </div>

          <div
            className="absolute right-8 top-1/2 -translate-y-1/2"
            data-testid="player-position-right"
          >
            {rightPlayer && (
              <PlayerSeat
                player={rightPlayer}
                isTurn={currentTurnUserId === rightPlayer.userId}
                showRole
                signal={signalFor(rightPlayer.userId)}
              />
            )}
          </div>

          <TableCenter
            cards={playedCards.map((card) => ({
              userId: card.userId,
              suit: card.suit,
              value: card.value,
              position:
                players.find((player) => player.userId === card.userId)
                  ?.position ?? "bottom",
            }))}
            briscolaChosen={Boolean(briscola)}
            waitingForUsername={waitingForUsername}
            countdown={countdown}
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 w-full">
        <div
          className="flex gap-2 xl:gap-1 flex-wrap justify-center max-w-5xl"
          data-testid="player-hand"
        >
          {hand
            .filter((card) => card.inHand)
            .map((card) => {
              const isPlayable = playableCards.some(
                (playable) =>
                  playable.suit === card.suit &&
                  playable.value === card.value,
              );
              const isCurrentTurn = currentTurnUserId === currentUserId;

              return (
                <PlayingCard
                  key={card.id}
                  suit={card.suit}
                  value={card.value}
                  onClick={() => onCardClick(card)}
                  size="lg"
                  className="xl:w-[5.5rem] xl:h-[7.75rem] xl:hover:scale-105"
                  clickable={isCurrentTurn && isPlayable}
                  disabled={!isCurrentTurn || !isPlayable}
                  data-testid={`hand-card-${card.suit}-${card.value}`}
                />
              );
            })}
        </div>

        {bottomPlayer && (
          <PlayerSeat
            testId="player-seat-bottom"
            player={bottomPlayer}
            isTurn={currentTurnUserId === bottomPlayer.userId}
          />
        )}
      </div>
    </div>
  );
}

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import PlayerSeat from "@/components/PlayerSeat";
import PlayingCard from "@/components/PlayingCard";
import TableCenter from "@/components/TableCenter";
import SignalCallout from "./SignalCallout";
import type { Card, Signal } from "@contract/cards";
import type { PlayedCard } from "@contract/game";
import type { RoundDealView } from "@/game/model";
import { cardKey, type PositionedPlayer } from "@/game/presentation";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface GameBoardProps {
  players: PositionedPlayer[];
  currentTurnUserId: number | null;
  currentSignal: { userId: number; signal: Signal; cardKey?: string } | null;
  countdown: number | null;
  playedCards: PlayedCard[];
  briscola: string | null | undefined;
  callerUserId: number | null;
  currentUserId: number | null;
  hand: Card[];
  playableCards: Card[];
  onCardClick: (card: Card) => void;
  deal?: RoundDealView;
  animatedCard?: PlayedCard | null;
  completedTrick?: { winnerUserId: number; cards: PlayedCard[] } | null;
  fastCollection?: boolean;
  notice?: string | null;
  children?: ReactNode;
}

function travelOffset(from: DOMRect, to: DOMRect) {
  return `translate(${from.x + from.width / 2 - to.x - to.width / 2}px, ${from.y + from.height / 2 - to.y - to.height / 2}px)`;
}

function CardDeal({ deal }: { deal: RoundDealView }) {
  const [elapsed] = useState(() => Math.max(0, Date.now() - deal.startedAt));
  const positions = ["bottom", "left", "top", "right"];
  return (
    <div className="arcade-card-deal" aria-hidden="true" data-testid="card-deal">
      <span className="arcade-deal-deck" />
      {Array.from({ length: 40 }, (_, index) => (
        <span
          key={index}
          className="arcade-dealt-card"
          data-position={positions[index % 4]}
          style={{ animationDelay: `${index * (deal.animationMs - 300) / 40 - elapsed}ms` }}
        />
      ))}
    </div>
  );
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
  deal,
  animatedCard,
  completedTrick,
  fastCollection = false,
  notice,
  children,
}: GameBoardProps) {
  const board = useRef<HTMLDivElement>(null);
  const cardOrigin = useRef<{ key: string; rect: DOMRect } | null>(null);
  const lastAnimatedCard = useRef(animatedCard);
  const animations = useRef(new Set<Animation>());
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const active = animations.current;
    return () => {
      active.forEach((animation) => animation.cancel());
      active.clear();
    };
  }, [reducedMotion]);

  useLayoutEffect(() => {
    if (!animatedCard || lastAnimatedCard.current === animatedCard) return;
    lastAnimatedCard.current = animatedCard;
    if (reducedMotion) return;
    const slot = board.current?.querySelector<HTMLElement>(`[data-card-user-id="${animatedCard.userId}"]`);
    const element = slot?.firstElementChild;
    const seat = board.current?.querySelector(`[data-player-user-id="${animatedCard.userId}"]`);
    const origin = cardOrigin.current?.key === cardKey(animatedCard) && animatedCard.userId === currentUserId
      ? cardOrigin.current.rect : seat?.getBoundingClientRect();
    cardOrigin.current = null;
    if (!slot || !element?.animate || !origin) return;
    const animation = element.animate([
      { transform: `${travelOffset(origin, slot.getBoundingClientRect())} rotate(-12deg) scale(.65)`, opacity: .3 },
      { transform: "none", opacity: 1 },
    ], { duration: 420, easing: "cubic-bezier(.16,1,.3,1)" });
    animations.current.add(animation);
    animation.onfinish = () => animations.current.delete(animation);
  }, [animatedCard, currentUserId, reducedMotion]);

  useLayoutEffect(() => {
    if (!completedTrick || reducedMotion) return;
    const seat = board.current?.querySelector(`[data-player-user-id="${completedTrick.winnerUserId}"]`);
    if (!seat) return;
    const destination = seat.getBoundingClientRect();
    const collection: Animation[] = [];
    const active = animations.current;
    completedTrick.cards.forEach((card, index) => {
      const slot = board.current?.querySelector<HTMLElement>(`[data-card-user-id="${card.userId}"]`);
      const element = slot?.firstElementChild;
      if (!slot || !element?.animate) return;
      const animation = element.animate([
        { transform: "none", opacity: 1 },
        { transform: `${travelOffset(destination, slot.getBoundingClientRect())} rotate(12deg) scale(.2)`, opacity: 0 },
      ], {
        duration: fastCollection ? 350 : 650,
        delay: (fastCollection ? 500 : 1800) + index * (fastCollection ? 30 : 40),
        easing: "cubic-bezier(.4,0,.2,1)",
        fill: "forwards",
      });
      collection.push(animation);
      active.add(animation);
    });
    return () => collection.forEach((animation) => {
      animation.cancel();
      active.delete(animation);
    });
  }, [completedTrick, fastCollection, reducedMotion]);

  const playerAt = (position: PositionedPlayer["position"]) =>
    players.find((player) => player.position === position);
  const topPlayer = playerAt("top");
  const leftPlayer = playerAt("left");
  const rightPlayer = playerAt("right");
  const bottomPlayer = playerAt("bottom");
  const localBotControlled = Boolean(bottomPlayer?.botModel);
  const presentingHand = deal && deal.phase !== "ready";
  const usernameOf = (userId: number | null | undefined) =>
    players.find((player) => player.userId === userId)?.username ?? "Giocatore";
  const statusText = completedTrick
    ? `Presa a ${usernameOf(completedTrick.winnerUserId)}`
    : deal?.phase === "collecting"
      ? "Raccolta delle carte..."
      : deal?.phase === "dealing"
        ? "Distribuzione delle carte..."
        : deal?.phase === "reviewing"
          ? "Guarda le tue carte"
          : briscola === null
            ? callerUserId === currentUserId
              ? localBotControlled ? "Il bot sceglie la briscola al tuo posto" : "Scegli la briscola"
              : `${usernameOf(callerUserId)} sceglie la briscola`
            : currentTurnUserId === null
              ? "Aggiornamento della partita..."
              : currentTurnUserId === currentUserId
                ? localBotControlled ? "Il bot gioca al tuo posto" : "Tocca a te"
                : `Tocca a ${usernameOf(currentTurnUserId)}`;

  const signalFor = (userId: number): Signal | null =>
    currentSignal?.userId === userId ? currentSignal.signal : null;

  const calloutFor = (player: PositionedPlayer) => {
    const signal = signalFor(player.userId);
    return signal ? (
      <SignalCallout
        key={`${currentSignal?.cardKey ?? ""}-${signal}`}
        signal={signal}
        position={player.position}
        username={player.username}
      />
    ) : null;
  };

  const handCards = hand.map((card, index) => {
      const isPlayable = playableCards.some(
        (playable) => playable.suit === card.suit && playable.value === card.value,
      );
      const isCurrentTurn = currentTurnUserId === currentUserId;
      return (
        <PlayingCard
          key={cardKey(card)}
          suit={card.suit}
          value={card.value}
          onClick={() => {
            const element = board.current?.querySelector(`[data-testid="hand-card-${cardKey(card)}"]`);
            if (element) cardOrigin.current = {
              key: cardKey(card),
              rect: element.getBoundingClientRect(),
            };
            onCardClick(card);
          }}
          size="lg"
          className={`xl:w-[5.5rem] xl:h-[7.75rem] xl:hover:scale-105 ${
            presentingHand
              ? index < deal.dealtCards
                ? "arcade-deal-revealed !opacity-100 !grayscale-0"
                : "invisible"
              : ""
          }`}
          clickable={isCurrentTurn && isPlayable}
          disabled={!isCurrentTurn || !isPlayable}
          data-testid={`hand-card-${cardKey(card)}`}
        />
      );
    });

  return (
    <div
      ref={board}
      className="arcade-game-layout container mx-auto flex flex-col items-center"
      data-testid="game-layout"
    >
      <div className="flex-1 min-h-0 flex items-center justify-center w-full">
        <div className="arcade-arena relative flex w-full items-center justify-center">
          <span className="arcade-table-mark" aria-hidden="true">BECCA!</span>
          <div
            className="absolute left-1/2 top-0 z-10 -translate-x-1/2"
            data-testid="player-position-top"
            data-player-user-id={topPlayer?.userId}
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
            {topPlayer && calloutFor(topPlayer)}
          </div>

          <div
            className="absolute left-8 top-1/2 z-10 -translate-y-1/2"
            data-testid="player-position-left"
            data-player-user-id={leftPlayer?.userId}
          >
            {leftPlayer && (
              <PlayerSeat
                player={leftPlayer}
                isTurn={currentTurnUserId === leftPlayer.userId}
                showRole
                signal={signalFor(leftPlayer.userId)}
              />
            )}
            {leftPlayer && calloutFor(leftPlayer)}
          </div>

          <div
            className="absolute right-8 top-1/2 z-10 -translate-y-1/2"
            data-testid="player-position-right"
            data-player-user-id={rightPlayer?.userId}
          >
            {rightPlayer && (
              <PlayerSeat
                player={rightPlayer}
                isTurn={currentTurnUserId === rightPlayer.userId}
                showRole
                signal={signalFor(rightPlayer.userId)}
              />
            )}
            {rightPlayer && calloutFor(rightPlayer)}
          </div>

          <TableCenter
            winnerUserId={completedTrick?.winnerUserId}
            cards={playedCards.map((card) => ({
              userId: card.userId,
              suit: card.suit,
              value: card.value,
              position:
                players.find((player) => player.userId === card.userId)
                  ?.position ?? "bottom",
            }))}
          >
            <div className="arcade-table-status" data-testid="table-status">
              <div role="status" aria-live="polite" aria-atomic="true">
                <p className="font-semibold">{statusText}</p>
                <p className="arcade-table-notice">
                  {[currentSignal && `${usernameOf(currentSignal.userId)} dichiara ${currentSignal.signal}`, notice]
                    .filter(Boolean).join(" · ") || "\u00a0"}
                </p>
              </div>
              {countdown !== null && !completedTrick && !presentingHand && (
                <span
                  aria-label={`${countdown} secondi rimanenti`}
                  className={`shrink-0 font-bold tabular-nums ${countdown <= 10 ? "text-destructive" : "text-primary"}`}
                >
                  {countdown}s
                </span>
              )}
            </div>
          </TableCenter>
          {deal?.phase === "dealing" && (
            <CardDeal key={deal.startedAt} deal={deal} />
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 w-full">
        <div
          className="flex max-w-5xl flex-wrap justify-center gap-2"
          data-testid="player-hand"
        >
          {hand.length === 0 && (
            <div
              aria-hidden="true"
              className="h-28 w-20 xl:h-[7.75rem] xl:w-[5.5rem]"
            />
          )}
          {handCards}
        </div>

        {bottomPlayer && (
          <div className="relative z-10" data-player-user-id={bottomPlayer.userId}>
            <PlayerSeat
              testId="player-seat-bottom"
              player={bottomPlayer}
              isTurn={currentTurnUserId === bottomPlayer.userId}
            />
            {calloutFor(bottomPlayer)}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

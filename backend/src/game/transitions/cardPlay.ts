import { GameError } from "../../utils/gameError";
import { selectLegalCards } from "../../domain/game/legalCards";
import { resolvePlay } from "../../domain/game/resolvePlay";
import { currentTurn } from "../../domain/game/turnOrder";
import { CardSignal, Suit, Value } from "../../domain/game/cards";
import { logger } from "../../logger";
import { runGameAction } from "../runGameAction";
import { assertPlayerControl, isStale, recordTurn, setupRound, TurnAction } from "./round";

// Without a card the server plays the first legal one (timeout, bot fallback).
export function playCard(
  action: TurnAction & { card?: { suit: Suit; value: Value }; signal?: CardSignal | null },
) {
  return runGameAction(
    action.roomCode,
    async (game, tx) => {
      if (isStale(game, action)) return null;
      const { room, round, trick } = game;
      if (!room.started) throw new GameError("Room not found or game not started", 404);
      if (room.finished) throw new GameError("Game is already finished", 400);
      const player = game.players.find((candidate) => candidate.userId === action.userId);
      if (!player) throw new GameError("It's not this player's turn", 403);
      assertPlayerControl(player, action.source);
      if (room.pausedAt) throw new GameError("Practice game is paused", 409);
      if (!round || !trick) throw new GameError("No active round or trick found", 400);
      if (currentTurn(game)?.player.id !== player.id) {
        throw new GameError("It's not this player's turn", 403);
      }

      const card =
        action.card ??
        selectLegalCards(game.hands.get(player.id) ?? [], trick.cards[0]?.suit ?? null)[0];
      const result = resolvePlay(game, player.id, card);
      const position = trick.cards.length;
      const signal = position === 0 ? action.signal ?? null : null;
      const takeover = await recordTurn(tx, game, player, action.source);
      await tx.handCard.deleteMany({
        where: { playerId: player.id, roundId: round.id, suit: card.suit, value: card.value },
      });
      await tx.playedCard.create({
        data: {
          trickId: trick.id,
          playerId: player.id,
          suit: card.suit,
          value: card.value,
          position,
          signal,
          autoPlayed: action.card === undefined,
        },
      });
      logger.info({ roomCode: room.code, userId: action.userId, ...card, position }, "card_played");

      if (result.trickWinnerId !== undefined) {
        await tx.trick.update({
          where: { id: trick.id },
          data: { winnerId: result.trickWinnerId, completedAt: new Date() },
        });
        if (!result.roundScore) {
          await tx.trick.create({
            data: { roundId: round.id, number: trick.number + 1, starterId: result.trickWinnerId },
          });
        }
      }
      if (result.roundScore) {
        await tx.round.update({ where: { id: round.id }, data: result.roundScore });
        logger.info(
          { roomCode: room.code, roundNumber: round.number, ...result.roundScore, cricca: round.cricca },
          "round_ended",
        );
        if (result.gameWinner != null) {
          await tx.gameRoom.update({
            where: { id: room.id },
            data: { finished: true, winnerTeam: result.gameWinner },
          });
          logger.info({ roomCode: room.code, winnerTeam: result.gameWinner }, "game_finished");
        } else {
          await setupRound(room.id, round.number + 1, tx);
        }
      }
      return {
        kind: "card_played",
        userId: action.userId,
        card,
        signal,
        source: action.source,
        takeover,
      };
    },
    action.source === "human" ? action.userId : undefined,
  );
}

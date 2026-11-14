import { toTeamScore, sumRoundScores } from "../domain/game/gameScore";
import { selectLegalCards } from "../domain/game/legalCards";
import { currentTurn } from "../domain/game/turnOrder";
import { TRICK_DISPLAY_MS, roundDealTimes } from "../gameConfig";
import { turnDeadlineMs } from "../runtime/timeoutPolicy";
import type { LiveGame, LiveTrick } from "./liveGame";
import type { BotTier, Team } from "../contract/cards";
import type { GameState, LastAction, PlayedCard } from "../contract/game";

// The state one player sees. Pure: one loaded game serves every player.
export function toGameState(
  game: LiveGame,
  userId: number,
  now: number,
  lastAction: LastAction | null,
): GameState {
  const { room, players, trick, lastTrick } = game;
  const round = game.round!;
  const userIdOf = (playerId: number) =>
    players.find((player) => player.id === playerId)!.userId;
  const playedCards = (cards: LiveTrick["cards"]): PlayedCard[] =>
    cards.map(({ playerId, ...card }) => ({ userId: userIdOf(playerId), ...card }));

  const me = players.find((player) => player.userId === userId)!;
  const myHand = game.hands.get(me.id) ?? [];
  const deal = roundDealTimes(round);
  const live = !room.finished && !room.pausedAt;
  const turn = live ? currentTurn(game) : null;
  const canPlay =
    turn?.player.id === me.id &&
    turn.phase === "play_card" &&
    me.botModel === null &&
    me.abandonedAt === null;
  const previousRound = game.roundScores.find((score) => score.number === round.number - 1);
  const startedAt = room.turnStartedAt?.getTime() ?? now;

  return {
    roomCode: room.code,
    version: room.version,
    serverTime: new Date(now).toISOString(),
    status: room.finished
      ? "finished"
      : room.pausedAt
        ? "paused"
        : round.briscola === null
          ? "choosing_briscola"
          : "playing",
    isPractice: room.isPractice,
    players: players.map((player) => ({
      userId: player.userId,
      username: player.username,
      isBot: player.isBot,
      seat: player.seat!,
      team: player.team as Team,
      botModel: player.botModel as BotTier | null,
      abandoned: player.abandonedAt !== null,
    })),
    round: {
      number: round.number,
      callerUserId: userIdOf(round.callerId),
      briscola: round.briscola,
      cricca: round.cricca,
      deal:
        round.briscola === null
          ? {
              animationEndsAt: new Date(deal.animationEndsAt).toISOString(),
              reviewEndsAt: new Date(deal.reviewEndsAt).toISOString(),
            }
          : null,
    },
    trick: trick ? { number: trick.number, cards: playedCards(trick.cards) } : null,
    lastTrick: lastTrick
      ? {
          roundNumber: lastTrick.roundNumber,
          trickNumber: lastTrick.number,
          winnerUserId: userIdOf(lastTrick.winnerId!),
          cards: playedCards(lastTrick.cards),
          onTableUntil: new Date(lastTrick.completedAt!.getTime() + TRICK_DISPLAY_MS).toISOString(),
        }
      : null,
    myHand,
    playableCards: canPlay ? selectLegalCards(myHand, trick?.cards[0]?.suit ?? null) : [],
    turn: turn
      ? {
          userId: turn.player.userId,
          phase: turn.phase,
          startedAt: new Date(startedAt).toISOString(),
          deadline:
            turn.player.botModel === null
              ? new Date(turnDeadlineMs(room.turnStartedAt, turn.phase, now)).toISOString()
              : null,
        }
      : null,
    score: sumRoundScores(game.roundScores),
    roundSummary:
      previousRound && now < deal.summaryEndsAt
        ? {
            roundNumber: previousRound.number,
            score: {
              team0: toTeamScore(previousRound.team0Raw),
              team1: toTeamScore(previousRound.team1Raw),
            },
            winnerTeam: previousRound.winnerTeam as Team,
            visibleUntil: new Date(deal.summaryEndsAt).toISOString(),
          }
        : null,
    result: game.result,
    lastAction,
  };
}

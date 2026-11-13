import { BotTier, isBotTier } from "../services/botUsers";

const botSeats = new Map<string, Map<number, BotTier>>();

export function registerBotSeats(
  roomCode: string,
  seats: { userId: number; tier: BotTier }[],
): void {
  botSeats.set(roomCode, new Map(seats.map((seat) => [seat.userId, seat.tier])));
}

export function restoreBotSeats(
  roomCode: string,
  players: { userId: number; botModel: string | null }[],
): void {
  const seats = players
    .filter((player) => isBotTier(player.botModel))
    .map((player) => ({
      userId: player.userId,
      tier: player.botModel as BotTier,
    }));
  registerBotSeats(roomCode, seats);
}

export function botTierForTurn(
  roomCode: string,
  userId: number,
): BotTier | null {
  return botSeats.get(roomCode)?.get(userId) ?? null;
}

export function hasBotSeat(roomCode: string, userId: number): boolean {
  return botSeats.get(roomCode)?.has(userId) ?? false;
}

export function clearBotSeats(roomCode: string): void {
  botSeats.delete(roomCode);
}

export function clearAllBotSeats(): void {
  botSeats.clear();
}

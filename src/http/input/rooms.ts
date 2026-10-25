import { BOT_TIERS, BotTier, isBotTier } from "../../services/botUsers";
import { badRequest } from "../errors";

type Body = Record<string, unknown> | null | undefined;

export function parsePracticeTier(body: Body): BotTier {
  const tier = body?.tier;
  if (!isBotTier(tier)) {
    throw badRequest(
      `Invalid tier: "${tier}". Must be one of: ${BOT_TIERS.join(", ")}`,
    );
  }
  return tier;
}

export function parseRoomBotTier(body: Body): BotTier | null {
  return body?.tier === null ? null : parsePracticeTier(body);
}

export function parseJoinRoom(body: Body): string {
  const roomCode = body?.roomCode;
  if (typeof roomCode !== "string" || roomCode.length === 0) {
    throw badRequest("Room code is required to join a room");
  }
  return roomCode;
}

export function parseReady(body: Body): boolean {
  if (typeof body?.isReady !== "boolean") {
    throw badRequest("Ready status is required");
  }
  return body.isReady;
}

export function parseTeam(body: Body): 0 | 1 {
  if (body?.team !== 0 && body?.team !== 1) {
    throw badRequest("Invalid team selection");
  }
  return body.team;
}

export function parseRoomCode(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("Room code is required");
  }
  return value;
}

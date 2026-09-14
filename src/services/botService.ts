// src/services/botService.ts
/**
 * Bot identity for practice games.
 *
 * Bots are ordinary `User` rows. That is deliberate: the whole turn loop is
 * keyed on `userId` across transitions, runtime, and controllers, so real users
 * mean zero change to how a turn is identified. A fixed pool of three is reused
 * across games rather than creating a set per game — the Player→User FK is
 * ON DELETE RESTRICT, so per-game bot users could never be cleaned up and would
 * grow without bound.
 */

import { prisma } from "../db";

/**
 * Difficulty tiers, mirroring `ai/serving/tiers.py`, which is the source of
 * truth and rejects anything else with a 422. Ordered weakest first.
 */
export const BOT_TIERS = ["facile", "medio", "forte", "esperto"] as const;
export type BotTier = (typeof BOT_TIERS)[number];

export function isBotTier(tier: unknown): tier is BotTier {
  return typeof tier === "string" && BOT_TIERS.includes(tier as BotTier);
}

/** The reserved pool. These names show up at the table, so they read like players. */
const BOT_USERNAMES = ["Anna (bot)", "Bruno (bot)", "Carla (bot)"];

/**
 * Create the bot users if they are missing and return their ids in pool order.
 * Idempotent — called on every practice game.
 */
export async function ensureBotUsers(): Promise<number[]> {
  const ids: number[] = [];

  for (const username of BOT_USERNAMES) {
    const user = await prisma.user.upsert({
      where: { username },
      // No password: a bot account must never be loginable.
      create: { username, isBot: true },
      update: {},
    });

    // A real person could have registered this username before the pool
    // existed. Seating them as a bot would leak their account into practice
    // games and drop their record from the leaderboard, so fail loudly instead.
    if (!user.isBot) {
      throw new Error(
        `username "${username}" is reserved for bots but belongs to a real user`,
      );
    }

    ids.push(user.id);
  }

  return ids;
}

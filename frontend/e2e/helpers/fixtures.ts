import { test as base } from "@playwright/test";
import { BotPlayer } from "./BotPlayer";

/**
 * Custom fixture that provides a factory for creating bot players.
 * All bots created via the fixture are automatically cleaned up after the test.
 */
type BotFixtures = {
  createBot: (name: string) => Promise<BotPlayer>;
};

export const test = base.extend<BotFixtures>({
  createBot: async ({ browser }, use) => {
    const bots: BotPlayer[] = [];

    const factory = async (name: string): Promise<BotPlayer> => {
      const bot = await BotPlayer.create(browser, name);
      bots.push(bot);
      return bot;
    };

    await use(factory);

    // Cleanup all bots after test
    for (const bot of bots) {
      await bot.close();
    }
  },
});

export { expect } from "@playwright/test";

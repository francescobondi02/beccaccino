import { type Page, type BrowserContext } from "@playwright/test";

/**
 * BotPlayer encapsulates a single player's browser session.
 * Each bot gets its own BrowserContext (isolated cookies/session)
 * and exposes high-level actions for the game flow.
 */
export class BotPlayer {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly name: string;

  private constructor(page: Page, context: BrowserContext, name: string) {
    this.page = page;
    this.context = context;
    this.name = name;
  }

  static async create(
    browser: import("@playwright/test").Browser,
    name: string,
  ): Promise<BotPlayer> {
    const context = await browser.newContext();
    const page = await context.newPage();
    return new BotPlayer(page, context, name);
  }

  // ------------------------------------------------------------------
  // Authentication
  // ------------------------------------------------------------------

  async register(): Promise<void> {
    await this.page.goto("/");
    await this.page.getByTestId("open-auth-button").click();
    await this.page.getByTestId("auth-dialog").waitFor({ state: "visible" });

    // Switch to register mode
    await this.page.getByTestId("toggle-auth-mode").click();

    await this.page.getByTestId("username-input").fill(this.name);
    await this.page.getByTestId("password-input").fill("test123");
    await this.page.getByTestId("auth-submit-button").click();

    // Wait for auth to complete (dialog closes)
    await this.page.getByTestId("auth-dialog").waitFor({ state: "hidden" });
  }

  // ------------------------------------------------------------------
  // Room Management
  // ------------------------------------------------------------------

  async createRoom(): Promise<string> {
    await this.page.getByTestId("create-room-button").click();
    // Navigates to /room/:code
    await this.page.waitForURL(/\/room\//);
    const url = this.page.url();
    const roomCode = url.split("/room/")[1];
    return roomCode;
  }

  async joinRoomByCode(code: string): Promise<void> {
    await this.page.getByTestId("room-code-input").fill(code);
    await this.page.getByTestId("join-by-code-button").click();
    await this.page.waitForURL(/\/room\//);
  }

  // ------------------------------------------------------------------
  // GameRoom (Waiting Room)
  // ------------------------------------------------------------------

  async chooseTeam(team: 0 | 1): Promise<void> {
    await this.page.getByTestId(`team-${team}-button`).click();
    // Wait for the button to disappear (team chosen)
    await this.page
      .getByTestId(`team-${team}-button`)
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => {
        // Button might still be visible if the other team slot is free
      });
  }

  async setReady(): Promise<void> {
    await this.page.getByTestId("ready-button").click();
  }

  async waitForGameStart(): Promise<void> {
    // Game starts redirect to /game/:code after a 5s delay
    await this.page.waitForURL(/\/game\//, { timeout: 15_000 });
  }

  // ------------------------------------------------------------------
  // GameTable (Active Game)
  // ------------------------------------------------------------------

  async waitForGameTableLoad(): Promise<void> {
    await this.page
      .getByTestId("game-table-page")
      .waitFor({ state: "visible", timeout: 15_000 });
  }

  async isMyTurn(): Promise<boolean> {
    // True only if there's at least one playable card visible
    const count = await this.page.locator('[data-playable="true"]').count();
    return count > 0;
  }

  async chooseTrumpSuit(suit: string): Promise<void> {
    await this.page
      .getByTestId(`suit-button-${suit}`)
      .waitFor({ state: "visible", timeout: 10_000 });
    await this.page.getByTestId(`suit-button-${suit}`).click();
  }

  async hasTrumpDialog(): Promise<boolean> {
    return this.page.getByTestId("suit-button-denara").isVisible();
  }

  async playFirstAvailableCard(): Promise<void> {
    const playableCard = this.page.locator('[data-playable="true"]').first();
    await playableCard.waitFor({ state: "visible", timeout: 20_000 });

    await playableCard.click({ force: true });

    // If signal dialog appears (we're the trick leader), dismiss it with "Niente"
    const signalNone = this.page.getByTestId("signal-button-none");
    const hasSignalDialog = await signalNone
      .waitFor({ state: "visible", timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (hasSignalDialog) {
      await signalNone.click();
    }

    // Wait for the play to be processed
    await this.page.waitForTimeout(2000);
  }

  async getHandCardCount(): Promise<number> {
    return this.page.locator('[data-testid="player-hand"] [data-testid^="hand-card-"]').count();
  }

  async getBriscola(): Promise<string> {
    const attr = await this.page
      .getByTestId("game-table-page")
      .getAttribute("data-briscola");
    return attr ?? "";
  }

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  async close(): Promise<void> {
    await this.context.close();
  }
}

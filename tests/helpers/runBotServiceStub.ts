import {
  ActHandler,
  startBotServiceStub,
} from "./botServiceStub";

const port = Number(process.env.PORT ?? "19100");
const token = process.env.BOT_SERVICE_TOKEN ?? "prepush-bot-token";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const playFirstLegalMove: ActHandler = ({ state, seat, expected_legal_cards }) => {
  if (state.phase === "choose_briscola") {
    return {
      kind: "briscola",
      suit: state.hands[String(seat)][0].suit,
    };
  }

  const card = expected_legal_cards?.[0];
  if (!card) {
    throw new Error("Bot request did not include a legal card");
  }
  return {
    kind: "card",
    suit: card.suit,
    value: card.value,
    signal: null,
  };
};

async function main() {
  const stub = await startBotServiceStub(playFirstLegalMove, {
    port,
    requiredToken: token,
  });

  process.stdout.write(`bot_stub_ready ${stub.url}\n`);

  const shutdown = async () => {
    await stub.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start bot stub: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});

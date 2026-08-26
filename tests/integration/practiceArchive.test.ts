import { Suit, Value } from "@prisma/client";
import { prisma } from "../../src/db";
import { deleteRoomAndPlay } from "../../src/services/roomCommands";
import { practiceExportRecord } from "../../src/scripts/exportPracticeMatches";
import { clearDatabase } from "../helpers/gameHelpers";

const SUITS: Suit[] = ["denara", "coppe", "spade", "bastoni"];
const VALUES: Value[] = [
  "asso",
  "due",
  "tre",
  "quattro",
  "cinque",
  "sei",
  "sette",
  "fante",
  "cavallo",
  "re",
];

beforeEach(async () => {
  await clearDatabase();
});

/**
 * A finished game where seat n was dealt the ten cards of suit n and every seat
 * played its asso in the first trick.
 */
async function seedFinishedGame(
  code: string,
  isPractice: boolean,
  automaticHumanChoices = false,
) {
  const users = [];
  for (const [seat, name] of ["human", "bot-1", "bot-2", "bot-3"].entries()) {
    users.push(
      await prisma.user.create({
        data: { username: `${code}-${name}`, isBot: seat > 0 },
      }),
    );
  }

  const room = await prisma.gameRoom.create({
    data: {
      code,
      started: true,
      finished: true,
      isPractice,
      players: {
        create: users.map((user, seat) => ({
          userId: user.id,
          seat,
          team: seat % 2,
          botModel: seat === 0 ? null : "medio",
        })),
      },
    },
    include: { players: { orderBy: { seat: "asc" } } },
  });
  const round = await prisma.round.create({
    data: {
      gameRoomId: room.id,
      number: 1,
      briscola: "coppe",
      briscolaAutoChosen: automaticHumanChoices,
      winnerTeam: 0,
      team0Points: 7,
      team0Figures: 1,
    },
  });
  const hand = await prisma.hand.create({
    data: {
      roundId: round.id,
      number: 1,
      starterId: room.players[0].id,
      winnerId: room.players[0].id,
    },
  });
  await prisma.playedCard.createMany({
    data: room.players.map((player, seat) => ({
      handId: hand.id,
      playerId: player.id,
      suit: SUITS[seat],
      value: VALUES[0],
      position: seat,
      signal: seat === 0 ? "busso" : null,
      autoPlayed: seat === 0 && automaticHumanChoices,
    })),
  });
  await prisma.playerCard.createMany({
    data: room.players.flatMap((player, seat) =>
      VALUES.slice(1).map((value) => ({
        playerId: player.id,
        roundId: round.id,
        suit: SUITS[seat],
        value,
      })),
    ),
  });

  return { roomId: room.id };
}

describe("practice game archiving", () => {
  it("keeps a snapshot when the game rows are deleted", async () => {
    const { roomId } = await seedFinishedGame("ARC001", true);

    await deleteRoomAndPlay(roomId);

    const matches = await prisma.practiceMatch.findMany();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      humanSeat: 0,
      botTier: "medio",
      completed: true,
      schemaVersion: 1,
    });
    expect(matches[0]).not.toHaveProperty("humanUserId");

    const exported = practiceExportRecord(matches[0]);
    expect(exported).not.toHaveProperty("humanUserId");
    expect(exported).not.toHaveProperty("humanKey");

    const payload = matches[0].payload as any;
    expect(payload.rounds[0].tricks[0].cards[0]).toEqual([
      0,
      "denara:asso",
    ]);
    expect(payload.rounds[0].humanActions).toEqual([
      { kind: "choose_briscola", suit: "coppe" },
      {
        kind: "play_card",
        trick: 1,
        position: 0,
        card: "denara:asso",
        signal: "busso",
      },
    ]);
    expect(payload.rounds[0].dealtHands["0"]).toHaveLength(10);

    expect(await prisma.gameRoom.count()).toBe(0);
    expect(await prisma.round.count()).toBe(0);
    expect(await prisma.user.count()).toBe(4);
  });

  it("does not archive a game without genuine human choices", async () => {
    const { roomId } = await seedFinishedGame("ARC003", true, true);

    await deleteRoomAndPlay(roomId);

    expect(await prisma.practiceMatch.count()).toBe(0);
    expect(await prisma.gameRoom.count()).toBe(0);
  });

  it("does not archive multiplayer games", async () => {
    const { roomId } = await seedFinishedGame("ARC002", false);

    await deleteRoomAndPlay(roomId);

    expect(await prisma.practiceMatch.count()).toBe(0);
  });
});

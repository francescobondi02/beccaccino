import { describe, expect, it } from "vitest";
import {
  pointsForPlayerTeam,
  positionPlayers,
  trickWinner,
} from "@/game/presentation";

const players = [
  {
    id: 10,
    userId: 10,
    username: "alice",
    seat: 0,
    team: 0,
    isReady: true,
  },
  {
    id: 11,
    userId: 11,
    username: "bob",
    seat: 1,
    team: 1,
    isReady: true,
  },
  {
    id: 12,
    userId: 12,
    username: "carla",
    seat: 2,
    team: 0,
    isReady: true,
  },
  {
    id: 13,
    userId: 13,
    username: "diego",
    seat: 3,
    team: 1,
    isReady: true,
  },
];

describe("positionPlayers", () => {
  it.each([
    {
      currentUserId: 10,
      positions: ["bottom", "left", "top", "right"],
      teammate: "carla",
    },
    {
      currentUserId: 11,
      positions: ["right", "bottom", "left", "top"],
      teammate: "diego",
    },
  ])(
    "rotates seats around user $currentUserId",
    ({ currentUserId, positions, teammate }) => {
      const positioned = positionPlayers(players, currentUserId);

      expect(positioned.map((player) => player.position)).toEqual(positions);
      expect(positioned.find((player) => player.isLocalPlayer)?.userId).toBe(
        currentUserId,
      );
      expect(positioned.find((player) => player.isTeammate)?.username).toBe(
        teammate,
      );
    },
  );

  it("returns no presentation state for a user outside the room", () => {
    expect(positionPlayers(players, 99)).toEqual([]);
  });

  describe("trickWinner presentation", () => {
    const cards = ["tre", "due", "asso", "quattro"].map((value, position) => ({
      playerId: position + 10, userId: position + 1,
      suit: position === 3 ? "spade" : "coppe", value, position,
    }));

    it("uses the strongest lead card unless even the weakest trump is present", () => {
      expect(trickWinner(cards, "denara")).toBe(1);
      expect(trickWinner([...cards].reverse(), "spade")).toBe(4);
      expect(trickWinner(cards.map((card) => ({ ...card, suit: "spade" })), "spade")).toBe(1);
      expect(trickWinner(cards.map((card) => ({ ...card, value: ["quattro", "asso", "due", "re"][card.position] })), "coppe")).toBe(3);
    });

    it("does not invent a winner for incomplete or restored-without-trump state", () => {
      expect(trickWinner(cards.slice(0, 3), "spade")).toBeNull();
      expect(trickWinner(cards, null)).toBeNull();
      expect(trickWinner(cards.map((card) => ({ ...card, value: "unknown" })), "spade")).toBeNull();
    });
  });
});

describe("pointsForPlayerTeam", () => {
  it.each([
    { team: 0, own: 20, opponents: 10 },
    { team: 1, own: 10, opponents: 20 },
  ])("maps persisted points for team $team", ({ team, own, opponents }) => {
    expect(
      pointsForPlayerTeam(
        {
          team0Points: 20,
          team1Points: 10,
          team0Figures: 1,
          team1Figures: 2,
        },
        team,
      ),
    ).toEqual({ own, opponents });
  });
});

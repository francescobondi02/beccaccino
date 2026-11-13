import { describe, expect, it } from "vitest";
import {
  pointsForPlayerTeam,
  positionPlayers,
} from "@/game/presentation";

const players = [
  { userId: 10, username: "alice", isBot: false, seat: 0, team: 0 as const, botModel: null, abandoned: false },
  { userId: 11, username: "bob", isBot: false, seat: 1, team: 1 as const, botModel: null, abandoned: false },
  { userId: 12, username: "carla", isBot: false, seat: 2, team: 0 as const, botModel: null, abandoned: false },
  { userId: 13, username: "diego", isBot: false, seat: 3, team: 1 as const, botModel: null, abandoned: false },
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
});

describe("pointsForPlayerTeam", () => {
  it.each([
    { team: 0, own: 20, opponents: 10 },
    { team: 1, own: 10, opponents: 20 },
  ])("maps persisted points for team $team", ({ team, own, opponents }) => {
    expect(
      pointsForPlayerTeam(
        { team0: { points: 20, figures: 1 }, team1: { points: 10, figures: 2 } },
        team,
      ),
    ).toEqual({ own, opponents });
  });
});

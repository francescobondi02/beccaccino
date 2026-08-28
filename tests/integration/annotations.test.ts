import { Prisma, Suit, Value } from "@prisma/client";
import jwt from "jsonwebtoken";
import request from "supertest";
import { prisma } from "../../src/db";
import { annotationStateHash } from "../../src/annotations/scenario";
import { CARD_SIGNALS } from "../../src/domain/game/cards";
import { generateToken } from "../../src/utils/jwt";
import {
  annotationScenarioCreateData,
  annotationScenarioState,
  chooseBriscolaScenarioCreateData,
  chooseBriscolaScenarioState,
} from "../helpers/annotationScenario";
import {
  apiAs,
  clearDatabase,
  getServer,
} from "../helpers/gameHelpers";

const ACCESS_CODE = "annotation-integration-code";
const originalAccessCode = process.env.ANNOTATION_ACCESS_CODE;

beforeAll(() => {
  process.env.ANNOTATION_ACCESS_CODE = ACCESS_CODE;
});

afterAll(() => {
  if (originalAccessCode === undefined) {
    delete process.env.ANNOTATION_ACCESS_CODE;
  } else {
    process.env.ANNOTATION_ACCESS_CODE = originalAccessCode;
  }
});

beforeEach(async () => {
  await clearDatabase();
});

async function createUser(username: string, hasAccess = false) {
  return prisma.user.create({
    data: {
      username,
      expertAccessGrantedAt: hasAccess ? new Date() : null,
    },
  });
}

async function createScenario(
  code: string,
  predictedDifficulty: "easy" | "medium" | "hard" = "medium",
  score = 0,
  importance: 1 | 2 | 3 = 2,
) {
  const state = annotationScenarioState({
    totalScores: { 0: score, 1: 0 },
  });
  return prisma.annotationScenario.create({
    data: {
      ...annotationScenarioCreateData({
        code,
        predictedDifficulty,
        importance,
        state,
        stateHash: annotationStateHash(state),
      }),
      state: state as unknown as Prisma.InputJsonValue,
    },
  });
}

async function createBriscolaScenario(code: string, score = 0) {
  const state = chooseBriscolaScenarioState({
    totalScores: { 0: score, 1: 0 },
  });
  return prisma.annotationScenario.create({
    data: {
      ...chooseBriscolaScenarioCreateData({
        code,
        state,
        stateHash: annotationStateHash(state),
      }),
      state: state as unknown as Prisma.InputJsonValue,
    },
  });
}

function authCookie(user: { id: number; username: string }) {
  return `authToken=${generateToken({
    userId: user.id,
    username: user.username,
  })}`;
}

function responseFor(
  scenario: Awaited<ReturnType<typeof createScenario>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    scenarioId: scenario.id,
    scenarioHash: scenario.stateHash,
    selectedAction: {
      decisionType: "play_card",
      suit: Suit.denara,
      value: Value.asso,
      signal: null,
    },
    skipped: false,
    comment: null,
    perceivedDifficulty: "medium",
    responseTimeMs: 1234,
    ...overrides,
  };
}

function briscolaResponseFor(
  scenario: Awaited<ReturnType<typeof createBriscolaScenario>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    scenarioId: scenario.id,
    scenarioHash: scenario.stateHash,
    selectedAction: {
      decisionType: "choose_briscola",
      suit: Suit.spade,
    },
    skipped: false,
    comment: null,
    perceivedDifficulty: "medium",
    responseTimeMs: 1234,
    ...overrides,
  };
}

describe("expert annotation API", () => {
  it("uses account authentication for every endpoint", async () => {
    const responses = await Promise.all([
      request(getServer()).get("/api/annotations/status"),
      request(getServer())
        .post("/api/annotations/access")
        .send({ code: ACCESS_CODE }),
      request(getServer()).get("/api/annotations/next"),
      request(getServer()).post("/api/annotations/responses").send({}),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([
      401, 401, 401, 401,
    ]);
  });

  it.each([
    [
      "invalid",
      jwt.sign(
        { userId: 1, username: "expert" },
        "incorrect-annotation-test-secret",
      ),
    ],
    [
      "expired",
      jwt.sign(
        { userId: 1, username: "expert" },
        process.env.JWT_SECRET!,
        { expiresIn: -1 },
      ),
    ],
  ])("returns 401 for an %s account cookie", async (_kind, token) => {
    const response = await request(getServer())
      .get("/api/annotations/status")
      .set("Cookie", `authToken=${token}`);

    expect(response.statusCode).toBe(401);
  });

  it("rejects a bad code without granting access or invalidating login", async () => {
    const user = await createUser("expert");
    const cookie = authCookie(user);

    const invalid = await request(getServer())
      .post("/api/annotations/access")
      .set("Cookie", cookie)
      .send({ code: "wrong" });
    expect(invalid.statusCode).toBe(400);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .expertAccessGrantedAt,
    ).toBeNull();

    const statusBeforeGrant = await request(getServer())
      .get("/api/annotations/status")
      .set("Cookie", cookie);
    expect(statusBeforeGrant.statusCode).toBe(200);
    expect(statusBeforeGrant.body).toEqual({
      accessGranted: false,
      contributionCount: 0,
    });

    const granted = await request(getServer())
      .post("/api/annotations/access")
      .set("Cookie", cookie)
      .send({ code: ACCESS_CODE });
    expect(granted.statusCode).toBe(200);
    expect(granted.body).toEqual({
      accessGranted: true,
      contributionCount: 0,
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .expertAccessGrantedAt,
    ).not.toBeNull();

    const status = await request(getServer())
      .get("/api/annotations/status")
      .set("Cookie", cookie);
    expect(status.body).toEqual({
      accessGranted: true,
      contributionCount: 0,
    });
  });

  it("reports unavailable configuration without granting access", async () => {
    const user = await createUser("unconfigured");
    delete process.env.ANNOTATION_ACCESS_CODE;
    try {
      const response = await apiAs(user.id, user.username)
        .post("/api/annotations/access")
        .send({ code: ACCESS_CODE });
      expect(response.statusCode).toBe(503);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .expertAccessGrantedAt,
      ).toBeNull();
    } finally {
      process.env.ANNOTATION_ACCESS_CODE = ACCESS_CODE;
    }
  });

  it("keeps expert authorization and responses isolated by account", async () => {
    const expert = await createUser("authorized", true);
    const player = await createUser("player");
    await createScenario("initial-v1-0001");

    const forbidden = await apiAs(player.id, player.username).get(
      "/api/annotations/next",
    );
    expect(forbidden.statusCode).toBe(403);
    const forbiddenResponse = await apiAs(player.id, player.username)
      .post("/api/annotations/responses")
      .send({});
    expect(forbiddenResponse.statusCode).toBe(403);

    const next = await apiAs(expert.id, expert.username).get(
      "/api/annotations/next",
    );
    expect(next.statusCode).toBe(200);
    expect(next.body.scenario.code).toBe("initial-v1-0001");
  });

  it("reads a V1 database row through the play_card default", async () => {
    const user = await createUser("legacy", true);
    const state = annotationScenarioState();
    const scenario = await prisma.annotationScenario.create({
      data: {
        code: "initial-v1-default",
        predictedDifficulty: "medium",
        importance: 2,
        tags: ["must_follow"],
        state: state as unknown as Prisma.InputJsonValue,
        stateHash: annotationStateHash(state),
        sourceBatch: "initial-v1",
      },
    });

    expect(scenario.decisionType).toBe("play_card");
    const next = await apiAs(user.id, user.username).get(
      "/api/annotations/next",
    );
    expect(next.statusCode).toBe(200);
    expect(next.body.scenario).toMatchObject({
      id: scenario.id,
      decisionType: "play_card",
      hand: state.hand,
      legalActions: state.legalActions,
    });
  });

  it("mixes difficulty per user and never exposes generated labels", async () => {
    const user = await createUser("balanced", true);
    const medium = await createScenario("initial-v1-medium", "medium", 0);
    const hard = await createScenario("initial-v1-hard", "hard", 3);
    const easy = await createScenario("initial-v1-easy", "easy", 6);

    for (const scenario of [medium, hard, easy]) {
      const next = await apiAs(user.id, user.username).get(
        "/api/annotations/next",
      );
      expect(next.statusCode).toBe(200);
      expect(next.body.scenario.id).toBe(scenario.id);
      expect(next.body.scenario.decisionType).toBe("play_card");
      expect(next.body.scenario.predictedDifficulty).toBeUndefined();
      expect(next.body.scenario.importance).toBeUndefined();
      expect(next.body.scenario.tags).toBeUndefined();
      expect(next.body.scenario.hand).toBeDefined();

      const saved = await apiAs(user.id, user.username)
        .post("/api/annotations/responses")
        .send(responseFor(scenario));
      expect(saved.statusCode).toBe(200);
    }
  });

  it("keeps answered corner cases eligible and prefers importance on score ties", async () => {
    const user = await createUser("ranked", true);
    const standard = await createScenario(
      "initial-v1-standard",
      "medium",
      0,
      1,
    );
    const corner = await createScenario("initial-v1-corner", "medium", 3, 3);
    const contributors = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createUser(`contributor-${index}`),
      ),
    );
    await prisma.expertAnnotation.createMany({
      data: contributors.map((contributor) => ({
        userId: contributor.id,
        scenarioId: corner.id,
        scenarioHash: corner.stateHash,
        skipped: true,
        perceivedDifficulty: "hard",
        responseTimeMs: 1000,
      })),
    });

    const next = await apiAs(user.id, user.username).get(
      "/api/annotations/next",
    );

    expect(standard.id).toBeLessThan(corner.id);
    expect(next.statusCode).toBe(200);
    expect(next.body.scenario.id).toBe(corner.id);
  });

  it("rejects stale identities, illegal actions, and invalid perceived difficulty", async () => {
    const user = await createUser("validator", true);
    const scenario = await createScenario("initial-v1-validation");
    const briscolaScenario = await createBriscolaScenario(
      "annotator-v2-validation",
    );

    const stale = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(responseFor(scenario, { scenarioHash: "0".repeat(64) }));
    expect(stale.statusCode).toBe(409);

    const illegal = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(
        responseFor(scenario, {
          selectedAction: {
            decisionType: "play_card",
            suit: Suit.coppe,
            value: Value.asso,
            signal: null,
          },
        }),
      );
    expect(illegal.statusCode).toBe(400);

    const invalidDifficulty = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(responseFor(scenario, { perceivedDifficulty: "expert" }));
    expect(invalidDifficulty.statusCode).toBe(400);

    const wrongCardType = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(
        responseFor(scenario, {
          selectedAction: {
            decisionType: "choose_briscola",
            suit: Suit.denara,
          },
        }),
      );
    expect(wrongCardType.statusCode).toBe(400);

    const wrongBriscolaType = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(
        briscolaResponseFor(briscolaScenario, {
          selectedAction: {
            decisionType: "play_card",
            suit: Suit.denara,
            value: Value.asso,
            signal: null,
          },
        }),
      );
    expect(wrongBriscolaType.statusCode).toBe(400);
    expect(await prisma.expertAnnotation.count()).toBe(0);
  });

  it("stores idempotent account-linked answers and contribution count", async () => {
    const user = await createUser("repeat", true);
    const scenario = await createScenario("initial-v1-repeat");
    const payload = responseFor(scenario, { perceivedDifficulty: "hard" });
    const first = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(payload);
    const second = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(payload);

    expect(first.statusCode).toBe(200);
    expect(first.body.contributionCount).toBe(1);
    expect(second.statusCode).toBe(200);
    expect(second.body.contributionCount).toBe(1);
    expect(await prisma.expertAnnotation.count()).toBe(1);
    expect(await prisma.expertAnnotation.findFirstOrThrow()).toMatchObject({
      selectedSuit: Suit.denara,
      selectedValue: Value.asso,
      selectedSignal: null,
      selectedBriscola: null,
      perceivedDifficulty: "hard",
    });
  });

  it("accepts and stores a positive play-card signal", async () => {
    const user = await createUser("signal", true);
    const base = annotationScenarioState();
    const state = annotationScenarioState({
      actingSeat: 0,
      currentTrick: {
        number: 1,
        starterSeat: 0,
        signal: null,
        signalSeat: null,
        plays: [],
      },
      legalActions: base.hand.flatMap((card) =>
        [null, ...CARD_SIGNALS].map((signal) => ({ ...card, signal })),
      ),
    });
    const scenario = await prisma.annotationScenario.create({
      data: {
        ...annotationScenarioCreateData({
          code: "annotator-v2-signal",
          state,
          stateHash: annotationStateHash(state),
        }),
        state: state as unknown as Prisma.InputJsonValue,
      },
    });

    const response = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(
        responseFor(scenario, {
          selectedAction: {
            decisionType: "play_card",
            suit: Suit.denara,
            value: Value.asso,
            signal: "busso",
          },
        }),
      );

    expect(response.statusCode).toBe(200);
    expect(
      (await prisma.expertAnnotation.findFirstOrThrow()).selectedSignal,
    ).toBe("busso");
  });

  it("stores only briscola columns and clears action columns on upsert", async () => {
    const user = await createUser("briscola", true);
    const scenario = await createBriscolaScenario("annotator-v2-briscola");
    const next = await apiAs(user.id, user.username).get(
      "/api/annotations/next",
    );
    expect(next.body.scenario).toMatchObject({
      decisionType: "choose_briscola",
      hand: chooseBriscolaScenarioState().hand,
      legalActions: chooseBriscolaScenarioState().legalActions,
    });

    await prisma.expertAnnotation.create({
      data: {
        userId: user.id,
        scenarioId: scenario.id,
        scenarioHash: scenario.stateHash,
        selectedSuit: Suit.denara,
        selectedValue: Value.asso,
        skipped: false,
        perceivedDifficulty: "medium",
        responseTimeMs: 1000,
      },
    });

    const selected = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(briscolaResponseFor(scenario));
    expect(selected.statusCode).toBe(200);
    expect(await prisma.expertAnnotation.findFirstOrThrow()).toMatchObject({
      selectedSuit: null,
      selectedValue: null,
      selectedSignal: null,
      selectedBriscola: Suit.spade,
    });

    const skipped = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(
        briscolaResponseFor(scenario, {
          selectedAction: null,
          skipped: true,
        }),
      );
    expect(skipped.statusCode).toBe(200);
    expect(await prisma.expertAnnotation.findFirstOrThrow()).toMatchObject({
      selectedSuit: null,
      selectedValue: null,
      selectedSignal: null,
      selectedBriscola: null,
      skipped: true,
    });
  });

  it("stores a trimmed optional skip comment with the difficulty rating", async () => {
    const user = await createUser("skip", true);
    const scenario = await createScenario("initial-v1-skip");
    const response = await apiAs(user.id, user.username)
      .post("/api/annotations/responses")
      .send(
        responseFor(scenario, {
          selectedAction: null,
          skipped: true,
          comment: "  Non ricordo il segnale.  ",
          perceivedDifficulty: "hard",
        }),
      );

    expect(response.statusCode).toBe(200);
    const stored = await prisma.expertAnnotation.findFirstOrThrow();
    expect(stored.userId).toBe(user.id);
    expect(stored.selectedSuit).toBeNull();
    expect(stored.comment).toBe("Non ricordo il segnale.");
    expect(stored.perceivedDifficulty).toBe("hard");
  });

  it("returns an empty pool state without declaring completion", async () => {
    const user = await createUser("empty", true);
    const next = await apiAs(user.id, user.username).get(
      "/api/annotations/next",
    );

    expect(next.statusCode).toBe(200);
    expect(next.body).toEqual({
      scenario: null,
      contributionCount: 0,
    });
    expect(next.body.complete).toBeUndefined();
  });
});

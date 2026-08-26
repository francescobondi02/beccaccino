/**
 * Real WebSocket integration tests using socket.io-client.
 *
 * These tests create an actual HTTP server with Socket.IO attached,
 * register the real socket handlers, and use socket.io-client to connect
 * multiple clients — verifying event delivery across rooms.
 */

import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { prisma } from "../../src/db";
import {
  createServer,
  CreatedServer,
} from "../../src/server";

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let runtime: CreatedServer;
let httpServer: CreatedServer["httpServer"];
let ioServer: CreatedServer["io"];
let serverUrl: string;

/** All client sockets created during a test — cleaned up in afterEach */
let clients: ClientSocket[] = [];

function createClient(opts: Record<string, unknown> = {}): ClientSocket {
  const client = ioc(serverUrl, {
    transports: ["websocket"],
    forceNew: true,
    ...opts,
  });
  clients.push(client);
  return client;
}

/** Wait for a specific event on a socket, with a timeout */
function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 3000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/** Wait for a socket to connect */
function waitForConnect(socket: ClientSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for socket connect after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Small delay helper for timing-sensitive tests */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface JoinRoomResult {
  ok: boolean;
  error?: string;
}

function joinSocketRoom(
  socket: ClientSocket,
  roomCode: string,
  user: TestUser,
): Promise<JoinRoomResult> {
  return new Promise((resolve) => {
    socket.emit(
      "join_room",
      { roomCode, userId: user.id, username: user.username },
      resolve,
    );
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll((done) => {
  runtime = createServer({
    allowTestAuthBypass: true,
    corsOrigin: "*",
  });
  httpServer = runtime.httpServer;
  ioServer = runtime.io;

  httpServer.listen(0, () => {
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    serverUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

afterEach(async () => {
  // Disconnect all clients created during the test
  for (const client of clients) {
    if (client.connected) {
      client.disconnect();
    }
  }
  clients = [];
});

afterAll(async () => {
  await runtime.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helpers: clear DB and create users + room via REST API (auth-aware)
// ---------------------------------------------------------------------------

async function clearDatabase() {
  await prisma.$transaction([
    prisma.expertAnnotation.deleteMany(),
    prisma.annotationScenario.deleteMany(),
    prisma.playedCard.deleteMany(),
    prisma.playerCard.deleteMany(),
    prisma.hand.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

interface TestUser {
  id: number;
  username: string;
}

function authHeaders(user: TestUser) {
  return {
    "x-test-user-id": String(user.id),
    "x-test-username": user.username,
  };
}

/** Create a user via REST and return their id + username */
async function createUser(username: string): Promise<TestUser> {
  const res = await request(httpServer)
    .post("/api/users/register")
    .send({ username, password: "test123" });
  expect(res.statusCode).toBe(201);
  return { id: res.body.id, username };
}

/** Create a room as the given user and return the room code */
async function createRoom(user: TestUser): Promise<string> {
  const res = await request(httpServer)
    .post("/api/rooms")
    .set(authHeaders(user))
    .send({});
  expect(res.statusCode).toBe(201);
  return res.body.code;
}

/** Join a room via REST as the given user */
async function joinRoom(roomCode: string, user: TestUser): Promise<void> {
  const res = await request(httpServer)
    .post("/api/rooms/join")
    .set(authHeaders(user))
    .send({ roomCode });
  expect(res.statusCode).toBe(200);
}

/** Choose a team for the given user via REST */
async function chooseTeamRest(
  roomCode: string,
  user: TestUser,
  team: number,
): Promise<void> {
  const res = await request(httpServer)
    .post(`/api/rooms/${roomCode}/choose-team`)
    .set(authHeaders(user))
    .send({ team });
  expect(res.statusCode).toBe(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Socket.IO real WebSocket integration", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  // =========================================================================
  // join_room
  // =========================================================================
  describe("join_room", () => {
    it("acknowledges only after the socket has joined the room", async () => {
      const user = await createUser("Alice");
      const roomCode = await createRoom(user);
      const client = createClient();
      await waitForConnect(client);

      await expect(joinSocketRoom(client, roomCode, user)).resolves.toEqual({
        ok: true,
      });
      expect(
        ioServer.sockets.adapter.rooms.get(roomCode)?.has(client.id!),
      ).toBe(true);
    });

    it("should notify other clients in the room when a player joins", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);

      const client1 = createClient();
      await waitForConnect(client1);
      client1.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      const client2 = createClient();
      await waitForConnect(client2);

      const playerJoinedPromise = waitForEvent<{
        player: {
          id: number;
          username: string;
          userId: number;
          seat: number | null;
          team: number | null;
          isReady: boolean;
        };
      }>(
        client1,
        "player_joined"
      );

      client2.emit("join_room", { roomCode, userId: u2.id, username: u2.username });

      const event = await playerJoinedPromise;
      expect(event.player).toEqual({
        id: expect.any(Number),
        username: "Bob",
        userId: u2.id,
        seat: null,
        team: null,
        isReady: false,
      });
    });

    it("does not rebroadcast presence for repeated joins or another tab", async () => {
      const observer = await createUser("Alice");
      const returningUser = await createUser("Bob");
      const roomCode = await createRoom(observer);
      await joinRoom(roomCode, returningUser);

      const observerClient = createClient();
      const primaryClient = createClient();
      const secondTabClient = createClient();
      await Promise.all([
        waitForConnect(observerClient),
        waitForConnect(primaryClient),
        waitForConnect(secondTabClient),
      ]);
      await joinSocketRoom(observerClient, roomCode, observer);

      let joinedEvents = 0;
      observerClient.on("player_joined", ({ player }) => {
        if (player.userId === returningUser.id) joinedEvents += 1;
      });

      await joinSocketRoom(primaryClient, roomCode, returningUser);
      await joinSocketRoom(primaryClient, roomCode, returningUser);
      await joinSocketRoom(secondTabClient, roomCode, returningUser);
      await delay(100);

      expect(joinedEvents).toBe(1);
    });

    it("leaves the previous socket room before joining another one", async () => {
      const switchingUser = await createUser("Alice");
      const otherOwner = await createUser("Bob");
      const firstRoomCode = await createRoom(switchingUser);
      const secondRoomCode = await createRoom(otherOwner);
      const secondRoom = await prisma.gameRoom.findUniqueOrThrow({
        where: { code: secondRoomCode },
      });
      await prisma.player.create({
        data: {
          gameRoomId: secondRoom.id,
          userId: switchingUser.id,
          isReady: false,
        },
      });

      const client = createClient();
      await waitForConnect(client);
      await joinSocketRoom(client, firstRoomCode, switchingUser);
      expect(
        ioServer.sockets.adapter.rooms.get(firstRoomCode)?.has(client.id!),
      ).toBe(true);

      await joinSocketRoom(client, secondRoomCode, switchingUser);

      expect(
        ioServer.sockets.adapter.rooms.get(firstRoomCode)?.has(client.id!),
      ).not.toBe(true);
      expect(
        ioServer.sockets.adapter.rooms.get(secondRoomCode)?.has(client.id!),
      ).toBe(true);
    });

    it("should emit error if room does not exist", async () => {
      const u = await createUser("Charlie");

      const client = createClient();
      await waitForConnect(client);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("join_room", { roomCode: "NONEXIST", userId: u.id, username: u.username });

      const err = await errorPromise;
      expect(err.message).toBe("Room not found");
    });

    it("should emit error if user is not a player in the room", async () => {
      const u1 = await createUser("Owner");
      const u2 = await createUser("Outsider");
      const roomCode = await createRoom(u1);
      // u2 has NOT joined via REST

      const client = createClient();
      await waitForConnect(client);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("join_room", { roomCode, userId: u2.id, username: u2.username });

      const err = await errorPromise;
      expect(err.message).toBe("You are not in this room");
    });
  });

  // =========================================================================
  // leave_room
  // =========================================================================
  describe("leave_room", () => {
    it("should stop receiving room events after leaving", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const u3 = await createUser("Carol");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);
      await joinRoom(roomCode, u3);

      const client1 = createClient();
      const client2 = createClient();
      const client3 = createClient();
      await Promise.all([
        waitForConnect(client1),
        waitForConnect(client2),
        waitForConnect(client3),
      ]);

      client1.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      client2.emit("join_room", { roomCode, userId: u2.id, username: u2.username });
      await delay(100);
      client3.emit("join_room", { roomCode, userId: u3.id, username: u3.username });
      await delay(100);

      // Client1 leaves
      client1.emit("leave_room", { roomCode });
      await delay(100);

      // Now choose team — client1 should NOT receive team_chosen
      let client1Received = false;
      client1.once("team_chosen", () => {
        client1Received = true;
      });

      const client2TeamPromise = waitForEvent(client2, "team_chosen");
      // Set team for u2 via REST (authenticated)
      await chooseTeamRest(roomCode, u2, 0);

      // Use choose_team via socket for u3
      client3.emit("choose_team", { roomCode, userId: u3.id, team: 1 });
      await client2TeamPromise;
      await delay(200);

      expect(client1Received).toBe(false);
    });
  });

  // =========================================================================
  // choose_team
  // =========================================================================
  describe("choose_team", () => {
    it("should broadcast team_chosen to all clients in the room", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      client2.emit("join_room", { roomCode, userId: u2.id, username: u2.username });
      await delay(100);

      const teamPromise1 = waitForEvent<{
        userId: number;
        playerId: number;
        team: number;
      }>(client1, "team_chosen");
      const teamPromise2 = waitForEvent<{
        userId: number;
        playerId: number;
        team: number;
      }>(client2, "team_chosen");

      client1.emit("choose_team", { roomCode, userId: u1.id, team: 0 });

      const [ev1, ev2] = await Promise.all([teamPromise1, teamPromise2]);
      expect(ev1.userId).toBe(u1.id);
      expect(ev1.playerId).toEqual(expect.any(Number));
      expect(ev1.team).toBe(0);
      expect(ev2.userId).toBe(u1.id);
      expect(ev2.playerId).toBe(ev1.playerId);
      expect(ev2.team).toBe(0);
    });

    it("should emit error for invalid team value", async () => {
      const u1 = await createUser("Alice");
      const roomCode = await createRoom(u1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("choose_team", { roomCode, userId: u1.id, team: 5 });

      const err = await errorPromise;
      expect(err.message).toBe("Invalid team selection");
    });

    it("should emit error when team is full", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const u3 = await createUser("Carol");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);
      await joinRoom(roomCode, u3);

      const client1 = createClient();
      const client2 = createClient();
      const client3 = createClient();
      await Promise.all([
        waitForConnect(client1),
        waitForConnect(client2),
        waitForConnect(client3),
      ]);

      client1.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      client2.emit("join_room", { roomCode, userId: u2.id, username: u2.username });
      client3.emit("join_room", { roomCode, userId: u3.id, username: u3.username });
      await delay(100);

      // Fill team 0
      client1.emit("choose_team", { roomCode, userId: u1.id, team: 0 });
      await delay(100);
      client2.emit("choose_team", { roomCode, userId: u2.id, team: 0 });
      await delay(100);

      // Third player tries to join full team
      const errorPromise = waitForEvent<{ message: string }>(client3, "error");
      client3.emit("choose_team", { roomCode, userId: u3.id, team: 0 });

      const err = await errorPromise;
      expect(err.message).toBe("Team is already full");
    });

    it("serializes REST and socket choices for the last team slot", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const u3 = await createUser("Carol");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);
      await joinRoom(roomCode, u3);
      await chooseTeamRest(roomCode, u1, 0);

      const client2 = createClient();
      await waitForConnect(client2);
      client2.emit("join_room", {
        roomCode,
        userId: u2.id,
        username: u2.username,
      });
      await delay(100);

      let chosenEvents = 0;
      client2.on("team_chosen", () => chosenEvents++);
      client2.emit("choose_team", { roomCode, userId: u2.id, team: 0 });
      const restResponse = await request(httpServer)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .set(authHeaders(u3))
        .send({ team: 0 });
      await delay(200);

      expect([200, 400]).toContain(restResponse.statusCode);
      const team = await prisma.player.findMany({
        where: { gameRoom: { code: roomCode }, team: 0 },
      });
      expect(team).toHaveLength(2);
      expect(chosenEvents).toBe(1);
      expect(
        team.filter((player) => [u2.id, u3.id].includes(player.userId)),
      ).toHaveLength(1);
    });
  });

  // =========================================================================
  // set_ready
  // =========================================================================
  describe("set_ready", () => {
    it("should broadcast ready_changed to all clients in the room", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);

      // Assign teams via REST first (authenticated)
      await chooseTeamRest(roomCode, u1, 0);
      await chooseTeamRest(roomCode, u2, 1);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      client2.emit("join_room", { roomCode, userId: u2.id, username: u2.username });
      await delay(100);

      const readyPromise1 = waitForEvent<{
        userId: number;
        playerId: number;
        isReady: boolean;
      }>(
        client1,
        "ready_changed"
      );
      const readyPromise2 = waitForEvent<{
        userId: number;
        playerId: number;
        isReady: boolean;
      }>(
        client2,
        "ready_changed"
      );

      client1.emit("set_ready", { roomCode, userId: u1.id, isReady: true });

      const [ev1, ev2] = await Promise.all([readyPromise1, readyPromise2]);
      expect(ev1.userId).toBe(u1.id);
      expect(ev1.playerId).toEqual(expect.any(Number));
      expect(ev1.isReady).toBe(true);
      expect(ev2.userId).toBe(u1.id);
      expect(ev2.playerId).toBe(ev1.playerId);
      expect(ev2.isReady).toBe(true);
    });

    it("should emit error if player has not chosen a team", async () => {
      const u1 = await createUser("Alice");
      const roomCode = await createRoom(u1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("set_ready", { roomCode, userId: u1.id, isReady: true });

      const err = await errorPromise;
      expect(err.message).toBe(
        "Player must choose a team before readying up",
      );
    });

    it("starts one game when the fourth player readies through the socket", async () => {
      const users = await Promise.all(
        ["readyA", "readyB", "readyC", "readyD"].map(createUser),
      );
      const roomCode = await createRoom(users[0]);
      for (let index = 1; index < users.length; index++) {
        await joinRoom(roomCode, users[index]);
      }
      for (let index = 0; index < users.length; index++) {
        await chooseTeamRest(roomCode, users[index], index % 2);
      }
      for (let index = 0; index < users.length - 1; index++) {
        const response = await request(httpServer)
          .post(`/api/rooms/${roomCode}/ready`)
          .set(authHeaders(users[index]))
          .send({ isReady: true });
        expect(response.statusCode).toBe(200);
      }

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", {
        roomCode,
        userId: users[3].id,
        username: users[3].username,
      });
      await delay(100);
      const started = waitForEvent(client, "game_started");

      client.emit("set_ready", {
        roomCode,
        userId: users[3].id,
        isReady: true,
      });
      await started;

      const room = await prisma.gameRoom.findUniqueOrThrow({
        where: { code: roomCode },
        include: { rounds: true },
      });
      expect(room.started).toBe(true);
      expect(room.rounds).toHaveLength(1);
    });
  });

  // =========================================================================
  // send_chat_message
  // =========================================================================
  describe("send_chat_message", () => {
    it("should broadcast chat_message with sanitized content to all in room", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      client2.emit("join_room", { roomCode, userId: u2.id, username: u2.username });
      await delay(100);

      const chatPromise1 = waitForEvent<{
        userId: number;
        username: string;
        message: string;
        timestamp: string;
      }>(client1, "chat_message");
      const chatPromise2 = waitForEvent<{
        userId: number;
        username: string;
        message: string;
        timestamp: string;
      }>(client2, "chat_message");

      client1.emit("send_chat_message", { message: "Hello everyone!" });

      const [msg1, msg2] = await Promise.all([chatPromise1, chatPromise2]);
      expect(msg1.username).toBe("Alice");
      expect(msg1.message).toBe("Hello everyone!");
      expect(msg1.userId).toBe(u1.id);
      expect(msg1.timestamp).toBeDefined();
      expect(msg2.message).toBe("Hello everyone!");
    });

    it("should emit error if user has not joined a room", async () => {
      await createUser("Alice");

      const client = createClient();
      await waitForConnect(client);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("send_chat_message", { message: "hello" });

      const err = await errorPromise;
      expect(err.message).toBe("Not authenticated in room");
    });
  });

  // =========================================================================
  // Chat rate limiting
  // =========================================================================
  describe("chat rate limiting", () => {
    it("should reject the 6th message within 3s window", async () => {
      const u1 = await createUser("Spammer");
      const roomCode = await createRoom(u1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      // Send 5 messages rapidly (all should succeed)
      for (let i = 0; i < 5; i++) {
        client.emit("send_chat_message", { message: `msg ${i}` });
      }

      // 6th message should be rejected
      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("send_chat_message", { message: "msg 5" });

      const err = await errorPromise;
      expect(err.message).toBe("Too many messages. Slow down!");
    });

    it("should allow messages again after the rate window resets", async () => {
      const u1 = await createUser("Chatter");
      const roomCode = await createRoom(u1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      // Send 5 messages to hit the limit
      for (let i = 0; i < 5; i++) {
        client.emit("send_chat_message", { message: `msg ${i}` });
      }
      await delay(100);

      // Wait for the rate window to expire (3 seconds)
      await delay(3100);

      // Should be able to send again
      const chatPromise = waitForEvent<{ message: string }>(client, "chat_message");
      client.emit("send_chat_message", { message: "I can talk again" });

      const msg = await chatPromise;
      expect(msg.message).toBe("I can talk again");
    }, 10000); // Increase timeout for this test
  });

  // =========================================================================
  // Chat sanitization
  // =========================================================================
  describe("chat sanitization", () => {
    it("should strip control characters from messages", async () => {
      const u1 = await createUser("Alice");
      const roomCode = await createRoom(u1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      const chatPromise = waitForEvent<{ message: string }>(client, "chat_message");
      // Send message with control characters
      client.emit("send_chat_message", { message: "Hello\x00\x01\x02World\x7F!" });

      const msg = await chatPromise;
      expect(msg.message).toBe("HelloWorld!");
    });

    it("should cap message length at 200 characters", async () => {
      const u1 = await createUser("Alice");
      const roomCode = await createRoom(u1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      const longMessage = "A".repeat(300);
      const chatPromise = waitForEvent<{ message: string }>(client, "chat_message");
      client.emit("send_chat_message", { message: longMessage });

      const msg = await chatPromise;
      expect(msg.message.length).toBe(200);
      expect(msg.message).toBe("A".repeat(200));
    });

    it("should ignore empty messages after sanitization", async () => {
      const u1 = await createUser("Alice");
      const roomCode = await createRoom(u1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      // Message with only control characters + whitespace
      let received = false;
      client.once("chat_message", () => {
        received = true;
      });

      client.emit("send_chat_message", { message: "\x01\x02\x03" });
      await delay(200);

      expect(received).toBe(false);
    });
  });

  // =========================================================================
  // disconnect
  // =========================================================================
  describe("disconnect", () => {
    it("should emit player_disconnected to remaining room members", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      client2.emit("join_room", { roomCode, userId: u2.id, username: u2.username });
      await delay(100);

      const disconnectPromise = waitForEvent<{ userId: number; username: string }>(
        client1,
        "player_disconnected"
      );

      // Disconnect client2
      client2.disconnect();

      const event = await disconnectPromise;
      expect(event.userId).toBe(u2.id);
      expect(event.username).toBe("Bob");
    });

    it("reports a player disconnected only after their final socket closes", async () => {
      const observer = await createUser("Alice");
      const connectedUser = await createUser("Bob");
      const roomCode = await createRoom(observer);
      await joinRoom(roomCode, connectedUser);

      const observerClient = createClient();
      const primaryClient = createClient();
      const secondTabClient = createClient();
      await Promise.all([
        waitForConnect(observerClient),
        waitForConnect(primaryClient),
        waitForConnect(secondTabClient),
      ]);
      await joinSocketRoom(observerClient, roomCode, observer);
      await joinSocketRoom(primaryClient, roomCode, connectedUser);
      await joinSocketRoom(secondTabClient, roomCode, connectedUser);

      let disconnectedEvents = 0;
      observerClient.on("player_disconnected", () => {
        disconnectedEvents += 1;
      });

      primaryClient.disconnect();
      await delay(100);
      expect(disconnectedEvents).toBe(0);

      const finalDisconnect = waitForEvent<{
        userId: number;
        username: string;
      }>(observerClient, "player_disconnected");
      secondTabClient.disconnect();

      await expect(finalDisconnect).resolves.toEqual({
        userId: connectedUser.id,
        username: connectedUser.username,
      });
      expect(disconnectedEvents).toBe(1);
    });

    it("should NOT emit player_disconnected if socket was not in a room", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");
      const roomCode = await createRoom(u1);
      await joinRoom(roomCode, u2);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      // Only client1 joins the socket room
      client1.emit("join_room", { roomCode, userId: u1.id, username: u1.username });
      await delay(100);

      let received = false;
      client1.once("player_disconnected", () => {
        received = true;
      });

      // client2 never emitted join_room, so disconnect should not trigger player_disconnected
      client2.disconnect();
      await delay(200);

      expect(received).toBe(false);
    });
  });

  // =========================================================================
  // join_lobby / leave_lobby
  // =========================================================================
  describe("join_lobby / leave_lobby", () => {
    it("should receive room_created events while in lobby", async () => {
      const u1 = await createUser("Alice");

      const client1 = createClient();
      await waitForConnect(client1);

      // Join the lobby
      client1.emit("join_lobby", { userId: u1.id });
      await delay(100);

      // Now another user creates a room — if the server emits room_created to lobby
      // we should receive it. Let's emit it manually from the server side to test.
      const roomCreatedPromise = waitForEvent<{ code: string }>(
        client1,
        "room_created",
        2000
      );

      // Emit room_created to the lobby room from the server
      ioServer.to("lobby").emit("room_created", { code: "TEST01" });

      const event = await roomCreatedPromise;
      expect(event.code).toBe("TEST01");
    });

    it("should NOT receive lobby events after leaving lobby", async () => {
      const u1 = await createUser("Alice");

      const client1 = createClient();
      await waitForConnect(client1);

      client1.emit("join_lobby", { userId: u1.id });
      await delay(100);

      // Leave the lobby
      client1.emit("leave_lobby", {});
      await delay(100);

      let received = false;
      client1.once("room_created", () => {
        received = true;
      });

      ioServer.to("lobby").emit("room_created", { code: "TEST02" });
      await delay(200);

      expect(received).toBe(false);
    });

    it("multiple clients in lobby all receive events", async () => {
      const u1 = await createUser("Alice");
      const u2 = await createUser("Bob");

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_lobby", { userId: u1.id });
      client2.emit("join_lobby", { userId: u2.id });
      await delay(100);

      const promise1 = waitForEvent<{ code: string }>(client1, "room_created");
      const promise2 = waitForEvent<{ code: string }>(client2, "room_created");

      ioServer.to("lobby").emit("room_created", { code: "SHARED" });

      const [ev1, ev2] = await Promise.all([promise1, promise2]);
      expect(ev1.code).toBe("SHARED");
      expect(ev2.code).toBe("SHARED");
    });
  });
});

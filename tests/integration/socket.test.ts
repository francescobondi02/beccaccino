/**
 * Real WebSocket integration tests using socket.io-client.
 *
 * These tests create an actual HTTP server with Socket.IO attached,
 * register the real socket handlers, and use socket.io-client to connect
 * multiple clients — verifying event delivery across rooms.
 */

import http from "http";
import { Server } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import app from "../../src/app";
import { registerRoomSocket } from "../../src/sockets/room";
import { setSocketInstance } from "../../src/socketInstance";
import { prisma } from "../../src/db";

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let httpServer: http.Server;
let ioServer: Server;
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll((done) => {
  httpServer = http.createServer(app);
  ioServer = new Server(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io/",
  });

  // Override the global socket instance with the real one
  setSocketInstance(ioServer);

  // Bypass auth in test mode (same as src/index.ts)
  ioServer.use((socket, next) => {
    if (process.env.NODE_ENV === "test") {
      return next();
    }
    next(new Error("Auth not configured in tests"));
  });

  // Register handlers on connection
  ioServer.on("connection", (socket) => {
    registerRoomSocket(socket, ioServer);
  });

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
  // Close Socket.IO and HTTP server
  await new Promise<void>((resolve) => {
    ioServer.close(() => resolve());
  });
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helper: clear DB and create users + room via REST API
// ---------------------------------------------------------------------------

async function clearDatabase() {
  await prisma.$transaction([
    prisma.playedCard.deleteMany(),
    prisma.playerCard.deleteMany(),
    prisma.hand.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

/** Create a user via REST and return their ID */
async function createUser(username: string): Promise<number> {
  const res = await request(httpServer)
    .post("/api/users/register")
    .send({ username, password: "test123" });
  expect(res.statusCode).toBe(201);
  return res.body.id;
}

/** Create a room with the given owner and return the room code */
async function createRoom(userId: number): Promise<string> {
  const res = await request(httpServer)
    .post("/api/rooms")
    .send({ userId });
  expect(res.statusCode).toBe(201);
  return res.body.code;
}

/** Join a room via REST */
async function joinRoom(roomCode: string, userId: number): Promise<void> {
  const res = await request(httpServer)
    .post("/api/rooms/join")
    .send({ roomCode, userId });
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
    it("should notify other clients in the room when a player joins", async () => {
      // Create two users and a room
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");
      const roomCode = await createRoom(userId1);
      await joinRoom(roomCode, userId2);

      // Connect first client and join socket room
      const client1 = createClient();
      await waitForConnect(client1);
      client1.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      // Give the server a moment to process the join
      await delay(100);

      // Connect second client — set up listener BEFORE emitting join
      const client2 = createClient();
      await waitForConnect(client2);

      const playerJoinedPromise = waitForEvent<{ player: { username: string; userId: number } }>(
        client1,
        "player_joined"
      );

      client2.emit("join_room", { roomCode, userId: userId2, username: "Bob" });

      const event = await playerJoinedPromise;
      expect(event.player.username).toBe("Bob");
      expect(event.player.userId).toBe(userId2);
    });

    it("should emit error if room does not exist", async () => {
      const userId = await createUser("Charlie");

      const client = createClient();
      await waitForConnect(client);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("join_room", { roomCode: "NONEXIST", userId, username: "Charlie" });

      const err = await errorPromise;
      expect(err.message).toBe("Room not found");
    });

    it("should emit error if user is not a player in the room", async () => {
      const userId1 = await createUser("Owner");
      const userId2 = await createUser("Outsider");
      const roomCode = await createRoom(userId1);
      // userId2 has NOT joined via REST

      const client = createClient();
      await waitForConnect(client);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("join_room", { roomCode, userId: userId2, username: "Outsider" });

      const err = await errorPromise;
      expect(err.message).toBe("You are not in this room");
    });
  });

  // =========================================================================
  // leave_room
  // =========================================================================
  describe("leave_room", () => {
    it("should stop receiving room events after leaving", async () => {
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");
      const userId3 = await createUser("Carol");
      const roomCode = await createRoom(userId1);
      await joinRoom(roomCode, userId2);
      await joinRoom(roomCode, userId3);

      const client1 = createClient();
      const client2 = createClient();
      const client3 = createClient();
      await Promise.all([
        waitForConnect(client1),
        waitForConnect(client2),
        waitForConnect(client3),
      ]);

      // All join the socket room
      client1.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      client2.emit("join_room", { roomCode, userId: userId2, username: "Bob" });
      await delay(100);
      client3.emit("join_room", { roomCode, userId: userId3, username: "Carol" });
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
      // Set team for userId2
      await request(httpServer)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: userId2, team: 0 });

      // Use choose_team via socket for userId3
      client3.emit("choose_team", { roomCode, userId: userId3, team: 1 });
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
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");
      const roomCode = await createRoom(userId1);
      await joinRoom(roomCode, userId2);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      client2.emit("join_room", { roomCode, userId: userId2, username: "Bob" });
      await delay(100);

      const teamPromise1 = waitForEvent<{ userId: number; team: number }>(client1, "team_chosen");
      const teamPromise2 = waitForEvent<{ userId: number; team: number }>(client2, "team_chosen");

      client1.emit("choose_team", { roomCode, userId: userId1, team: 0 });

      const [ev1, ev2] = await Promise.all([teamPromise1, teamPromise2]);
      expect(ev1.userId).toBe(userId1);
      expect(ev1.team).toBe(0);
      expect(ev2.userId).toBe(userId1);
      expect(ev2.team).toBe(0);
    });

    it("should emit error for invalid team value", async () => {
      const userId1 = await createUser("Alice");
      const roomCode = await createRoom(userId1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      await delay(100);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("choose_team", { roomCode, userId: userId1, team: 5 });

      const err = await errorPromise;
      expect(err.message).toBe("Invalid team");
    });

    it("should emit error when team is full", async () => {
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");
      const userId3 = await createUser("Carol");
      const roomCode = await createRoom(userId1);
      await joinRoom(roomCode, userId2);
      await joinRoom(roomCode, userId3);

      const client1 = createClient();
      const client2 = createClient();
      const client3 = createClient();
      await Promise.all([
        waitForConnect(client1),
        waitForConnect(client2),
        waitForConnect(client3),
      ]);

      client1.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      client2.emit("join_room", { roomCode, userId: userId2, username: "Bob" });
      client3.emit("join_room", { roomCode, userId: userId3, username: "Carol" });
      await delay(100);

      // Fill team 0
      client1.emit("choose_team", { roomCode, userId: userId1, team: 0 });
      await delay(100);
      client2.emit("choose_team", { roomCode, userId: userId2, team: 0 });
      await delay(100);

      // Third player tries to join full team
      const errorPromise = waitForEvent<{ message: string }>(client3, "error");
      client3.emit("choose_team", { roomCode, userId: userId3, team: 0 });

      const err = await errorPromise;
      expect(err.message).toBe("Team is full");
    });
  });

  // =========================================================================
  // set_ready
  // =========================================================================
  describe("set_ready", () => {
    it("should broadcast ready_changed to all clients in the room", async () => {
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");
      const roomCode = await createRoom(userId1);
      await joinRoom(roomCode, userId2);

      // Assign teams via REST first
      await request(httpServer)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: userId1, team: 0 });
      await request(httpServer)
        .post(`/api/rooms/${roomCode}/choose-team`)
        .send({ userId: userId2, team: 1 });

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      client2.emit("join_room", { roomCode, userId: userId2, username: "Bob" });
      await delay(100);

      const readyPromise1 = waitForEvent<{ userId: number; isReady: boolean }>(
        client1,
        "ready_changed"
      );
      const readyPromise2 = waitForEvent<{ userId: number; isReady: boolean }>(
        client2,
        "ready_changed"
      );

      client1.emit("set_ready", { roomCode, userId: userId1, isReady: true });

      const [ev1, ev2] = await Promise.all([readyPromise1, readyPromise2]);
      expect(ev1.userId).toBe(userId1);
      expect(ev1.isReady).toBe(true);
      expect(ev2.userId).toBe(userId1);
      expect(ev2.isReady).toBe(true);
    });

    it("should emit error if player has not chosen a team", async () => {
      const userId1 = await createUser("Alice");
      const roomCode = await createRoom(userId1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      await delay(100);

      const errorPromise = waitForEvent<{ message: string }>(client, "error");
      client.emit("set_ready", { roomCode, userId: userId1, isReady: true });

      const err = await errorPromise;
      expect(err.message).toBe("Choose a team first");
    });
  });

  // =========================================================================
  // send_chat_message
  // =========================================================================
  describe("send_chat_message", () => {
    it("should broadcast chat_message with sanitized content to all in room", async () => {
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");
      const roomCode = await createRoom(userId1);
      await joinRoom(roomCode, userId2);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      client2.emit("join_room", { roomCode, userId: userId2, username: "Bob" });
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
      expect(msg1.userId).toBe(userId1);
      expect(msg1.timestamp).toBeDefined();
      expect(msg2.message).toBe("Hello everyone!");
    });

    it("should emit error if user has not joined a room", async () => {
      const userId1 = await createUser("Alice");

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
      const userId1 = await createUser("Spammer");
      const roomCode = await createRoom(userId1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: userId1, username: "Spammer" });
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
      const userId1 = await createUser("Chatter");
      const roomCode = await createRoom(userId1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: userId1, username: "Chatter" });
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
      const userId1 = await createUser("Alice");
      const roomCode = await createRoom(userId1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      await delay(100);

      const chatPromise = waitForEvent<{ message: string }>(client, "chat_message");
      // Send message with control characters
      client.emit("send_chat_message", { message: "Hello\x00\x01\x02World\x7F!" });

      const msg = await chatPromise;
      expect(msg.message).toBe("HelloWorld!");
    });

    it("should cap message length at 200 characters", async () => {
      const userId1 = await createUser("Alice");
      const roomCode = await createRoom(userId1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      await delay(100);

      const longMessage = "A".repeat(300);
      const chatPromise = waitForEvent<{ message: string }>(client, "chat_message");
      client.emit("send_chat_message", { message: longMessage });

      const msg = await chatPromise;
      expect(msg.message.length).toBe(200);
      expect(msg.message).toBe("A".repeat(200));
    });

    it("should ignore empty messages after sanitization", async () => {
      const userId1 = await createUser("Alice");
      const roomCode = await createRoom(userId1);

      const client = createClient();
      await waitForConnect(client);
      client.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
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
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");
      const roomCode = await createRoom(userId1);
      await joinRoom(roomCode, userId2);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
      client2.emit("join_room", { roomCode, userId: userId2, username: "Bob" });
      await delay(100);

      const disconnectPromise = waitForEvent<{ userId: number; username: string }>(
        client1,
        "player_disconnected"
      );

      // Disconnect client2
      client2.disconnect();

      const event = await disconnectPromise;
      expect(event.userId).toBe(userId2);
      expect(event.username).toBe("Bob");
    });

    it("should NOT emit player_disconnected if socket was not in a room", async () => {
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");
      const roomCode = await createRoom(userId1);
      await joinRoom(roomCode, userId2);

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      // Only client1 joins the socket room
      client1.emit("join_room", { roomCode, userId: userId1, username: "Alice" });
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
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");

      const client1 = createClient();
      await waitForConnect(client1);

      // Join the lobby
      client1.emit("join_lobby", { userId: userId1 });
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
      const userId1 = await createUser("Alice");

      const client1 = createClient();
      await waitForConnect(client1);

      client1.emit("join_lobby", { userId: userId1 });
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
      const userId1 = await createUser("Alice");
      const userId2 = await createUser("Bob");

      const client1 = createClient();
      const client2 = createClient();
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      client1.emit("join_lobby", { userId: userId1 });
      client2.emit("join_lobby", { userId: userId2 });
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

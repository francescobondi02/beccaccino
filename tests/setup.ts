import { setSocketInstance } from "../src/socketInstance";
import { prisma } from "../src/db";
import { setRng, createSeededRng } from "../src/utils/random";
import { closeServer } from "./helpers/gameHelpers";

// Set environment to test
process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH_BYPASS = "true";
process.env.JWT_SECRET = "test-secret";

// Create a mock Socket.io instance
const mockIo: any = {
  to: (room: string) => ({
    emit: (event: string, data: any) => {
      // console.log(`[MOCK] Emitting ${event} to room ${room}`, data);
    },
  }),
  emit: (event: string, data: any) => {
    // console.log(`[MOCK] Broadcasting ${event}`, data);
  },
  sockets: {
    sockets: new Map(),
  },
};

// Initialize mock socket
setSocketInstance(mockIo);

// Seed the RNG with a fixed value so all tests are fully deterministic.
// The seed 42 is arbitrary — any constant will do. Each test file resets it
// in beforeEach via the helper so successive runs produce identical results.
const TEST_SEED = 42;
let restoreRng: (() => void) | null = null;

beforeEach(() => {
  // Reset the RNG to the same seed before every test so each test is independent
  if (restoreRng) restoreRng();
  restoreRng = setRng(createSeededRng(TEST_SEED));
});

afterAll(async () => {
  // Restore original RNG, close shared HTTP server, and disconnect Prisma
  if (restoreRng) restoreRng();
  await closeServer();
  await prisma.$disconnect();
});

import { setSocketInstance } from "../src/socketInstance";
import { prisma } from "../src/db";
import { setRng, createSeededRng } from "../src/utils/random";
import { closeServer } from "./helpers/serverHarness";
import { clearAllTurnTimers } from "../src/runtime/turnTimer";

// Create a mock Socket.io instance
const mockIo: any = {
  to: (_room: string) => ({
    emit: (_event: string, _data: any) => {},
  }),
  emit: (_event: string, _data: any) => {},
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

afterEach(() => {
  clearAllTurnTimers();
});

afterAll(async () => {
  clearAllTurnTimers();
  if (restoreRng) restoreRng();
  await closeServer();
  await prisma.$disconnect();
});

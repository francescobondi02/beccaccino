import { setSocketInstance } from "../src/socketInstance";

// Set environment to test
process.env.NODE_ENV = "test";
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

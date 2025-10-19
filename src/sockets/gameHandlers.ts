// src/sockets/gameHandlers.ts
import { getSocket, isSocketConnected } from "./socketClient";

type UserShort = {
  userId: number;
  username: string;
};

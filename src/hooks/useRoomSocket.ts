// src/hooks/useRoomSocket.ts
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

interface UseRoomSocketProps {
  roomCode: string;
  user: { userId: number; username: string };
}

interface UseRoomSocketReturn {
  onPlayerJoined: (
    callback: (user: { userId: number; username: string }) => void
  ) => void;
  isConnected: boolean;
}

export const useRoomSocket = ({
  roomCode,
  user,
}: UseRoomSocketProps): UseRoomSocketReturn => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const playerJoinedCallbacks = useRef<
    ((user: { userId: number; username: string }) => void)[]
  >([]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      withCredentials: false,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("✅ Connected to room socket", socket.id);
      setIsConnected(true);

      // Join room
      socket.emit("join-room", { roomCode, user });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on(
      "player_joined",
      (data: { user: { userId: number; username: string } }) => {
        playerJoinedCallbacks.current.forEach((cb) => cb(data.user));
      }
    );

    return () => {
      socket.emit("leave-room", { roomCode });
      socket.disconnect();
    };
  }, [roomCode, user]);

  const onPlayerJoined = (
    callback: (user: { userId: number; username: string }) => void
  ) => {
    playerJoinedCallbacks.current.push(callback);
  };

  return {
    onPlayerJoined,
    isConnected,
  };
};

// src/hooks/useLobbySocket.ts
/**
 * Custom hook per gestire la connessione WebSocket alla lobby globale.
 * Gestisce eventi in tempo reale per nuove stanze, aggiornamenti, e stanze piene.
 */

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

interface Room {
  id: string;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
}

interface UseLobbySocketProps {
  userId: number | null;
  isAuthenticated: boolean;
}

interface UseLobbySocketReturn {
  isConnected: boolean;
  onRoomCreated: (callback: (room: Room) => void) => void;
  onRoomUpdated: (
    callback: (data: { roomCode: string; currentPlayers: number }) => void
  ) => void;
  onRoomFull: (callback: (data: { roomCode: string }) => void) => void;
}

export const useLobbySocket = ({
  userId,
  isAuthenticated,
}: UseLobbySocketProps): UseLobbySocketReturn => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Callbacks storage
  const roomCreatedCallbacks = useRef<((room: Room) => void)[]>([]);
  const roomUpdatedCallbacks = useRef<
    ((data: { roomCode: string; currentPlayers: number }) => void)[]
  >([]);
  const roomFullCallbacks = useRef<((data: { roomCode: string }) => void)[]>(
    []
  );

  useEffect(() => {
    // Connetti solo se autenticato e userId disponibile
    if (!isAuthenticated || !userId) {
      if (socketRef.current) {
        console.log("🔌 Disconnecting from lobby socket");
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    console.log("Connecting to socket at: ", SOCKET_URL);
    console.log("🔌 Connecting to lobby socket...");

    // Crea connessione socket
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      withCredentials: false, // Cambiato per evitare problemi CORS
      path: "/socket.io/", // Path esplicito
    });

    socketRef.current = socket;

    // Event: Connessione stabilita
    socket.on("connect", () => {
      console.log("✅ Connected to lobby socket:", socket.id);
      console.log("📡 Socket transport:", socket.io.engine.transport.name);
      setIsConnected(true);

      // Unisciti alla lobby globale
      socket.emit("join_lobby", { userId });
      console.log("🏠 Joined global lobby");
    });

    // Event: Disconnessione
    socket.on("disconnect", (reason) => {
      console.log("❌ Disconnected from lobby socket:", reason);
      setIsConnected(false);
    });

    // Event: Errore di connessione
    socket.on("connect_error", (error) => {
      console.error("❌ Lobby socket connection error:", error);
      console.error("Error message:", error.message);
      console.error("Attempting to connect to:", SOCKET_URL);
      setIsConnected(false);
    });

    // Event: Nuova stanza creata
    socket.on("room_created", (data: { room: Room }) => {
      console.log("🆕 New room created:", data.room);
      roomCreatedCallbacks.current.forEach((callback) => callback(data.room));
    });

    // Event: Stanza aggiornata (nuovo giocatore)
    socket.on(
      "room_updated",
      (data: { roomCode: string; currentPlayers: number }) => {
        console.log("🔄 Room updated:", data);
        roomUpdatedCallbacks.current.forEach((callback) => callback(data));
      }
    );

    // Event: Stanza diventata piena
    socket.on("room_full", (data: { roomCode: string }) => {
      console.log("🔒 Room full:", data.roomCode);
      roomFullCallbacks.current.forEach((callback) => callback(data));
    });

    // Event: Errore generico
    socket.on("error", (data: { message: string }) => {
      console.error("❌ Lobby socket error:", data.message);
    });

    // Cleanup alla disconnessione
    return () => {
      console.log("🔌 Cleaning up lobby socket");
      if (socket) {
        socket.emit("leave_lobby");
        socket.disconnect();
      }
      setIsConnected(false);
    };
  }, [userId, isAuthenticated]);

  // Funzioni per registrare callbacks
  const onRoomCreated = (callback: (room: Room) => void) => {
    roomCreatedCallbacks.current.push(callback);
  };

  const onRoomUpdated = (
    callback: (data: { roomCode: string; currentPlayers: number }) => void
  ) => {
    roomUpdatedCallbacks.current.push(callback);
  };

  const onRoomFull = (callback: (data: { roomCode: string }) => void) => {
    roomFullCallbacks.current.push(callback);
  };

  return {
    isConnected,
    onRoomCreated,
    onRoomUpdated,
    onRoomFull,
  };
};

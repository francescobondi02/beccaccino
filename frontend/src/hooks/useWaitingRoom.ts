import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Room } from "@contract/rooms";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { leaveRoom, registerRoomHandlers } from "@/sockets/roomHandlers";
import { subscribe } from "@/sockets/socketClient";

interface UseWaitingRoomOptions {
  roomCode: string | undefined;
  userId: number | null;
  onLoadError: (error: unknown) => void;
  onLeaveError: (error: unknown) => void;
}

export function useWaitingRoom({
  roomCode,
  userId,
  onLoadError,
  onLeaveError,
}: UseWaitingRoomOptions) {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const gameStarted = useRef(false);
  const loadFailed = useRef(false);
  const mayJoin = useRef(true);
  const departure = useRef<{
    key: string;
    request: Promise<boolean>;
  } | null>(null);

  const leaveWaitingRoom = useCallback((): Promise<boolean> => {
    if (!roomCode || !userId) {
      onLeaveError(new Error("Room and user are required to leave"));
      return Promise.resolve(false);
    }
    const key = `${userId}:${roomCode}`;
    if (departure.current?.key === key) return departure.current.request;

    const request: Promise<boolean> = apiPost<void>(`/rooms/${roomCode}/leave`, { onlyIfWaiting: true })
      .then(() => true)
      .catch((error: unknown) => {
        if (departure.current?.request === request) departure.current = null;
        if (error instanceof ApiError && error.status === 409) {
          gameStarted.current = true;
        }
        onLeaveError(error);
        return false;
      });
    departure.current = { key, request };
    return request;
  }, [onLeaveError, roomCode, userId]);

  useEffect(() => {
    mayJoin.current = true;
    gameStarted.current = false;
    loadFailed.current = false;
  }, [roomCode, userId]);

  const query = useQuery({
    queryKey: ["room", roomCode],
    queryFn: async () => {
      try {
        return await apiGet<Room>(`/rooms/${roomCode}`);
      } catch (error) {
        // Invite links reach non-members: join once, as the first load.
        if (!(mayJoin.current && error instanceof ApiError && error.status === 403)) throw error;
        return await apiPost<Room>(`/rooms/${roomCode}/join`);
      } finally {
        mayJoin.current = false;
      }
    },
    enabled: Boolean(userId && roomCode),
    retry: false,
  });
  const room = query.data ?? null;
  if (room?.started) gameStarted.current = true;

  useEffect(() => {
    if (!query.error) return;
    loadFailed.current = true;
    onLoadError(query.error);
  }, [onLoadError, query.error]);

  const refreshRoom = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["room", roomCode] }),
    [queryClient, roomCode],
  );

  const connectionStatus = useConnectionStatus();

  const isMember = room !== null;
  useEffect(() => {
    if (!isMember || !userId || !roomCode) return;

    // Joining the socket room also covers reconnects: refetch what we missed.
    const unregisterRoom = registerRoomHandlers(roomCode, () => void refreshRoom());
    const unsubscribe = subscribe("room_changed", () => {
      // After our own departure the room is no longer ours to load.
      if (!departure.current) void refreshRoom();
    });

    return () => {
      unsubscribe();
      unregisterRoom();
      if (!gameStarted.current) {
        leaveRoom(roomCode);
        // Route changes leave the room; reloads and effect replays keep membership.
        if (window.location.pathname !== pathname && !loadFailed.current) {
          void leaveWaitingRoom();
        }
      }
    };
  }, [isMember, leaveWaitingRoom, refreshRoom, pathname, roomCode, userId]);

  return {
    room,
    isLoading: query.isLoading,
    connectionStatus,
    leaveWaitingRoom,
    refreshRoom,
    configureBots: async (tier: string | null) => {
      const updatedRoom = await apiPost<Room>(`/rooms/${roomCode}/bots`, { tier });
      queryClient.setQueryData(["room", roomCode], updatedRoom);
    },
  };
}

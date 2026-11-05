import { useCallback, useEffect, useReducer, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { RoomResponse } from "@/rooms/model";
import {
  initialWaitingRoomState,
  waitingRoomReducer,
} from "@/rooms/waitingRoomState";
import {
  leaveRoom,
  registerRoomHandlers,
  subscribeToRoomEvent,
} from "@/sockets/roomHandlers";

interface UseWaitingRoomOptions {
  roomCode: string | undefined;
  userId: number | null;
  username: string;
  onLoadError: (error: unknown) => void;
  onLeaveError: (error: unknown) => void;
}

export function useWaitingRoom({
  roomCode,
  userId,
  username,
  onLoadError,
  onLeaveError,
}: UseWaitingRoomOptions) {
  const { pathname } = useLocation();
  const [state, dispatch] = useReducer(
    waitingRoomReducer,
    initialWaitingRoomState,
  );
  const gameStarted = useRef(false);
  const loadFailed = useRef(false);
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

    const request: Promise<boolean> = apiPost<void>(`/rooms/${roomCode}/leave`, {})
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

  const loadRoom = useCallback(async (isActive: () => boolean = () => true) => {
    const room = await apiGet<RoomResponse>(`/rooms/${roomCode}`);
    if (!isActive()) return;
    if (room.started) gameStarted.current = true;
    dispatch({ type: "room_loaded", room });
  }, [roomCode]);

  const connectionStatus = useConnectionStatus();

  useEffect(() => {
    if (!userId || !roomCode) return;
    let active = true;
    const isActive = () => active;
    gameStarted.current = false;
    loadFailed.current = false;

    dispatch({ type: "loading_started" });
    void loadRoom(isActive)
      .catch(async (error: unknown) => {
        // Invite links reach non-members: join first, then load as a member.
        if (!(error instanceof ApiError && error.status === 403)) throw error;
        await apiPost("/rooms/join", { roomCode });
        await loadRoom(isActive);
      })
      .catch((error: unknown) => {
        if (!active) return;
        loadFailed.current = true;
        dispatch({ type: "loading_finished" });
        onLoadError(error);
      });

    return () => {
      active = false;
    };
  }, [loadRoom, onLoadError, roomCode, userId]);

  const isMember = state.room !== null;
  useEffect(() => {
    if (!isMember || !userId || !username || !roomCode) return;

    const unregisterRoom = registerRoomHandlers(
      roomCode,
      { userId, username },
      () => void loadRoom().catch((error: unknown) => {
        console.error("Error refetching room on reconnect:", error);
      }),
    );
    const unsubscribers = [
      subscribeToRoomEvent("player_joined", ({ player }) => {
        dispatch({ type: "player_joined", player });
      }),
      subscribeToRoomEvent("player_left", ({ userId: leftUserId }) => {
        dispatch({ type: "player_left", userId: leftUserId });
      }),
      subscribeToRoomEvent("team_chosen", ({ userId: changedUserId, team }) => {
        dispatch({ type: "team_chosen", userId: changedUserId, team });
      }),
      subscribeToRoomEvent(
        "ready_changed",
        ({ userId: changedUserId, isReady }) => {
          dispatch({
            type: "ready_changed",
            userId: changedUserId,
            isReady,
          });
        },
      ),
      subscribeToRoomEvent("room_settings_changed", ({ room }) => {
        dispatch({ type: "room_loaded", room });
      }),
      subscribeToRoomEvent("game_started", () => {
        gameStarted.current = true;
        dispatch({ type: "game_started" });
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unregisterRoom();
      if (!gameStarted.current) {
        leaveRoom(roomCode);
        // Route changes leave the room; reloads and effect replays keep membership.
        if (window.location.pathname !== pathname && !loadFailed.current) {
          void leaveWaitingRoom();
        }
      }
    };
  }, [isMember, leaveWaitingRoom, loadRoom, pathname, roomCode, userId, username]);

  return {
    ...state,
    connectionStatus,
    leaveWaitingRoom,
    configureBots: async (tier: string | null) => {
      const room = await apiPost<RoomResponse>(`/rooms/${roomCode}/bots`, { tier });
      dispatch({ type: "room_loaded", room });
    },
    setPlayerTeam: (changedUserId: number, team: number) => {
      dispatch({ type: "team_chosen", userId: changedUserId, team });
    },
    setPlayerReady: (changedUserId: number, isReady: boolean) => {
      dispatch({ type: "ready_changed", userId: changedUserId, isReady });
    },
  };
}

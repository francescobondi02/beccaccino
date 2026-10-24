import { useCallback, useEffect, useReducer, useRef } from "react";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { apiGet } from "@/lib/api";
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
}

export function useWaitingRoom({
  roomCode,
  userId,
  username,
  onLoadError,
}: UseWaitingRoomOptions) {
  const [state, dispatch] = useReducer(
    waitingRoomReducer,
    initialWaitingRoomState,
  );
  const gameStarted = useRef(false);

  const refetchRoom = useCallback(async () => {
    if (!userId || !roomCode) return;

    try {
      const room = await apiGet<RoomResponse>(`/rooms/${roomCode}`);
      dispatch({ type: "room_loaded", room });
    } catch (error) {
      console.error("Error refetching room on reconnect:", error);
    }
  }, [roomCode, userId]);

  const connectionStatus = useConnectionStatus();

  useEffect(() => {
    if (!userId || !roomCode) return;
    let active = true;

    dispatch({ type: "loading_started" });
    void apiGet<RoomResponse>(`/rooms/${roomCode}?userId=${userId}`)
      .then((room) => {
        if (active) dispatch({ type: "room_loaded", room });
      })
      .catch((error: unknown) => {
        if (!active) return;
        dispatch({ type: "loading_finished" });
        onLoadError(error);
      });

    return () => {
      active = false;
    };
  }, [onLoadError, roomCode, userId]);

  useEffect(() => {
    if (!userId || !username || !roomCode) return;

    gameStarted.current = false;
    const unregisterRoom = registerRoomHandlers(
      roomCode,
      { userId, username },
      () => void refetchRoom(),
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
      subscribeToRoomEvent("game_started", () => {
        gameStarted.current = true;
        dispatch({ type: "game_started" });
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unregisterRoom();
      if (!gameStarted.current) leaveRoom(roomCode);
    };
  }, [refetchRoom, roomCode, userId, username]);

  return {
    ...state,
    connectionStatus,
    setPlayerTeam: (changedUserId: number, team: number) => {
      dispatch({ type: "team_chosen", userId: changedUserId, team });
    },
    setPlayerReady: (changedUserId: number, isReady: boolean) => {
      dispatch({ type: "ready_changed", userId: changedUserId, isReady });
    },
  };
}

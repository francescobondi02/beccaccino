import { useCallback, useEffect, useReducer, useRef } from "react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import {
  initialLobbyRoomsState,
  lobbyRoomsReducer,
  splitActiveGames,
  type LobbyRoomsResponse,
} from "@/rooms/lobbyState";
import {
  leaveLobby,
  registerLobbyHandlers,
  subscribeToLobbyEvent,
} from "@/sockets/lobbyHandlers";

export function useLobbyRooms(userId: number | null) {
  const [state, dispatch] = useReducer(
    lobbyRoomsReducer,
    initialLobbyRoomsState,
  );
  const requestSequence = useRef(0);

  const refreshRooms = useCallback(async (showLoading = true) => {
    const requestId = ++requestSequence.current;
    if (showLoading) dispatch({ type: "loading_started" });

    try {
      const data = await apiGet<LobbyRoomsResponse>("/rooms/available");
      if (requestId !== requestSequence.current) return;
      dispatch({ type: "rooms_loaded", data });
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      console.error("Error fetching rooms:", error);
      toast.error("Impossibile caricare le stanze disponibili");
      dispatch({ type: "loading_finished" });
    }
  }, []);

  useEffect(() => {
    if (userId) {
      void refreshRooms();
    } else {
      requestSequence.current += 1;
      dispatch({ type: "rooms_cleared" });
    }

    return () => {
      requestSequence.current += 1;
    };
  }, [refreshRooms, userId]);

  useEffect(() => {
    if (!userId) return;

    const unregisterLobby = registerLobbyHandlers(userId, () => {
      void refreshRooms(false);
    });
    const unsubscribers = [
      subscribeToLobbyEvent("room_created", ({ room }) => {
        dispatch({ type: "available_room_created", room });
      }),
      subscribeToLobbyEvent(
        "room_updated",
        ({ roomCode, currentPlayers }) => {
          dispatch({
            type: "available_room_updated",
            roomCode,
            currentPlayers,
          });
        },
      ),
      subscribeToLobbyEvent("room_full", ({ roomCode }) => {
        dispatch({ type: "available_room_removed", roomCode });
      }),
      subscribeToLobbyEvent("room_deleted", ({ roomCode }) => {
        dispatch({ type: "available_room_removed", roomCode });
      }),
      subscribeToLobbyEvent("practice_paused", ({ roomCode, pausedAt }) => {
        dispatch({ type: "practice_paused", roomCode, pausedAt });
        void refreshRooms(false);
      }),
      subscribeToLobbyEvent("practice_resumed", ({ roomCode }) => {
        dispatch({ type: "practice_resumed", roomCode });
        void refreshRooms(false);
      }),
      subscribeToLobbyEvent("practice_abandoned", ({ roomCode }) => {
        dispatch({ type: "practice_abandoned", roomCode });
        void refreshRooms(false);
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unregisterLobby();
      leaveLobby();
    };
  }, [refreshRooms, userId]);

  return {
    ...state,
    ...splitActiveGames(state.activeGames),
    refreshRooms,
  };
}

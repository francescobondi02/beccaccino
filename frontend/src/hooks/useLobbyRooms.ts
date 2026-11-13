import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LobbyRooms } from "@contract/rooms";
import { apiGet } from "@/lib/api";
import { splitActiveGames } from "@/rooms/lobbyState";
import {
  leaveLobby,
  registerLobbyHandlers,
  subscribeToLobbyChanges,
} from "@/sockets/lobbyHandlers";

export function useLobbyRooms(userId: number | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["lobby"],
    queryFn: () => apiGet<LobbyRooms>("/rooms/available"),
    enabled: userId !== null,
    retry: false,
  });

  useEffect(() => {
    if (!query.error) return;
    console.error("Error fetching rooms:", query.error);
    toast.error("Impossibile caricare le stanze disponibili");
  }, [query.error]);

  useEffect(() => {
    if (!userId) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["lobby"] });
    const unregisterLobby = registerLobbyHandlers(refresh);
    const unsubscribe = subscribeToLobbyChanges(refresh);

    return () => {
      unsubscribe();
      unregisterLobby();
      leaveLobby();
    };
  }, [queryClient, userId]);

  const rooms = userId === null ? undefined : query.data;
  return {
    availableRooms: rooms?.availableRooms ?? [],
    ...splitActiveGames(rooms?.activeGames ?? []),
    isLoading: userId !== null && query.isLoading,
  };
}

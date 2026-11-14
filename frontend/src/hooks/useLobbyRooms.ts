import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LobbyRooms } from "@contract/rooms";
import { apiGet } from "@/lib/api";
import { leaveLobby, registerLobbyHandlers } from "@/sockets/lobbyHandlers";
import { subscribe } from "@/sockets/socketClient";

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
    const unsubscribe = subscribe("lobby_changed", refresh);

    return () => {
      unsubscribe();
      unregisterLobby();
      leaveLobby();
    };
  }, [queryClient, userId]);

  const rooms = userId === null ? undefined : query.data;
  const activeGames = rooms?.activeGames ?? [];
  return {
    availableRooms: rooms?.availableRooms ?? [],
    pausedPracticeGames: activeGames.filter((game) => game.isPractice && game.pausedAt),
    ordinaryActiveGames: activeGames.filter((game) => !(game.isPractice && game.pausedAt)),
    isLoading: userId !== null && query.isLoading,
  };
}

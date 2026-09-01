import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import {
  registerLobbyHandlers,
  leaveLobby,
  subscribeToLobbyEvent,
} from "@/sockets/lobbyHandlers";
import CreateRoomPanel from "@/v2/components/lobby/CreateRoomPanel";
import JoinByCodePanel from "@/v2/components/lobby/JoinByCodePanel";
import RoomList from "@/v2/components/lobby/RoomList";
import type { LobbyRoom } from "@/v2/components/lobby/RoomList";
import ActiveGamesList from "@/v2/components/lobby/ActiveGamesList";
import { useV2Session } from "@/v2/hooks/useV2Session";
import { handleActiveRoomConflictV2 } from "@/v2/lib/roomRedirect";
import { v2Path } from "@/v2/lib/paths";

interface ApiRoom {
  id: number;
  code: string;
  players?: Array<{ id: number }>;
}

const toRoom = (room: ApiRoom): LobbyRoom => ({
  id: room.id,
  code: room.code,
  currentPlayers: room.players?.length ?? 0,
  maxPlayers: 4,
});

/**
 * First usable V2 screen. Sole owner of the lobby socket subscription; the
 * panels below are presentational.
 */
const V2Lobby = () => {
  const navigate = useNavigate();
  const { user, requireAuth } = useV2Session();
  const userId = user?.id ?? null;

  const [roomCode, setRoomCode] = useState("");
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  const [activeGames, setActiveGames] = useState<LobbyRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      const data = await apiGet<{
        availableRooms: ApiRoom[];
        activeGames: ApiRoom[];
      }>("/rooms/available");
      setRooms(data.availableRooms.map(toRoom));
      setActiveGames(data.activeGames.map(toRoom));
    } catch {
      toast.error("Impossibile caricare le stanze disponibili");
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    if (userId) {
      void fetchRooms();
      return;
    }
    setRooms([]);
    setActiveGames([]);
  }, [fetchRooms, userId]);

  useEffect(() => {
    if (!userId) return;

    const unregister = registerLobbyHandlers(userId);
    const removeRoom = ({ roomCode: code }: { roomCode: string }) =>
      setRooms((prev) => prev.filter((room) => room.code !== code));

    const unsubs = [
      subscribeToLobbyEvent("room_created", ({ room }) =>
        setRooms((prev) => [...prev, room as LobbyRoom]),
      ),
      subscribeToLobbyEvent("room_updated", ({ roomCode: code, currentPlayers }) =>
        setRooms((prev) =>
          prev.map((room) =>
            room.code === code ? { ...room, currentPlayers } : room,
          ),
        ),
      ),
      subscribeToLobbyEvent("room_full", removeRoom),
      subscribeToLobbyEvent("room_deleted", removeRoom),
    ];

    return () => {
      unsubs.forEach((off) => off());
      unregister();
      leaveLobby();
    };
  }, [userId]);

  const handleCreate = async () => {
    if (!requireAuth()) return;
    setCreating(true);
    try {
      const room = await apiPost<{ code: string }>("/rooms/", {});
      toast.success("Stanza creata!");
      navigate(v2Path.room(room.code));
    } catch (error) {
      if (!handleActiveRoomConflictV2(error, navigate)) {
        toast.error(
          error instanceof Error ? error.message : "Impossibile creare la stanza",
        );
      }
    } finally {
      setCreating(false);
    }
  };

  const joinRoom = async (code: string) => {
    if (!requireAuth()) return;
    try {
      await apiPost("/rooms/join", { roomCode: code });
      toast.success(`Accesso alla stanza ${code}`);
      navigate(v2Path.room(code));
    } catch (error) {
      if (!handleActiveRoomConflictV2(error, navigate)) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Impossibile entrare nella stanza",
        );
      }
    }
  };

  const handleJoinByCode = () => {
    if (!requireAuth()) return;
    const code = roomCode.trim();
    if (!code) {
      toast.error("Inserisci un codice stanza");
      return;
    }
    void joinRoom(code);
  };

  const handlePractice = () => {
    if (!requireAuth()) return;
    navigate(v2Path.practice());
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="becca-anim-rise text-center">
        <h1 className="text-3xl font-bold tracking-tight text-[hsl(var(--becca-on-felt))] sm:text-4xl">
          Beccaccino Online
        </h1>
        <p className="mt-2 text-sm text-[hsl(var(--becca-on-felt-soft))]">
          Siediti al tavolo: crea una stanza, entra con un codice o allenati
          contro i bot.
        </p>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <CreateRoomPanel
            onCreate={() => void handleCreate()}
            onPractice={handlePractice}
            creating={creating}
          />
          <JoinByCodePanel
            code={roomCode}
            onCodeChange={setRoomCode}
            onSubmit={handleJoinByCode}
          />
          <ActiveGamesList
            games={activeGames}
            onResume={(code) => navigate(v2Path.game(code))}
          />
        </div>

        <RoomList
          rooms={rooms}
          loading={loadingRooms}
          onJoin={(code) => void joinRoom(code)}
          onRefresh={() => void fetchRooms()}
        />
      </div>
    </div>
  );
};

export default V2Lobby;

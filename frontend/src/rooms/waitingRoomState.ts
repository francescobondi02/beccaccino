import type { Room, RoomPlayer } from "@contract/rooms";

export type WaitingRoomSlot =
  | RoomPlayer
  | { isBotPlaceholder: true; team: number | null }
  | null;

export function waitingRoomSlots(
  room: Room | null,
  currentUserId: number | null,
): WaitingRoomSlot[] {
  const players = [...(room?.players ?? [])].sort((left, right) => {
    if (left.userId === currentUserId) return -1;
    if (right.userId === currentUserId) return 1;
    return left.user.username.localeCompare(right.user.username);
  });

  const slots: WaitingRoomSlot[] = [...players];
  const teams = players.every((player) => player.team !== null)
    ? [0, 1].flatMap((team) =>
        Array.from(
          { length: 2 - players.filter((player) => player.team === team).length },
          () => team,
        ),
      )
    : [];
  while (slots.length < 4) {
    slots.push(
      room?.botTier
        ? { isBotPlaceholder: true, team: teams.shift() ?? null }
        : null,
    );
  }
  return slots;
}

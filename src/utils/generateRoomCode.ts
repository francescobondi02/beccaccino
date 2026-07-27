import { getRng } from "./random";

export function generateRoomCode(length: number = 6): string {
  // No 0/O or 1/I: codes get read aloud to friends joining a room.
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rng = getRng();
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(rng() * characters.length));
  }
  return result;
}

import { getRng } from "./random";

export function generateRoomCode(length: number = 6): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const rng = getRng();
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(rng() * characters.length));
  }
  return result;
}

import { prisma } from "../db";
import { generateRoomCode } from "../utils/generateRoomCode";

export async function generateUniqueRoomCode(): Promise<string> {
  let code: string;
  let exists: boolean;

  do {
    code = generateRoomCode();
    exists = Boolean(
      await prisma.gameRoom.findUnique({
        where: { code },
        select: { id: true },
      }),
    );
  } while (exists);

  return code;
}

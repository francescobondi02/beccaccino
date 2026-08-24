import type { Prisma } from "@prisma/client";

export const PUBLIC_PLAYER_SELECT = {
  id: true,
  userId: true,
  seat: true,
  team: true,
  isReady: true,
  user: {
    select: {
      id: true,
      username: true,
    },
  },
} satisfies Prisma.PlayerSelect;

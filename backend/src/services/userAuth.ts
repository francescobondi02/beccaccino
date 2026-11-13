import { prisma } from "../db";
import { conflict, unauthorized } from "../http/errors";
import { comparePassword, hashPassword } from "../utils/password";

type RegistrationInput = {
  username: string;
  password: string;
  email: string | null;
};

type LoginInput = {
  username: string;
  password: string;
};

function withoutPassword<T extends { password: unknown }>(
  user: T,
): Omit<T, "password"> {
  const { password: _, ...publicUser } = user;
  return publicUser;
}

export async function registerUser(input: RegistrationInput) {
  const existingUser = await prisma.user.findUnique({
    where: { username: input.username },
  });
  if (existingUser) throw conflict("Username already taken");

  if (input.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existingEmail) throw conflict("Email already in use");
  }

  const user = await prisma.user.create({
    data: {
      username: input.username,
      password: await hashPassword(input.password),
      email: input.email,
    },
  });
  return withoutPassword(user);
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { username: input.username },
  });
  if (
    !user ||
    user.deletedAt ||
    !user.password ||
    !(await comparePassword(input.password, user.password))
  ) {
    throw unauthorized("Invalid credentials");
  }
  return withoutPassword(user);
}

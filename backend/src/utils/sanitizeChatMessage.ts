const MAX_CHAT_MESSAGE_LENGTH = 200;
const UNSAFE_CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeChatMessage(input: unknown): string | null {
  if (typeof input !== "string") return null;

  const sanitized = input
    .trim()
    .slice(0, MAX_CHAT_MESSAGE_LENGTH)
    .replace(UNSAFE_CONTROL_CHARACTERS, "");

  return sanitized || null;
}

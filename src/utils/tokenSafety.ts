const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const DIRECTIONAL_AND_ZERO_WIDTH_CHARACTERS =
  /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

export const MAX_TOKEN_SYMBOL_LENGTH = 10;
export const MAX_TOKEN_NAME_LENGTH = 64;

function sanitizeTokenLabel(value: string | null | undefined, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, "")
    .replace(DIRECTIONAL_AND_ZERO_WIDTH_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();

  return normalizedValue || null;
}

export function normalizeTokenSymbol(value: string | null | undefined) {
  return sanitizeTokenLabel(value, MAX_TOKEN_SYMBOL_LENGTH);
}

export function normalizeTokenName(value: string | null | undefined, fallback?: string | null) {
  return sanitizeTokenLabel(value, MAX_TOKEN_NAME_LENGTH) ?? sanitizeTokenLabel(fallback, MAX_TOKEN_NAME_LENGTH);
}

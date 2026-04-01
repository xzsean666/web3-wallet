const encoder = new TextEncoder();

export async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));

  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}


const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_ITERATIONS = 310_000;
const ENCRYPTION_IV_BYTES = 12;
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

export interface PasswordVerifier {
  salt: string;
  hash: string;
}

export interface EncryptedSecretPayload {
  salt: string;
  iv: string;
  ciphertext: string;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(
  hex: string,
  options: {
    expectedBytes?: number;
    label?: string;
  } = {},
) {
  const normalizedHex = hex.trim();
  const label = options.label ?? "hex";

  if (
    !normalizedHex ||
    normalizedHex.length % 2 !== 0 ||
    !HEX_PATTERN.test(normalizedHex)
  ) {
    throw new Error(`Invalid ${label} payload`);
  }

  if (
    options.expectedBytes !== undefined &&
    normalizedHex.length !== options.expectedBytes * 2
  ) {
    throw new Error(`Invalid ${label} length`);
  }

  const bytes = new Uint8Array(normalizedHex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalizedHex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function getSubtleCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前运行环境缺少 WebCrypto，无法继续处理本地预览密钥材料");
  }

  return globalThis.crypto.subtle;
}

function getRandomBytes(length: number) {
  const bytes = new Uint8Array(length);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }

  return bytes;
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

async function importPasswordKey(secret: string) {
  return getSubtleCrypto().importKey("raw", encoder.encode(secret), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
}

async function derivePasswordDigest(secret: string, salt: Uint8Array) {
  const subtle = getSubtleCrypto();
  const passwordKey = await importPasswordKey(secret);
  const derivedBits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: toBufferSource(salt),
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    256,
  );

  return new Uint8Array(derivedBits);
}

async function deriveEncryptionKey(secret: string, salt: Uint8Array) {
  const subtle = getSubtleCrypto();
  const passwordKey = await importPasswordKey(secret);

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toBufferSource(salt),
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

export async function createPasswordVerifier(secret: string): Promise<PasswordVerifier> {
  const salt = getRandomBytes(PASSWORD_SALT_BYTES);
  const hash = await derivePasswordDigest(secret, salt);

  return {
    salt: bytesToHex(salt),
    hash: bytesToHex(hash),
  };
}

export async function verifyPassword(secret: string, verifier: PasswordVerifier) {
  const derivedHash = await derivePasswordDigest(
    secret,
    hexToBytes(verifier.salt, {
      expectedBytes: PASSWORD_SALT_BYTES,
      label: "password salt",
    }),
  );
  return timingSafeEqual(
    derivedHash,
    hexToBytes(verifier.hash, {
      expectedBytes: 32,
      label: "password hash",
    }),
  );
}

export async function encryptSecret(
  secret: string,
  password: string,
): Promise<EncryptedSecretPayload> {
  const subtle = getSubtleCrypto();
  const salt = getRandomBytes(PASSWORD_SALT_BYTES);
  const iv = getRandomBytes(ENCRYPTION_IV_BYTES);
  const key = await deriveEncryptionKey(password, salt);
  const ciphertext = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(iv),
    },
    key,
    encoder.encode(secret),
  );

  return {
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
  };
}

export async function decryptSecret(payload: EncryptedSecretPayload, password: string) {
  const subtle = getSubtleCrypto();
  const key = await deriveEncryptionKey(
    password,
    hexToBytes(payload.salt, {
      expectedBytes: PASSWORD_SALT_BYTES,
      label: "encryption salt",
    }),
  );
  const decrypted = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(
        hexToBytes(payload.iv, {
          expectedBytes: ENCRYPTION_IV_BYTES,
          label: "encryption iv",
        }),
      ),
    },
    key,
    toBufferSource(hexToBytes(payload.ciphertext, { label: "ciphertext" })),
  );

  return decoder.decode(decrypted);
}

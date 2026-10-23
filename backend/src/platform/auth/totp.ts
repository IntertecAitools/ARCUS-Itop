import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s), the
 * kind every authenticator app (Microsoft Authenticator, Google
 * Authenticator, 1Password...) reads from an otpauth:// link or QR code.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted either side of now, for clock drift: +/- 30 s. */
const DRIFT_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Not a base32 string.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new shared secret: 160 bits, as RFC 4226 recommends, in base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one time step (RFC 4226 HOTP with the step as counter). */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(binary).padStart(TOTP_DIGITS, "0");
}

/**
 * The time step a code belongs to, or undefined when it matches none near
 * now. Steps at or before `lastStep` are refused, so a code works once even
 * inside its 30 seconds (RFC 6238 section 5.2).
 */
export function verifyTotp(secret: string, code: string, atMs: number, lastStep = -1): number | undefined {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return undefined;
  const now = timeStep(atMs);
  for (let step = now - DRIFT_STEPS; step <= now + DRIFT_STEPS; step += 1) {
    if (step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(given))) return step;
  }
  return undefined;
}

/** What an authenticator app scans: otpauth://totp/Issuer:account?secret=... */
export function otpauthUrl(secret: string, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten one-time recovery codes, 50 bits each, shown as xxxxx-xxxxx. */
export const RECOVERY_CODE_COUNT = 10;

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const code = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/**
 * Recovery codes are kept only as SHA-256 hashes. They carry 50 random bits,
 * so a plain hash is enough: there is no dictionary to try.
 */
export function hashRecoveryCode(code: string): string {
  const normal = code.toLowerCase().replace(/[^a-z2-7]/g, "");
  return createHash("sha256").update(normal).digest("hex");
}

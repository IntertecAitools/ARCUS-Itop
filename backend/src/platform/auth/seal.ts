import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * AES-256-GCM sealing for small secrets the BFF writes down or hands to the
 * browser: authenticator secrets in the database, the single sign-on state
 * cookie. `binding` is authenticated data, so a sealed value only opens in
 * the place it was sealed for.
 */
export class Sealer {
  private readonly key: Buffer;

  /**
   * `secret` is SESSION_SECRET when set. Without one (memory mode, one BFF
   * instance) a random key is used, which is lost on restart -- as is
   * everything else that mode keeps.
   */
  constructor(secret: string | undefined, purpose: string) {
    this.key = secret ? scryptSync(secret, `arcus-bff-${purpose}`, 32) : randomBytes(32);
  }

  /** iv (12) | auth tag (16) | ciphertext. */
  seal(plain: string, binding: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(binding, "utf8"));
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  /** The plain text, or undefined when the value was tampered with or sealed elsewhere. */
  open(data: Buffer, binding: string): string | undefined {
    if (data.length < 28) return undefined;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(binding, "utf8"));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
    } catch {
      return undefined;
    }
  }
}

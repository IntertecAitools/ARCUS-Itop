import { constants, createPrivateKey, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { encodeContent, toBase64Url, writeLicenceFile, type Algorithm, type LicenceEnvelope } from "./format.js";

/**
 * Something that can sign bytes with a licence signing key. Production signs
 * in AWS KMS (the private key never leaves it); development and tests sign
 * with a local key pair. Both sit behind this one shape.
 */
export interface Signer {
  readonly kid: string;
  readonly alg: Algorithm;
  sign(data: Buffer): Promise<Buffer>;
}

/** Signs `data` with a private key held in this process. */
export function signWithKey(alg: Algorithm, key: KeyObject, data: Buffer): Buffer {
  if (alg === "Ed25519") return cryptoSign(null, data, key);
  return cryptoSign("sha256", data, {
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    // KMS's RSASSA_PSS_SHA_256 uses a salt as long as the digest; so do we,
    // so a licence signed either way verifies the same way.
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
}

/** A signer over a local PEM private key (development, tests, the installation's own key). */
export function localSigner(kid: string, alg: Algorithm, privateKeyPem: string): Signer {
  const key = createPrivateKey(privateKeyPem);
  const type = key.asymmetricKeyType;
  if (alg === "Ed25519" && type !== "ed25519") throw new Error(`Key for ${kid} is ${type}, not Ed25519.`);
  if (alg === "RSA-PSS-SHA256") {
    if (type !== "rsa" && type !== "rsa-pss") throw new Error(`Key for ${kid} is ${type}, not RSA.`);
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < 3072) throw new Error(`RSA keys must be 3072 bits or more (LIC-03); ${kid} has ${bits}.`);
  }
  return { kid, alg, sign: async (data) => signWithKey(alg, key, data) };
}

export interface GeneratedKeyPair {
  alg: Algorithm;
  privateKeyPem: string;
  publicKeyPem: string;
}

/** A new key pair, PEM-encoded (PKCS#8 private, SPKI public). */
export function generateSigningKeyPair(alg: Algorithm = "Ed25519"): GeneratedKeyPair {
  const pair =
    alg === "Ed25519"
      ? generateKeyPairSync("ed25519")
      : generateKeyPairSync("rsa", { modulusLength: 3072 });
  return {
    alg,
    privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/**
 * Signs a licence and writes its `.lic` text. `alg` and `kid` are taken from
 * the signer, so a file can never name a key other than the one that signed it.
 */
export async function signLicence<E>(
  fields: Omit<LicenceEnvelope<E>, "alg" | "kid">,
  signer: Signer,
): Promise<{ text: string; licence: LicenceEnvelope<E> }> {
  const licence = { ...fields, alg: signer.alg, kid: signer.kid } as LicenceEnvelope<E>;
  const content = encodeContent(licence);
  const signature = await signer.sign(Buffer.from(content, "ascii"));
  return { text: writeLicenceFile(licence.product, content, toBase64Url(signature)), licence };
}

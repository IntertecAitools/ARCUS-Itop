import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KMSClient, SignCommand, type SignCommandInput, type SigningAlgorithmSpec } from "@aws-sdk/client-kms";
import { DEV_KID, generateSigningKeyPair, localSigner, type Algorithm, type Signer } from "../sdk/index.js";

export const DEV_PRIVATE_KEY_FILE = "dev-private.pem";
export const DEV_PUBLIC_KEY_FILE = "dev-public.pem";

/**
 * Makes the development key pair in `dir` if it is not there yet. It stays
 * on the engineer's machine (the folder is in .gitignore) and is never a
 * production key: licences it signs carry kid "dev", which production
 * builds refuse.
 */
export function ensureDevKey(dir: string): { created: boolean; publicKeyPem: string } {
  const priv = join(dir, DEV_PRIVATE_KEY_FILE);
  const pub = join(dir, DEV_PUBLIC_KEY_FILE);
  if (existsSync(priv) && existsSync(pub)) return { created: false, publicKeyPem: readFileSync(pub, "utf8") };
  mkdirSync(dir, { recursive: true });
  const pair = generateSigningKeyPair("Ed25519");
  writeFileSync(priv, pair.privateKeyPem, { mode: 0o600 });
  writeFileSync(pub, pair.publicKeyPem);
  return { created: true, publicKeyPem: pair.publicKeyPem };
}

/** The development public key, when one has been made in `dir`. */
export function readDevPublicKey(dir: string): string | undefined {
  try {
    return readFileSync(join(dir, DEV_PUBLIC_KEY_FILE), "utf8");
  } catch {
    return undefined;
  }
}

export function devSigner(dir: string): Signer {
  ensureDevKey(dir);
  return localSigner(DEV_KID, "Ed25519", readFileSync(join(dir, DEV_PRIVATE_KEY_FILE), "utf8"));
}

export interface KmsSignerOptions {
  /** Key id, ARN or alias, e.g. alias/arcus-licence-signing. */
  keyId: string;
  /** The kid licences signed with this key carry; its public key is in sdk/public-keys.ts. */
  kid: string;
  alg: Algorithm;
  region?: string;
}

/** The KMS signing algorithm for ours. */
export const KMS_ALGORITHMS: Record<Algorithm, string> = {
  Ed25519: "ED25519_SHA_512",
  "RSA-PSS-SHA256": "RSASSA_PSS_SHA_256",
};

/** The `aws` arguments that sign one message file. Exported for the tests. */
/** The one KMS call we make, so tests can stand in for KMS. */
export interface KmsSignClient {
  send(command: SignCommand): Promise<{ Signature?: Uint8Array }>;
}

/** The KMS request for one signature: the raw message, not a digest. */
export function kmsSignInput(options: KmsSignerOptions, message: Uint8Array): SignCommandInput {
  return {
    KeyId: options.keyId,
    Message: message,
    MessageType: "RAW",
    SigningAlgorithm: KMS_ALGORITHMS[options.alg] as SigningAlgorithmSpec,
  };
}

/**
 * Signs in AWS KMS with whatever credentials the caller has: the
 * licence-issuer role on an operator's machine, the server's instance role
 * on the platform. The private key never leaves KMS.
 */
export function kmsSigner(options: KmsSignerOptions, client?: KmsSignClient): Signer {
  let kms = client;
  return {
    kid: options.kid,
    alg: options.alg,
    async sign(data) {
      kms ??= new KMSClient(options.region ? { region: options.region } : {});
      const { Signature } = await kms.send(new SignCommand(kmsSignInput(options, data)));
      if (!Signature?.length) throw new Error("KMS returned no signature.");
      return Buffer.from(Signature);
    },
  };
}

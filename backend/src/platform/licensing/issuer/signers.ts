import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEV_KID, generateSigningKeyPair, localSigner, type Algorithm, type Signer } from "../sdk/index.js";

const run = promisify(execFile);

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
export function kmsSignArgs(options: KmsSignerOptions, messageFile: string): string[] {
  return [
    "kms",
    "sign",
    "--key-id",
    options.keyId,
    "--message",
    `fileb://${messageFile}`,
    "--message-type",
    "RAW",
    "--signing-algorithm",
    KMS_ALGORITHMS[options.alg],
    "--query",
    "Signature",
    "--output",
    "text",
    ...(options.region ? ["--region", options.region] : []),
  ];
}

/**
 * Signs in AWS KMS through the AWS CLI, with whatever credentials the
 * caller has (the licence-issuer role). The private key never leaves KMS;
 * no AWS SDK dependency is added to the BFF for one call.
 */
export function kmsSigner(options: KmsSignerOptions, exec: typeof run = run): Signer {
  return {
    kid: options.kid,
    alg: options.alg,
    async sign(data) {
      const dir = mkdtempSync(join(tmpdir(), "arcus-licence-"));
      const file = join(dir, "message.bin");
      try {
        writeFileSync(file, data);
        const { stdout } = await exec("aws", kmsSignArgs(options, file), { maxBuffer: 1 << 20 });
        const sig = Buffer.from(String(stdout).trim(), "base64");
        if (!sig.length) throw new Error("KMS returned no signature.");
        return sig;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

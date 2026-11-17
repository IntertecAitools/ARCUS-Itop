# Intertec licensing SDK

The licence format, signing, verification, term arithmetic, binding checks
and signed documents, for any Intertec product. Arcus is its first user
(`../`, the BFF licence module).

**Self-contained by rule:** files here import only Node built-ins
(`node:crypto` and friends) and each other. Nothing from the rest of the
repository, no npm packages. A test (`test/licence-format.test.ts`, "the SDK
is self-contained") enforces it, so this folder can later become a shared
package unchanged.

| File | Holds |
| ---- | ----- |
| `format.ts` | The envelope fields every licence carries, canonical JSON, reading and writing the `.lic` file |
| `sign.ts` | The `Signer` shape (KMS in production, a local key in development and tests), key generation, `signLicence` |
| `verify.ts` | `verifyLicence`: the file, a trusted key's signature over exactly this content, the format version, the product, every field. Binding checks |
| `term.ts` | Where a licence is in its term on a day (active, expiring soon, grace, expired), the clock check, the release check for perpetual licences |
| `documents.ts` | Signed JSON documents: usage reports and activation requests (signed by an installation), revocation lists (signed by Intertec) |
| `public-keys.ts` | Intertec's trusted public keys, by `kid` |

## The licence

```
-----BEGIN ARCUS LICENCE-----
<canonical JSON of the fields, base64url, wrapped at 64>
.
<signature over the content text above, base64url>
-----END ARCUS LICENCE-----
```

The JSON is the common envelope plus a product's `entitlements` object:

```json
{
  "product": "arcus", "key_version": 1, "alg": "RSA-PSS-SHA256", "kid": "arcus-2026-1",
  "licence_id": "ARC-2026-000123", "customer_name": "Example Co", "order_ref": "SO-45678",
  "licence_type": "subscription", "term_years": 3,
  "issued_at": "2026-12-01T09:00:00Z", "valid_from": "2026-12-01", "expires_at": "2029-11-30",
  "maintenance_until": null, "grace_days": 30,
  "binding": "tenant:acme", "instances": { "production": 1, "nonprod": 1, "standby": 1 },
  "entitlements": { "...": "product-specific; the product passes a validator" }
}
```

Algorithms: `Ed25519`, or `RSA-PSS-SHA256` with a key of 3072 bits or more
(LIC-03). The algorithm is taken from the trusted key, never from the file
alone. A product supplies `validateEntitlements`; the SDK checks it only
after the signature.

`kid: "dev"` is the development key: refused unless the caller passes
`allowDevKey`, which a production build never does.

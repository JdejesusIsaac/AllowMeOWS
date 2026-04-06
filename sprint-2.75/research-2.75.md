# AllowanceAgent — research.md (Sprint 2.75)

## Phase 0a: Problem Framing

### Problem Statement
AllowanceAgent prompts the admin for a "secret phrase" during distribution. This is a UX wall — a non-technical parent will abandon immediately. The current `OWS_PASSPHRASE` env var model is single-tenant (one passphrase for all wallets on the server) and doesn't scale to multi-family deployments. Before deploying to Railway for testing with family, this must be eliminated.

### "What Is" Statement
Sprint 2.5 shipped 165 tests, 12 MCP tools, multi-asset savings (USDC + PAXG), and the full feature set. But wallet operations still reference `OWS_PASSPHRASE` — even though Sprint 2 moved it from tool args to env var (Bug #5), the tool layer still reads `process.env.OWS_PASSPHRASE` and Claude may still prompt the user if it's not set or if the tool response mentions passphrases.

### Solution Hypothesis
Replace the single `OWS_PASSPHRASE` with a `MASTER_KEY` that encrypts auto-generated per-family keys. The parent never touches, sees, or knows about any key. The operator sets one `MASTER_KEY` in Railway env vars. Everything else is automatic.

### Scope Boundary

**In scope:**
- `FamilyKeyManager` class (generate, store, retrieve per-family keys)
- Master key validation utility + CLI generator
- Update all wallet-touching tools to use auto-resolved family keys
- Update Fitbit token encryption to use MASTER_KEY
- Remove ALL passphrase references from user-facing surfaces
- Backward compatibility with existing `OWS_PASSPHRASE` families
- Tests + README updates

**Out of scope:**
- MASTER_KEY rotation tool (Sprint 3)
- Hardware security module integration (V3+)
- Per-family key backup/export (V3+)
- Database migration from JSON files (V3+)

---

## Phase 0b: Technical Research

### 1. Per-Family Key Architecture

**Key hierarchy:**

```
MASTER_KEY (env var, hex string, 256-bit)
    │
    ├── encrypts → family-keys.json
    │     ├── "garcia-family": { encryptedKey, iv, tag }
    │     ├── "johnson-family": { encryptedKey, iv, tag }
    │     └── "chen-family": { encryptedKey, iv, tag }
    │
    ├── garcia family key → encrypts OWS wallets for Garcia family
    ├── johnson family key → encrypts OWS wallets for Johnson family
    └── chen family key → encrypts OWS wallets for Chen family
```

**Encryption scheme:** AES-256-GCM (same as OWS uses internally, same as Fitbit token store already uses).

**Key generation:**
```typescript
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

function generateFamilyKey(): Buffer {
  return randomBytes(32); // 256-bit random key
}

function encryptWithMasterKey(masterKey: Buffer, plaintext: Buffer): {
  encrypted: string;
  iv: string;
  tag: string;
} {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

function decryptWithMasterKey(
  masterKey: Buffer,
  encrypted: string,
  iv: string,
  tag: string
): Buffer {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "hex")),
    decipher.final(),
  ]);
}
```

**Storage format (`data/family-keys.json`):**
```json
{
  "garcia-family": {
    "encryptedKey": "a1b2c3d4...",
    "iv": "e5f6a7b8...",
    "tag": "c9d0e1f2...",
    "createdAt": "2026-04-06T..."
  }
}
```

### 2. Family ID Derivation

Each family needs a stable identifier. Options:

- **UUID generated at configure-policy time** — stored in family-config.json
- **Derived from family name** — `slugify(familyName)` e.g., "garcia-family"
- **First child's name-based** — fragile if family is renamed

**Decision:** Generate a UUID at configure-policy time. Store as `familyId` in family-config.json. Use it as the key in family-keys.json. Derive from family name as a human-readable label only.

### 3. Tool Flow Changes

**Before (current):**
```
distribute-allowance
  → reads process.env.OWS_PASSPHRASE
  → passes to WalletDistributor
  → OWS decrypts wallet with passphrase
  → signs transaction
```

**After (Sprint 2.75):**
```
distribute-allowance
  → looks up familyId from child's family config
  → calls FamilyKeyManager.getFamilyKey(familyId)
  → FamilyKeyManager reads encrypted key from family-keys.json
  → FamilyKeyManager decrypts with MASTER_KEY
  → passes decrypted key to WalletDistributor as passphrase
  → OWS decrypts wallet with that key
  → signs transaction
```

The change is isolated to the passphrase source — everything downstream (WalletDistributor, OWS, viem) stays identical.

### 4. Master Key Resolution (Auto-Provisioning)

The operator should never have to run a command. The server self-provisions:

```typescript
// src/keys/master-key.ts
import { randomBytes, readFileSync, writeFileSync, existsSync } from "crypto";
import { join } from "path";

const MASTER_KEY_FILE = join(dataDir, ".master-key");
let cachedKey: Buffer | null = null;

export function resolveMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  // Priority 1: env var (production / Railway)
  if (process.env.MASTER_KEY) {
    const key = Buffer.from(process.env.MASTER_KEY, "hex");
    if (key.length < 32) throw new Error("MASTER_KEY must be at least 256 bits (64 hex chars)");
    console.error("[keys] Master key loaded from MASTER_KEY env var");
    cachedKey = key;
    return key;
  }

  // Priority 2: file (persisted from previous run)
  if (existsSync(MASTER_KEY_FILE)) {
    const key = readFileSync(MASTER_KEY_FILE);
    console.error("[keys] Master key loaded from data/.master-key");
    cachedKey = key;
    return key;
  }

  // Priority 3: auto-generate (first run)
  const key = randomBytes(32);
  writeFileSync(MASTER_KEY_FILE, key, { mode: 0o600 });
  console.error("[keys] Master key auto-generated at data/.master-key");
  console.error("[keys] Note: Set MASTER_KEY env var for ephemeral deployments (Railway, Docker)");
  cachedKey = key;
  return key;
}
```

**Three deployment scenarios:**

| Scenario | Master key source | Operator action |
|----------|------------------|-----------------|
| Local dev / testing with wife | Auto-generated to `data/.master-key` | None |
| Railway / Docker | `MASTER_KEY` env var in dashboard | Paste one value |
| VPS with persistent disk | Auto-generated on first run, persists | None |

The optional CLI helper (`npx tsx src/keys/generate-master-key.ts`) still exists for operators who want to pre-generate a key for Railway, but it's never required. The README documents it as an optional production step, not a prerequisite.

### 5. Backward Compatibility

Existing families set up with `OWS_PASSPHRASE`:
- If `OWS_PASSPHRASE` env var is set AND the family has no entry in `family-keys.json`, use `OWS_PASSPHRASE` as the passphrase (legacy mode)
- Log deprecation warning once: "Using legacy OWS_PASSPHRASE for family [familyId]. New families will use per-family keys."
- If NEITHER `MASTER_KEY` env var, `data/.master-key` file, nor `OWS_PASSPHRASE` is available AND `data/` is not writable → refuse to start

Migration path: master key auto-resolves (env var → file → generate). Existing families keep using `OWS_PASSPHRASE` until re-configured. New families get per-family keys automatically. The server always starts — no manual setup required.

### 6. What Gets Deleted

Every occurrence of these strings in user-facing code:
- `"passphrase"` in any tool schema `inputSchema`
- `"secret phrase"` in any tool response text
- `"Enter your passphrase"` or similar in any error message
- `OWS_PASSPHRASE` in any tool handler (moved to FamilyKeyManager fallback only)

---

## Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| Where does familyId come from? | ✅ Resolved | UUID generated at configure-policy time, stored in family-config.json |
| What if master key is lost? | ✅ Resolved | Family keys unrecoverable. For Railway: set env var (persistent). For VPS: back up `data/.master-key`. |
| Can two families share a server? | ✅ Resolved | Yes — each family gets its own key in family-keys.json. Multi-tenant by design. |
| Does OWS need changes? | ✅ Resolved | No. OWS accepts any passphrase string. We just change what we pass to it. |
| What about key rotation? | 🔜 Sprint 3 | Re-encrypt all family keys with new master key. Out of scope for 2.75. |
| Does the operator need to run a command? | ✅ Resolved | No. Server auto-generates on first startup. Optional env var for ephemeral platforms. |
| What if data/ is ephemeral? | ✅ Resolved | Set `MASTER_KEY` env var. Auto-generated file key is for persistent disk only. Startup log warns about ephemeral storage. |
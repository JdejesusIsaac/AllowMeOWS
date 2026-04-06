# AllowanceAgent — plan.md (Sprint 2.75)

## Feature Summary

Sprint 2.75 eliminates the passphrase UX blocker by implementing server-managed per-family encryption keys. No parent, co-parent, child, or family member ever sees, enters, or manages a passphrase. The operator sets one `MASTER_KEY` env var at deployment. AllowanceAgent auto-generates a unique encryption key per family during `configure-policy`, encrypts it with the master key, and uses it transparently for all wallet operations. Zero user-facing key management.

## Problem Statement

The current architecture requires `OWS_PASSPHRASE` as a single env var that encrypts all OWS wallets. This creates two problems:

1. **UX blocker:** Claude prompts the admin for a passphrase during distribution. A non-technical parent hitting "enter your secret phrase" abandons immediately.
2. **Multi-tenant risk:** One passphrase for all families means one compromise exposes everyone. Doesn't scale to Success Academy (200+ families).

## Architecture Decision

### Server-Managed Per-Family Keys (Path A)

**Decision:** Replace single `OWS_PASSPHRASE` with a `MASTER_KEY` env var that encrypts auto-generated per-family keys. No passphrase in any tool schema, tool argument, tool response, or user-facing flow.

**How it works:**

```
Operator sets MASTER_KEY in Railway env vars (one time)
    │
    ▼
Parent: "Set up allowance for the Garcia family"
    │
    ▼
configure-policy internally:
    1. Generate random 256-bit family key (crypto.randomBytes(32))
    2. Encrypt family key with MASTER_KEY (AES-256-GCM)
    3. Store encrypted family key in data/family-keys.json
    4. Use family key as OWS passphrase for wallet creation
    5. Parent sees: "Done! Maya's allowance is set up."
    │
    ▼
distribute-allowance internally:
    1. Look up family key from data/family-keys.json
    2. Decrypt with MASTER_KEY
    3. Use decrypted family key as OWS passphrase for signing
    4. Parent sees: "$4.25 sent to Maya's wallet"
    │
    ▼
No passphrase prompt. No key management. No secret phrase.
The parent never knows keys exist.
```

**Security model:**

- `MASTER_KEY`: Resolved automatically on startup from three sources in priority order: (1) `MASTER_KEY` env var (Railway/production), (2) `data/.master-key` file (auto-generated on first run), (3) neither exists → generate random key, write to `data/.master-key`. Never logged, never in git, never in tool responses.
- Per-family keys: Random 256-bit, unique per family. Encrypted at rest with master key. Compromise of one family key doesn't expose others.
- OWS wallets: Encrypted with the per-family key. OWS's existing encryption (AES-256-GCM, key wiped after signing) still applies.
- If master key is rotated: re-encrypt all family keys with new master key (migration tool, Sprint 3).

**What gets removed:**

- `OWS_PASSPHRASE` env var — replaced by auto-resolved master key
- Any passphrase parameter in any tool schema
- Any passphrase prompt or reference in any tool response
- Any reference to "passphrase" or "secret phrase" in README user-facing sections
- Any CLI command the user or operator must run before the server works

---

## Implementation Steps

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| K1 | **Create `src/keys/family-keys.ts`** — FamilyKeyManager class. Methods: `generateFamilyKey(familyId: string): string` — generates random 256-bit key, encrypts with master key (AES-256-GCM), stores in `data/family-keys.json` keyed by familyId, returns the plaintext key (for immediate use during setup). `getFamilyKey(familyId: string): string` — reads encrypted key from storage, decrypts with master key, returns plaintext key. `hasFamilyKey(familyId: string): boolean` — checks if family key exists. Encryption uses `crypto.createCipheriv` / `crypto.createDecipheriv` with random IV per entry. Storage format: `{ [familyId]: { encryptedKey: string, iv: string, tag: string } }`. Gets master key from `resolveMasterKey()` (K2). | High | 1.5h |
| K2 | **Create `src/keys/master-key.ts`** — `resolveMasterKey(): Buffer` resolves the master key from three sources in priority order: (1) `MASTER_KEY` env var — if set, decode from hex, validate ≥ 32 bytes, use it. (2) `data/.master-key` file — if exists, read and use it. (3) Neither exists — generate `crypto.randomBytes(32)`, write to `data/.master-key` with file permissions `0o600` (owner read/write only), log "Master key auto-generated at data/.master-key", use it. Cache in memory after first resolution (singleton). Optionally provide a CLI helper `npx tsx src/keys/generate-master-key.ts` that outputs a random hex key for operators who want to pre-set it in Railway — but this is NEVER required. | Medium | 45m |
| K3 | **Update `configure-policy`** — On first family configuration: call `FamilyKeyManager.generateFamilyKey(familyId)`. Use returned key as passphrase for `WalletSetup.initializeWallets()`. Store familyId in family config (derive from family name or generate UUID). On subsequent configurations (family already exists): call `getFamilyKey(familyId)` for any wallet operations. Remove any passphrase parameter from tool schema if still present. | Medium | 1h |
| K4 | **Update `distribute-allowance`** — Replace `process.env.OWS_PASSPHRASE` with `FamilyKeyManager.getFamilyKey(familyId)`. Look up familyId from the family config that the child belongs to. Remove any passphrase reference from tool schema, tool response, and error messages. If family key not found, return: "Family wallet not initialized. Run configure-policy first." | Medium | 45m |
| K5 | **Update `release-savings`** — Same pattern as K4. Replace passphrase env var lookup with `getFamilyKey(familyId)`. | Low | 20m |
| K6 | **Update `WalletSetup` and `WalletDistributor`** — Change method signatures to accept passphrase as a parameter (injected by the tool handler after key lookup) instead of reading from `process.env.OWS_PASSPHRASE` directly. This makes the wallet layer passphrase-source-agnostic. | Medium | 30m |
| K7 | **Update Fitbit token encryption** — Currently uses `OWS_PASSPHRASE` as the encryption key for Fitbit tokens. Change to use `MASTER_KEY` directly (Fitbit tokens are server-level secrets, not per-family). Update `src/fitbit/token-store.ts`. | Low | 20m |
| K8 | **Remove all OWS_PASSPHRASE references** — Search entire codebase for `OWS_PASSPHRASE`, `passphrase`, `secret phrase`, `secret_phrase`. Remove from: env var documentation, tool schemas, tool responses, error messages, README user-facing sections. Replace with `MASTER_KEY` in operator-facing docs only. Update env var reference table in README. | Medium | 30m |
| K9 | **Startup validation** — On server start (both stdio and HTTP), call `resolveMasterKey()`. This always succeeds: either reads from env var, reads from file, or auto-generates. Log which source was used: "Master key loaded from MASTER_KEY env var" / "Master key loaded from data/.master-key" / "Master key auto-generated at data/.master-key". Warn if auto-generated on a platform with ephemeral storage: "Note: auto-generated master key will be lost if data/ is not persisted. Set MASTER_KEY env var for persistent deployments." The only failure case: `data/` directory not writable AND no env var set → clear error: "Cannot auto-generate master key: data/ directory not writable. Set MASTER_KEY env var instead." | Low | 20m |
| K10 | **Update README** — Operator setup section: how to generate MASTER_KEY, where to set it (Railway env vars). Remove all user-facing passphrase references. Add "Security Architecture" section explaining per-family key isolation. Update Quick Start to remove any passphrase setup steps. | Low | 30m |
| K11 | **Unit tests (10 tests)** — FamilyKeyManager: generate key, retrieve key, key not found error, MASTER_KEY not set error, different families get different keys, encrypted storage format validation, key decryption produces same key, invalid MASTER_KEY fails gracefully, familyId collision handling, backward compat (existing family without key gets auto-generated on next access). | Medium | 1h |
| K12 | **E2E test (6 steps)** — Fresh server → configure-policy creates family + generates key → distribute-allowance uses auto-resolved key (no passphrase prompt) → second family configured (different key) → release-savings uses correct family key → verify family-keys.json contains encrypted (not plaintext) keys. | Medium | 45m |
| K13 | **Migration: existing families** — If `data/family-config.json` exists but `data/family-keys.json` doesn't, the family was set up under the old `OWS_PASSPHRASE` model. Handle gracefully: if `OWS_PASSPHRASE` env var is also set (legacy), use it as a fallback for existing families while generating new keys for new families. Log deprecation warning: "OWS_PASSPHRASE is deprecated. Existing families will continue to work. New families use per-family keys from MASTER_KEY." | Medium | 45m |

**Sprint 2.75 estimate: ~8 hours**

---

## Dependencies and Risks

| Dependency | Risk | Mitigation |
|------------|------|------------|
| `MASTER_KEY` env var | Low | Single secret, set once. Same pattern as any database encryption key. |
| `crypto` (Node built-in) | None | No external dependency. AES-256-GCM is standard. |
| `data/family-keys.json` | Medium | Contains encrypted family keys. Must persist across deploys (Railway Volume). If lost, families need re-setup. |
| Backward compat with `OWS_PASSPHRASE` | Low | K13 handles migration. Old families keep working. New families use new system. |
| OWS wallet re-encryption | Out of scope | Existing wallets stay encrypted with their original passphrase. The family key IS the passphrase — just auto-managed now. |

## Fallback Approaches

- **MASTER_KEY not set at startup:** Server refuses to start with clear error message. No silent fallback to insecure mode.
- **family-keys.json corrupted or lost:** Families need re-configuration. Wallets are unrecoverable without the correct key. This is the same risk as losing `OWS_PASSPHRASE` today — just scoped per-family instead of global.
- **Migration fails:** `OWS_PASSPHRASE` env var continues to work as fallback for existing families. Operator can migrate at their pace.

---

## Sprint Contract — Sprint 2.75

### Success Criteria

1. **Zero passphrase prompts:** No tool schema, tool response, error message, or Claude interaction mentions "passphrase," "secret phrase," or asks the user for any key material. Parent says "distribute what Maya earned" → USDC moves. No intermediate step.
2. **Per-family key generation:** `configure-policy` auto-generates a unique 256-bit key per family. Two families on the same server have different keys. Keys are stored encrypted with master key.
3. **Transparent key resolution:** `distribute-allowance` and `release-savings` automatically look up the correct family key. No tool argument, no header, no user input required.
4. **Encrypted key storage:** `data/family-keys.json` contains only encrypted keys (AES-256-GCM). Plaintext keys never written to disk.
5. **Master key auto-resolves:** Server starts successfully with zero manual key setup. Three sources in priority: (1) `MASTER_KEY` env var, (2) `data/.master-key` file, (3) auto-generate and write to file. Server never refuses to start unless `data/` is unwritable and no env var is set. No CLI command required.
6. **Backward compatible:** Existing families set up with `OWS_PASSPHRASE` continue to work. Deprecation warning logged. New families use per-family keys.
7. **Fitbit tokens use master key:** Fitbit token encryption switched from `OWS_PASSPHRASE` to auto-resolved master key.
8. **All 165 existing tests still pass.** No regression.
9. **README updated:** Operator docs explain optional `MASTER_KEY` env var for production (Railway). All user-facing passphrase references removed. Quick Start works with zero env var setup.
10. **Zero operator setup for local use:** `npm start` works immediately. No key generation command, no env var, no config file. Server self-provisions. Optional `MASTER_KEY` env var for production deployments where filesystem is ephemeral.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Functionality | 35% | Key generation, transparent resolution, distribution without passphrase, migration |
| Auth / Security | 35% | Encrypted key storage, per-family isolation, MASTER_KEY validation, no plaintext keys on disk |
| Design / UX | 20% | Zero passphrase prompts, clean error messages, operator setup flow |
| Originality | 10% | Per-family key derivation pattern for consumer MCP server |

### Grading Thresholds

- **Pass:** All categories ≥ 70%. No category below 60%.
- **Fail:** Any category below 60%, OR Functionality below 70%, OR Auth/Security below 70%.
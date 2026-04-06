# AllowanceAgent — test.md (Sprint 2.75)

## Unit Tests: FamilyKeyManager

| # | Test | Expected | Category |
|---|------|----------|----------|
| FK1 | Generate family key produces 256-bit key | `generateFamilyKey()` returns 32-byte buffer | Functionality |
| FK2 | Generated key is stored encrypted in family-keys.json | File contains `encryptedKey`, `iv`, `tag` — NOT plaintext key | Auth/Security |
| FK3 | Retrieve key returns same key that was generated | `getFamilyKey(id)` === original plaintext key | Functionality |
| FK4 | Different families get different keys | `generateFamilyKey("a")` !== `generateFamilyKey("b")` | Auth/Security |
| FK5 | Key not found returns clear error | `getFamilyKey("nonexistent")` → "Family wallet not initialized" | Design/UX |
| FK6 | No MASTER_KEY env var and no file → auto-generates | Server starts, `data/.master-key` created, key is 32 bytes | Functionality |
| FK7 | Invalid MASTER_KEY length rejected | 16-byte hex string in env var → "MASTER_KEY must be at least 256 bits" | Auth/Security |
| FK8 | Wrong master key fails decryption | Encrypt with key A, decrypt with key B → authentication error | Auth/Security |
| FK9 | Backward compat: OWS_PASSPHRASE fallback | Family exists without entry in family-keys.json + OWS_PASSPHRASE set → uses OWS_PASSPHRASE | Functionality |
| FK10 | Master key from env var takes priority over file | Both env var and file exist → env var is used | Functionality |
| FK11 | Auto-generated file has restricted permissions | `data/.master-key` created with mode 0o600 | Auth/Security |

---

## Unit Tests: Tool Integration

| # | Test | Expected | Category |
|---|------|----------|----------|
| TI1 | configure-policy creates family key automatically | After configure, family-keys.json has entry for new familyId | Functionality |
| TI2 | distribute-allowance resolves key without passphrase arg | No `passphrase` in tool schema. Distribution succeeds using auto-resolved key. | Design/UX |
| TI3 | release-savings resolves key without passphrase arg | Same as TI2 for release flow. | Design/UX |
| TI4 | No tool schema contains "passphrase" | Scan all tool registrations — zero passphrase fields | Design/UX |
| TI5 | No tool response contains "passphrase" or "secret phrase" | Run configure + verify + distribute → no response text mentions passphrase | Design/UX |
| TI6 | Fitbit token encryption uses MASTER_KEY | Encrypt token → decrypt with MASTER_KEY → matches original | Auth/Security |

---

## E2E Test: Zero-Passphrase Family Setup and Distribution

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| E1 | Start server with NO env vars set, fresh data/ directory | Server starts, auto-generates master key, logs source. No error, no prompt. | Functionality |
| E2 | configure-policy for Garcia family ($15/week for Maya) | Family config created. family-keys.json has encrypted entry for familyId. No passphrase prompt. | Functionality |
| E3 | verify-achievement for Maya (reading, 90/100) | Achievement stored. No passphrase reference in response. | Functionality |
| E4 | distribute-allowance for Maya | USDC distribution succeeds (dry-run). Key auto-resolved. No passphrase prompt. Response says "$X.XX ready to send" — no mention of keys or passphrases. | Design/UX |
| E5 | configure-policy for Johnson family (second family on same server) | Second familyId created. Different encrypted key in family-keys.json. Garcia key unchanged. | Auth/Security |
| E6 | Verify family-keys.json is encrypted | Read file from disk. Parse JSON. No entry contains a plaintext 64-char hex string. All entries have `encryptedKey` + `iv` + `tag` fields. | Auth/Security |

---

## Test Count Summary

| Suite | Count |
|-------|-------|
| FamilyKeyManager unit tests (FK1-FK11) | 11 |
| Tool integration tests (TI1-TI6) | 6 |
| E2E zero-passphrase flow (E1-E6) | 6 |
| **Sprint 2.75 new tests** | **23** |
| **Carried from Sprint 2.5** | **165** |
| **Total after Sprint 2.75** | **188** |
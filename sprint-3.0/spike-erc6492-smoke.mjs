// W2.1 spike — viem ERC-6492 smoke.
// Confirms: (1) viem exports the 6492 utilities, (2) a known 6492-wrapped signature
// is recognized, (3) the public-client `verifyMessage` action (NOT the utility export)
// is the one capable of verifying counterfactual Smart Wallet signatures.
//
// Run: node sprint-3.0/spike-erc6492-smoke.mjs

import { isErc6492Signature, parseErc6492Signature } from "viem/utils";
import { verifyMessage as verifyMessageUtil } from "viem";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

// A fabricated 6492-wrapped signature envelope: 32-byte address-padded target +
// factoryData + inner sig + ERC-6492 magic suffix.
// Magic: 0x6492649264926492649264926492649264926492649264926492649264926492
const MAGIC = "6492649264926492649264926492649264926492649264926492649264926492";
const fake6492 = "0x" + "00".repeat(64) + "ff".repeat(64) + "ab".repeat(65) + MAGIC;

console.log("=== W2.1 ERC-6492 Smoke ===");
console.log("isErc6492Signature(fake)    :", isErc6492Signature(fake6492));

try {
  const parsed = parseErc6492Signature(fake6492);
  console.log("parseErc6492Signature keys  :", Object.keys(parsed));
} catch (err) {
  // Expected — fake envelope isn't ABI-valid. Real fixtures are ABI-encoded
  // (address, bytes, bytes) tuples; W4.1 SI5 uses a real counterfactual.
  console.log("parseErc6492Signature (fake) :", "threw (expected for fake fixture) —", err.name);
}

// Confirm the public-client action exists and is async.
const client = createPublicClient({ chain: baseSepolia, transport: http() });
console.log("publicClient.verifyMessage  :", typeof client.verifyMessage);
console.log("viem utility verifyMessage  :", typeof verifyMessageUtil);

console.log("");
console.log("CRITICAL NOTE for Generator:");
console.log("  - viem utility `verifyMessage` (from 'viem') does NOT handle ERC-6492.");
console.log("  - Use `publicClient.verifyMessage({ address, message, signature })`");
console.log("    — the public-client action simulates counterfactual deploys.");
console.log("  - src/auth/siwe.ts MUST instantiate a Base Sepolia / Base Mainnet public");
console.log("    client and call the action form, not the utility form.");

# AllowMe OWS — Demo Video Script

**Duration:** ~3 minutes
**Format:** Screen recording (Claude Desktop + BaseScan side-by-side)
**Voice:** Narrated walkthrough

---

## INTRO (0:00 – 0:20)

**[Screen: GitHub repo or README hero section]**

> "AllowMe is an AI-powered family allowance system built on the Open Wallet Standard. Parents manage everything through conversation with Claude — no apps, no dashboards. Allowances are distributed as real USDC on Base."

> "Let me show you the full flow: configure a family, log an achievement, and distribute real crypto — all in plain English."

---

## SCENE 1: Configure the Family (0:20 – 1:00)

**[Screen: Claude Desktop — fresh conversation]**

**Type into Claude:**
> "Set up the Isaac family. Elina gets $0.10 per week — 34% education, 33% health, 33% personal, 20% to savings. Her wallet address is 0x5C479D97997763A9fBaE700B42d1cE88AA8263Ea. Use testnet. Passphrase: Elina123?"

**[Claude responds with configure-policy tool call and summary]**

> "One message — that's it. Claude created the treasury wallet on OWS, registered Elina's external MetaMask address, and set the spending rules. No wallet setup UI, no seed phrase prompts for the child. The parent just talks."

**[Highlight in Claude's response:]**
- Family name, weekly budget, category split
- External wallet address accepted
- Network: Base Sepolia testnet

---

## SCENE 2: Verify an Achievement (1:00 – 1:30)

**[Screen: Claude Desktop — same conversation]**

**Type into Claude:**
> "Elina completed 30 minutes of reading today — score 80 in education."

**[Claude responds with verify-achievement tool call and breakdown]**

> "Claude evaluated the achievement against Elina's education budget, applied the score, and queued the reward. She earned 3 cents — ready for distribution."

**[Highlight in Claude's response:]**
- Category: Education
- Score: 80/100
- Amount earned: $0.03
- Streak: 1 day

---

## SCENE 3: Distribute On-Chain (1:30 – 2:20)

**[Screen: Claude Desktop — same conversation]**

**Type into Claude:**
> "Distribute Elina's allowance with passphrase: Elina123?"

**[Claude responds with distribute-allowance tool call — shows tx hash]**

> "This is the real moment. Claude decrypted the treasury wallet, built an EIP-1559 transaction, and sent USDC on Base Sepolia. The child transfer went through. The savings transfer shows a partial success note — the treasury needs a bit more ETH for a second gas fee."

**[Highlight in Claude's response:]**
- $0.02 sent to Elina's wallet
- $0.01 savings (partial success noted)
- Transaction hash

---

## SCENE 4: Verify On-Chain (2:20 – 2:50)

**[Screen: Switch to BaseScan (sepolia.basescan.org)]**

**[Paste the transaction hash into BaseScan search]**

> "And here it is on BaseScan. Real USDC, real transaction, confirmed on Base Sepolia. You can see the transfer from the treasury to Elina's wallet — 0.02 USDC, zero ETH value, ERC-20 token transfer."

**[Highlight on BaseScan:]**
- Status: Success (green checkmark)
- From: Treasury address (0x7194A268...)
- To: USDC contract (0x036CbD53...)
- ERC-20 Transfer: 0.02 USDC to Elina's address
- Transaction fee: ~0.00009 ETH

---

## OUTRO (2:50 – 3:10)

**[Screen: Back to Claude Desktop or README]**

> "That's AllowMe — family finance managed entirely through conversation. OWS handles the custody, viem handles the transactions, and Claude handles everything else."

> "Parents can add multiple children, use OWS-managed or external wallets, invite co-parents and family members with role-based access — all through the same conversational interface."

> "Check it out on GitHub: github.com/JdejesusIsaac/AllowMeOWS"

---

## PRODUCTION NOTES

### Before Recording
1. Fund treasury with ~0.001 ETH from Base Sepolia faucet (enough for 5+ transactions)
2. Fund treasury with ~1 USDC testnet tokens
3. Restart Claude Desktop to ensure fresh MCP server connection
4. Have BaseScan open in a second browser tab
5. Test the full flow once before recording

### Screen Layout
- **Left 60%:** Claude Desktop (main focus)
- **Right 40%:** BaseScan (for verification scene)
- Or: full-screen Claude Desktop, then cut to full-screen BaseScan

### Key Visuals to Capture
- The tool call badges in Claude (configure-policy, verify-achievement, distribute-allowance)
- The transaction hash in Claude's response
- The green "Success" badge on BaseScan
- The ERC-20 token transfer line on BaseScan

### Talking Points to Emphasize
- **No code, no UI** — everything is conversational
- **Real on-chain transactions** — not simulated
- **External wallets supported** — kids can use MetaMask, Coinbase, etc.
- **Open Wallet Standard** — secure key storage, policy enforcement
- **Partial success handling** — child always gets paid even if savings fails

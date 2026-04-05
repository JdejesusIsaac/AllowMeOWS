#!/usr/bin/env python3
"""AllowanceAgent unified policy — role-aware.

Receives PolicyContext on stdin from OWS policy engine.
Returns PolicyResult on stdout.
Reads role from policy_config to enforce role-specific rules.
"""
import json
import sys


def decode_erc20_transfer(data: str) -> tuple[str, int] | None:
    """Decode ERC-20 transfer(address,uint256) from calldata hex."""
    if not data or data == "0x":
        return None
    # Remove 0x prefix
    raw = data[2:] if data.startswith("0x") else data
    # transfer(address,uint256) selector = a9059cbb
    if len(raw) < 136 or raw[:8] != "a9059cbb":
        return None
    # address is in bytes 4-36 (padded to 32 bytes)
    to_addr = "0x" + raw[32:72]  # skip 24 bytes of padding + take 20 bytes
    # uint256 is in bytes 36-68
    amount = int(raw[72:136], 16)
    return (to_addr.lower(), amount)


def main():
    ctx = json.load(sys.stdin)
    config = ctx.get("policy_config", {})
    role = config.get("role", "unknown")
    tx = ctx.get("transaction", {})
    spending = ctx.get("spending", {})

    # === Advisor role: block ALL signing ===
    if role == "advisor":
        json.dump(
            {"allow": False, "reason": "Advisor role: read-only access"},
            sys.stdout,
        )
        return

    # === Learner role: block ALL signing ===
    if role == "learner":
        json.dump(
            {"allow": False, "reason": "Learner role: read-only access"},
            sys.stdout,
        )
        return

    # === Co-parent role: no fund transfers ===
    if role == "co-parent":
        json.dump(
            {"allow": False, "reason": "Co-parent: no signing authority"},
            sys.stdout,
        )
        return

    # === Family role: only gift-fund wallet, capped amount ===
    if role == "family":
        allowed = [w.lower() for w in config.get("allowed_wallets", [])]
        # For ERC-20 transfers, tx["to"] is the USDC contract, not the wallet
        # We need to check the actual recipient from calldata
        transfer = decode_erc20_transfer(tx.get("data", ""))
        if transfer:
            recipient, amount = transfer
            max_gift = config.get("max_gift_amount", 0)
            if amount > max_gift:
                json.dump(
                    {"allow": False, "reason": f"Gift exceeds maximum (${amount / 1e6:.2f} > ${max_gift / 1e6:.2f})"},
                    sys.stdout,
                )
                return
            # For gift contributions, we allow if the transfer is valid
            json.dump({"allow": True}, sys.stdout)
            return
        else:
            # Non-ERC20 transaction — check direct value transfer
            if tx.get("to", "").lower() not in allowed:
                json.dump(
                    {"allow": False, "reason": "Family role: gift fund only"},
                    sys.stdout,
                )
                return
            max_gift = config.get("max_gift_amount", 0)
            if int(tx.get("value", 0)) > max_gift:
                json.dump(
                    {"allow": False, "reason": "Gift exceeds maximum"},
                    sys.stdout,
                )
                return
            json.dump({"allow": True}, sys.stdout)
            return

    # === Manager role: enforce spend cap + authorized recipients ===
    if role == "manager":
        max_weekly = config.get("max_weekly_distribution", 25000000)

        # Decode ERC-20 transfer to get actual USDC amount
        transfer = decode_erc20_transfer(tx.get("data", ""))
        if transfer:
            recipient, amount = transfer
            # Check spend cap using decoded USDC amount
            daily_total = int(spending.get("daily_total", 0))
            if daily_total + amount > max_weekly:
                json.dump(
                    {
                        "allow": False,
                        "reason": f"Weekly cap exceeded: ${(daily_total + amount) / 1e6:.2f} > ${max_weekly / 1e6:.2f}",
                    },
                    sys.stdout,
                )
                return
        else:
            # Non-ERC20: check ETH value against cap
            tx_value = int(tx.get("value", 0))
            daily_total = int(spending.get("daily_total", 0))
            if daily_total + tx_value > max_weekly:
                json.dump(
                    {"allow": False, "reason": "Weekly cap exceeded"},
                    sys.stdout,
                )
                return

        # Check authorized recipients for ERC-20 transfers
        authorized = [w.lower() for w in config.get("authorized_wallets", [])]
        if authorized and transfer:
            recipient, _ = transfer
            if recipient not in authorized:
                json.dump(
                    {"allow": False, "reason": f"ERC-20 recipient {recipient} not in authorized wallets"},
                    sys.stdout,
                )
                return
        elif authorized and tx.get("to", "").lower() not in authorized:
            json.dump(
                {"allow": False, "reason": "Recipient not in authorized wallets"},
                sys.stdout,
            )
            return

        json.dump({"allow": True}, sys.stdout)
        return

    # === Unknown role: deny ===
    json.dump(
        {"allow": False, "reason": f"Unknown role: {role}"},
        sys.stdout,
    )


if __name__ == "__main__":
    main()

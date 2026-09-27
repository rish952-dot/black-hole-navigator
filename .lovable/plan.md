# Real-money payouts via Stripe Connect (admin-only, capped)

Payouts go from your Stripe balance to connected accounts, triggered by the Farm. Small payouts go through automatically; bigger ones wait for your approval. Only you (signed in as admin) can trigger or approve them.

## Safety caps (enforced on the server, not changeable from the browser)

- Per payout: max $25
- Auto-approve only at or below $10; above that it's queued for manual approval
- Per day: max $100 total across all payouts
- Lifetime: max $500 until you raise it
- Max 10 payouts per hour
- Kill switch: payouts are OFF until you flip "Real payouts enabled" in Farm Config (stored on the server)
- Every request carries a unique key so a retry can never pay twice
- Destination must be a connected account you added yourself (allowlist); the farm cannot invent destinations
- Full audit log of every attempt, approval, rejection, and Stripe response

## What gets built

1. Sign-in (email + Google) and an admin role; you become the admin.
2. Database: payout settings (kill switch, caps), allowed destinations, and a payout log. Locked down so only the server function can write.
3. `payouts` server function: `request`, `approve`, `reject`, `list`, `settings`. Checks your session and admin role, validates input, applies every cap inside a database transaction, then calls Stripe Transfers with an idempotency key.
4. Client adapter that calls the function and never throws (same fail-soft style as the rest of the app).
5. Farm Config: new "Payouts" section: kill switch, destination list, pending approvals with Approve/Reject, recent payout log, and caps shown read-only.
6. Farm finance: modes stay simulation by default; the new `LIMITED_REAL` mode is only allowed when the server says payouts are enabled, and it routes through the capped payout function. `FULL_REAL` stays blocked.

## What you'll need to provide

- Your Stripe secret key (a restricted key limited to Transfers is recommended). It's stored securely on the server and never reaches the browser.
- Stripe Connect enabled on your account, plus the connected account IDs (acct_...) you want to pay.

## Technical notes

- Tables: `user_roles` (+ `has_role`), `payout_settings` (singleton), `payout_destinations`, `payouts` (status: pending_approval/approved/sent/failed/rejected, idempotency_key unique). RLS: admins read; writes only via service role in the function.
- Cap checks use a `SECURITY DEFINER` SQL function with `FOR UPDATE` row lock on settings to prevent concurrent overspend.
- Stripe call: `POST /v1/transfers` with `Idempotency-Key`; responses logged (without secrets).
- Tests: cap logic unit tests; finance clamp tests updated.

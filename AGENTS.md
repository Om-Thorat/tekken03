# Antigravity & Agent Instructions

All agents operating in this repository (via Antigravity IDE, `agy` CLI, or automated subagents) MUST read and follow the mandatory engineering directives in [.agents/rules/engineering-standards.md](file:///home/enigmeow/gh-proj/tekken-web/.agents/rules/engineering-standards.md).

## Critical Invariants:
1. **Pre-Execution Planning Gate:** Break down the full state machine/lifecycle, perform failure-mode analysis, and discuss assumptions with the user before writing code.
2. **Never Blindly Dismiss User Hypotheses:** Verify against ground truth C runtime, memory layouts, and packet handlers first.
3. **No Brittle Band-Aids:** No hardcoded frame cutoffs or rigid blocking flags without self-healing/reconciliation paths.
4. **Log & Review Regressions:** Review [docs/REGRESSION_LOG.md](file:///home/enigmeow/gh-proj/tekken-web/docs/REGRESSION_LOG.md) before making changes to sensitive modules (e.g. netplay synchronization).

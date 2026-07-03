#!/usr/bin/env python3
"""Researcher-push admission (G5): validate every entry in entries/ with the
SDK's grounded rule (publisher signature + coordinator-signed custody binding
the publisher's key to BOTH experiments), then rebuild registry/benchmarks.json
from exactly the valid set. Machines admit; no human curator.

Exit non-zero if ANY entry file fails — a PR adding an invalid entry cannot
merge, and main never carries an inadmissible file."""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from auspexai_tenant.benchmark_entry import verify_entry_grounded

ROOT = Path(__file__).resolve().parent.parent
failures: list[str] = []
valid: list[dict] = []

for f in sorted((ROOT / "entries").glob("*.json")):
    try:
        entry = json.loads(f.read_text())
    except ValueError as e:
        failures.append(f"{f.name}: not JSON ({e})")
        continue
    payload = verify_entry_grounded(entry)
    if payload is None:
        failures.append(
            f"{f.name}: INADMISSIBLE — signature or coordinator custody grounding failed"
        )
        continue
    print(
        f"OK {f.name}: peak {payload['report'].get('peak_eu')} EU "
        f"vs {payload['reference'].get('experiment_id')} "
        f"(publisher {payload['publisher_pubkey_hex'][:12]}…)"
    )
    valid.append(entry)

if failures:
    print("\n".join(failures), file=sys.stderr)
    sys.exit(1)

registry = {
    "schema": "auspexai-benchmark-registry/v0",
    "updated_at": datetime.now(UTC).isoformat(),
    "note": "Machine-admitted registry: every entry passed the grounded admission rule "
    "(publisher signature + coordinator-signed custody of both experiments). "
    "Re-check any entry: auspexai-tenant benchmark verify-entry <file>.",
    "entries": valid,
}
out = ROOT / "registry" / "benchmarks.json"
out.write_text(json.dumps(registry, indent=2))
print(f"registry rebuilt: {len(valid)} entr{'y' if len(valid) == 1 else 'ies'} → {out}")

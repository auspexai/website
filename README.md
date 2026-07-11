# AuspexAI Website

Source for the public landing page at [auspexai.network](https://auspexai.network).

Single static page (`index.html` + `style.css`); served by GitHub Pages at the custom domain in `CNAME`. Part of the [preneurial[works]](https://preneurial.works) family.

## Governance & policies

- [Governance](https://github.com/auspexai/.github/blob/main/GOVERNANCE.md) — roles, decision rules, recruitment, conflict of interest
- [Code of Conduct](https://github.com/auspexai/.github/blob/main/CODE_OF_CONDUCT.md) — community standards, reporting, escalation pathway
- [Contributing](https://github.com/auspexai/.github/blob/main/CONTRIBUTING.md) — DCO sign-off, PR workflow, RFC requirement for substantial architectural changes
- [Research Ethics Policy](https://github.com/auspexai/.github/blob/main/RESEARCH_ETHICS_POLICY.md) — what AI safety research can run on the network and how it's reviewed

## License

[AGPL-3.0](LICENSE).


## Drift Benchmark board

`benchmarks.html` renders `registry/benchmarks.json` — a MACHINE-ADMITTED registry:
researchers run `auspexai-tenant benchmark publish <run>`, which POSTs a self-grounding
signed entry to the submit Worker (`submit-worker/`); the Worker opens a PR adding it
under `entries/`; CI (`.github/workflows/benchmark-entries.yml`) verifies the entry
(publisher signature + coordinator-signed custody of both experiments, pinned signer)
and auto-merges on green; the registry rebuilds on a schedule. No human curator.

The board renders each entry as **two x/y scatter charts** (redesigned 2026-07-07):
**(1) magnitude × breadth** — worst-prompt drift (× noise floor) against the share of
prompts that moved (bottom-left = stable, top-right = drifts far and broadly; colour =
deterministic vs. sampling); and **(2) steady vs. sampled** — per model, deterministic
drift against temperature drift (fills in as each model is measured under both
conditions). Both are drawn client-side as inline SVG, with per-dot hover tooltips and
a table-view twin; every value re-checks its Ed25519 signature in the browser (nothing
is hand-entered). The chart code lives in `benchmarks.html`; the palette/marks follow
the shared dataviz method.

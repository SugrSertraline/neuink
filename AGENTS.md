# NeuInk repository instructions

## Branch workflow

- `main` is the approved release branch and the GitHub default branch.
- Use `alpha` for everyday feature development and integration of the latest capabilities. Base new feature branches on `alpha`; keep accepted fixes from `beta` and `main` flowing back into `alpha`.
- Use `beta` for stability testing of a reviewed candidate from `alpha`. Before promotion, record the source commit, retained features, intentional behavior/entry-point changes, data compatibility, validation and known limitations in `docs/development/dev-plan.md`, and obtain the user's confirmation that the feature set should be retained. Do not merge unrelated unfinished alpha work into an active beta candidate.
- Promote the tested `beta` candidate to `main` only after stability and effect/experience acceptance and the user's confirmation. Passing CI alone is not release approval. No automatic alpha-to-beta or beta-to-main promotion.
- Preserve research cards, ideation data and their compatibility when evolving the former `demo/ideation-evaluation` functionality. Explicitly document replaced or hidden interactions; retained source code alone does not prove feature or native Tauri acceptance.
- Development validation runs on alpha/beta pushes and pull requests through `.github/workflows/branch-validation.yml`; it does not publish release artifacts. See `docs/development/engineering-guidelines.md` for promotion evidence and scope.
- Keep `seal-campus-travel` local-only and separate for the campus travel prototype.
- The public `origin` may expose `main`, `beta` and `alpha` branches. Keep `seal-campus-travel`, local archive refs and work-in-progress snapshots local. The local pre-push hook preserves Git LFS handling and guards this policy; it is not a server-side permission rule.
- Before removing obsolete branches, verify their changes are merged or patch-equivalent and preserve a local recovery ref. Local branch-cleanup manifests and working-file backups live in `.git/branch-archives/`; archive refs are outside `refs/heads/`.
- Name branches by purpose without a `codex/` prefix.
- Desktop release artifacts and website deployments must come from `main`; release tags must point to commits already included in `main`. Pull requests targeting `main` may run validation without publishing artifacts.
- Keep unrelated uncommitted work out of maintenance commits and preserve it when switching branches.

## Local testing preference

- The working repository is `D:\NeuInk`; the local portable app and authoritative user data live in `D:\NeuInk\portable`. Daily use and local acceptance testing share this same standalone app. When the user asks to start NeuInk, launch `portable/Neuink.exe`; use `npm --workspace apps/desktop run dev:d-data` only when live development/debugging is explicitly needed.
- After a new local version has been validated for daily use, deploy its program and resources directly to `portable`, preserving `portable/data`; do not create another working copy or remap the data path. This standing local update preference does not authorize merging into `main` or publishing a release.
- On this Windows workstation, the everyday desktop shortcut is `Neuink.lnk`, pointing directly to `D:\NeuInk\portable\Neuink.exe`. Do not maintain a separate everyday development-test shortcut. The optional `apps/desktop/scripts/start-dev-windows.ps1` launcher remains available for explicit debugging and records startup output in `target/desktop-dev/launcher.log`.
- Close the portable app before starting development against the same data; do not run both simultaneously. Preserve the user's real papers, notes and settings. This is a local development preference, not authorization to merge into `main` or publish a release.

- When the Windows development launcher is explicitly used, it must show startup progress, restore an existing development window on repeated launch, and report failures with the log path. Keep background consoles hidden and write launcher logs as UTF-8.

## Code navigation

When a `.codegraph/` directory exists, use CodeGraph before grep/find or broad file reads to locate symbols, callers and current implementation paths. Indexing remains an explicit repository decision.

## UI work

Before changing UI or interaction code under `apps/desktop`, read and follow [`docs/development/ui-design-system.md`](docs/development/ui-design-system.md).

UI work must:

- reuse `apps/desktop/src/components/ui`, existing business components, hooks and installed libraries before creating alternatives;
- use the semantic tokens in `apps/desktop/src/styles/theme.css`;
- identify the state owner, scroll owner and keyboard/drag contract before implementation;
- keep dense desktop information layouts and avoid decorative card grids or meaningless icons;
- validate relevant normal, loading, empty, error, read-only, keyboard, scrolling and drag states;
- state explicitly when native Tauri visual validation was not completed.

Adding a UI dependency requires an explanation of why existing components and dependencies are insufficient.

## Engineering

Follow [`docs/development/engineering-guidelines.md`](docs/development/engineering-guidelines.md) for repository boundaries, naming, persistence and verification requirements.


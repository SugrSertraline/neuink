# NeuInk repository instructions

## Branch workflow

- `main` is the approved release branch and the GitHub default branch.
- Use `beta` for everyday feature development. Validate changes and obtain the user's confirmation before merging new features into `main`.
- Keep `seal-campus-travel` separate for the campus travel prototype.
- Name branches by purpose without a `codex/` prefix.
- Desktop release artifacts and website deployments must come from `main`; release tags must point to commits already included in `main`. Pull requests targeting `main` may run validation without publishing artifacts.
- Keep unrelated uncommitted work out of maintenance commits and preserve it when switching branches.

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


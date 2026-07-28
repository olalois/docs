# Contributing to Wraith Protocol Docs

Thanks for helping improve the Wraith Protocol documentation. This guide covers
everything you need to contribute — from branching strategy to getting your PR merged.

---

## Table of contents

1. [Branch model](#branch-model)
2. [Getting started](#getting-started)
3. [Making changes](#making-changes)
4. [Commit messages](#commit-messages)
5. [Opening a pull request](#opening-a-pull-request)
6. [Code and snippet standards](#code-and-snippet-standards)
7. [CI checks](#ci-checks)
8. [Review process](#review-process)

---

## Branch model

> **The most common mistake new contributors make is branching from `main` and
> targeting `main` in their PR. Please read this section carefully.**

| Branch    | Purpose                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `develop` | **Trunk.** All work branches off here. All PRs target here.            |
| `main`    | **Release.** Reflects what is live in production. Never push directly. |

```
main      ──────────────────────────────────────► (live / released)
               ↑ periodic release merges
develop   ──────────────────────────────────────► (trunk)
               ↑ your PRs merge here
feature/  ──────────────────────►
fix/      ──────────────────────►
docs/     ──────────────────────►
```

**Always branch from `develop`. Always target `develop` in your PR.**

`main` is updated only via controlled releases by maintainers. A PR targeting
`main` will be redirected or closed.

---

## Getting started

### Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) 10+

### Fork and clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/docs.git
cd docs

# Add upstream remote
git remote add upstream https://github.com/wraith-protocol/docs.git
```

### Install dependencies

```bash
pnpm install
```

### Sync with upstream before starting work

```bash
git fetch upstream
git checkout develop
git merge upstream/develop
```

### Create a branch

Branch names should use one of these prefixes:

| Prefix     | When to use                                             |
| ---------- | ------------------------------------------------------- |
| `feat/`    | New page or substantial new section                     |
| `fix/`     | Correcting a factual error, broken link, or bad example |
| `docs/`    | Meta-docs changes (this file, README, templates)        |
| `chore/`   | Config, CI, tooling, dependency updates                 |
| `refactor/`| Restructuring content without changing meaning          |

```bash
git checkout -b feat/stellar-multisig-guide
```

---

## Making changes

### File structure

Pages live at the repo root in their logical subdirectory. All content files are
`.mdx`. Internal docs (like this file) are `.md`.

```
CONTRIBUTING.md
README.md
getting-started.mdx
sdk/
guides/
architecture/
contracts/
api-reference/
```

See `CLAUDE.md` for the full content map.

### Writing style

- Short sentences. Active voice.
- Technical but approachable — assume TypeScript knowledge, not stealth-address
  cryptography knowledge.
- Every conceptual page needs at least one working code example.
- Use `@wraith-protocol/sdk` as the package name. Reference the `Chain` enum,
  not raw strings. All code examples must be TypeScript.
- No marketing copy. Describe what things do, not how great they are.

### MDX conventions

- Use `.mdx` extension for all public-facing docs.
- Keep frontmatter minimal — `title` and `description` are sufficient for most
  pages.
- Code fences must specify a language tag (e.g., ` ```typescript `).
- Use `no-check` only for intentionally non-runnable pseudocode (see
  [snippet standards](#code-and-snippet-standards) below).

---

## Commit messages

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<optional scope>): <short description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | When to use                                               |
| ---------- | --------------------------------------------------------- |
| `feat`     | A new page, section, or meaningful content addition       |
| `fix`      | Corrects an error — factual, typographical, or code-based |
| `docs`     | Changes to meta-docs (CONTRIBUTING.md, README.md, etc.)   |
| `chore`    | Tooling, CI, config, dependency updates                   |
| `refactor` | Content restructuring without meaning changes             |
| `style`    | Formatting only (whitespace, punctuation)                 |

### Examples

```
feat(guides): add stellar multisig withdrawal guide
fix(sdk): correct Chain enum example in agent-client reference
docs: expand CONTRIBUTING with branch model
chore(ci): pin actions/checkout to v4
refactor(architecture): reorganise TEE section headings
```

### Rules

- Subject line: 72 characters max, lowercase, no trailing period.
- Use the imperative mood — "add guide" not "added guide" or "adds guide".
- Reference issues in the footer: `Closes #91`
- **Do not** add `Co-Authored-By` lines.

---

## Opening a pull request

1. Push your branch to your fork:

   ```bash
   git push -u origin feat/your-branch-name
   ```

2. Open a PR on GitHub. Set:
   - **Base branch:** `develop` ← your branch
   - **Title:** Follow the conventional commits format (e.g.,
     `feat(guides): add stellar multisig withdrawal guide`)

3. Fill in the PR template completely. Incomplete templates slow down review.

4. A maintainer will review within a few business days. Address feedback with
   new commits — do not force-push after a review has started.

### Common PR mistakes to avoid

| Mistake | Correct approach |
| ----------------------------------- | ------------------------------------- |
| Branching from `main` | Always branch from `develop` |
| Targeting `main` in the PR | Always target `develop` |
| No conventional-commit prefix in title | Use `feat:`, `fix:`, `docs:`, etc. |
| Snippet check failing | Run `pnpm run check:snippets` locally first |
| Opting out snippets with `no-check` when they could compile | Prefer making snippets compile |

---

## Code and snippet standards

All TypeScript and JavaScript code fences in `.mdx` files are validated by the
snippet checker on every PR.

### Running the snippet check locally

```bash
pnpm run check:snippets
```

The checker extracts every ` ```ts `, ` ```tsx `, ` ```typescript `, ` ```js `,
and ` ```javascript ` fence, writes it to a temp file, and runs `tsc --noEmit`
against it. This catches syntax errors and malformed TypeScript before CI does.

### When a snippet fails

1. Fix the snippet so it compiles. This is the preferred path.
2. If the snippet is intentionally illustrative pseudocode that is not meant to
   run, add `no-check` after the language tag:

   ````mdx
   ```typescript no-check
   // This is pseudocode illustrating the concept only.
   const result = await someHypotheticalMethod();
   ```
   ````

   Use `no-check` sparingly. A snippet that can be made to compile should be.

### Stellar testnet snippets

A separate non-blocking CI job validates Stellar-specific snippets against the
live testnet. This job uses `continue-on-error: true` and will not block your
PR from merging. If it fails, a maintainer will investigate separately.

---

## CI checks

| Check | Blocking | Description |
| ---------------------------------- | -------- | ------------------------------------------------------------------ |
| Compile docs snippets | ✅ Yes | Runs `pnpm run check:snippets` on every PR |
| PR title lint | ✅ Yes | Enforces conventional commit format on PR title |
| PR target branch guard | ✅ Yes | Rejects PRs targeting `main` — retarget to `develop` |
| Stellar snippet testnet validation | ❌ No | End-to-end validation against Stellar testnet (non-blocking) |

The blocking checks must all pass before a PR can be merged. Check status is visible in the **Checks** tab of your PR.

The blocking check must pass before a PR can be merged. You can see check
status in the **Checks** tab of your PR.

---

## Review process

- Maintainers aim to review within **2 business days**.
- All feedback should be addressed in new commits, not by rewriting history
  after review has started.
- Once approved, a maintainer will squash-merge your PR into `develop`.
- Squash message will follow conventional commits format, referencing your PR.
- Periodic batches of `develop` → `main` are performed by maintainers as
  releases.

---

## Questions

Open an issue or start a discussion on GitHub. Tag it `question` so it gets
routed to the right people.

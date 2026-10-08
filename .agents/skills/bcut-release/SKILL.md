---
name: bcut-release
description: Release BaoCut Electron desktop apps through GitHub Actions tags by default; use local/manual packaging only when explicitly requested. Also handles App version bumps, release continuation and portable signing backups; excludes craft skills and legacy standalone CLI releases.
---

# BaoCut desktop releases

This is the Electron v3 App (`com.baocut.app`). The older baocut-app skill is a
reference, not this checkout's executable workflow. Keep this developer skill
outside the App's craft `skills/`; do not invoke legacy GPUI/npm/Homebrew releases.

## Select the workflow

| User intent | Read and follow |
| --- | --- |
| Ordinary release/publish request; no method specified | [Tag release](references/tag-release.md) — **default**. Prepare the version and frozen source, then push its release tag; Actions builds/releases Mac arm64 and Windows CPU/CUDA/Vulkan. |
| Explicit local package/candidate, traditional or manual release, single-platform recovery/continuation | [Traditional release](references/traditional-release.md). Honor the requested platforms and local-only/public scope. |
| Signing identity, portable backups or GitHub credentials only | [Signing/backups](references/signing-backups.md). Do not create a tag or publish. |

Load only the reference needed for the selected intent. Do not ask users to choose
between the two release methods when they have not specified one: use tag release.
Do not silently fall back to traditional packaging after an Actions failure.
A specific local-only or platform-only instruction overrides the default all-platform
scope; follow the user's explicit method and limits.

## Shared release constraints

- Inspect git status before edits; preserve unrelated or concurrent work. Commit
  task-owned source changes before freezing a release. Follow repository commit,
  current-task push authorization and worktree cleanup rules; do not reuse push
  authorization from another task or request it again when already granted here.
- `apps/desktop/package.json` owns the App version. Synchronize root version and
  lockfile through npm; do not bump Cargo or protocol versions for an App release.
- Query actual releases/feeds before choosing a build. Builds strictly increase;
  already published tags/files are immutable and historical skill Latest is preserved.
- Keep the tag and all platform artifacts tied to one full source SHA. Never ship
  dirty-source binaries, private signing materials or intermediate notary submissions.
- For every new published version/build, follow [release notes](references/release-notes.md):
  inventory the full commit/PR range, summarize large ranges in batches, reconcile
  coverage and publish the consolidated changelog. A local candidate keeps the
  same notes locally; platform continuation reuses the existing version's range.
- Report actual checks and skips. A tag push or credential check alone is not a
  completed release; publication requires successful jobs, public read-back, feeds
  and verified release notes.

The [desktop guide](../../../apps/desktop/README.md) owns packaging mechanics;
mode-specific references explain when to load it. Requests only to change release
configuration must not create a release tag or publish.

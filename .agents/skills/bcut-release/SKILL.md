---
name: bcut-release
description: Build, sign, notarize, verify and publish BaoCut Electron desktop releases, or prepare portable signing backups. Use for App version bumps, Mac releases and GitHub release continuation; excludes video-production craft skills and legacy standalone bcut CLI releases.
---

# BaoCut desktop releases

This is the Electron v3 App. The older baocut-app skill is a reference, not an
executable workflow for this checkout. Do not call its GPUI builder, modify its
website, or require standalone CLI/npm/Homebrew releases.

Read [desktop packaging](../../../apps/desktop/README.md) and
[signing and recovery](../../../docs/macos-signing.md). Repository commit/push
requirements apply. Keep this developer skill outside the App's craft skills.

## Freeze the release

- Inspect git status before edits; preserve unrelated work. Follow worktree cleanup
  rules if isolation is needed. Never build distributable bytes from dirty source.
- `apps/desktop/package.json` owns the App version; synchronize the root package
  version and lockfile with `npm version --no-git-tag-version`. Do not bump Cargo
  or protocol versions for an App release. Bundle ID is `com.baocut.app`.
- Build numbers strictly increase; the first v3 candidate is 3.0.0 build 60,
  following v2 build 59. Query actual releases before selecting later builds.
- Check Node >=22.18, Rust/wasm32, Xcode, native arm64 and disk space. Run affected
  tests/typecheck, desktop/Web builds, file-font/model-asset checks. Review generated
  tracked changes, commit the intended source and record full HEAD before packaging.

## macOS candidate

Select a full certificate SHA-1 from the external signing inventory, not its name:
several Developer ID certificates may share one name. Verify its encrypted PKCS#12
backup and validate `${BAOCUT_NOTARY_PROFILE:-baocut-notary}` with `notarytool history`.
Never print secrets or export the entire login keychain.

From the repo root, use a new output directory:

```bash
npm run package:mac -- \
  --build <BUILD> --sign-sha1 <CERTIFICATE_SHA1> \
  --out /absolute/path/to/new-release-directory \
  --download-base-url 'https://github.com/jimliu/baocut/releases/download/baocut-v<VERSION>-build.<BUILD>'
```

The builder packages default MLX/Core ML Workers and their release `mlx.metallib`.
If several Metal libraries exist, pass `--metallib` from that same Worker build;
never use an unrelated user cache. `--bin-dir` is for verified same-commit release
outputs only; record their provenance. CI may pass `--sign-keychain` too.

Electron-builder assembles a directory; `macos-distribution.mjs` signs inside out
with the exact fingerprint, checks native linkage, notarizes/staples the App,
verifies the final ZIP extraction, and separately signs/notarizes/staples the DMG.
Distribute `BaoCut-<VERSION>-build.<BUILD>-aarch64-apple-darwin.{zip,dmg}` and their
checksums, never the intermediate `notary-submission.zip` or an unsigned directory.
`app-release.json` records source commit, hashes/sizes, signer and notarization IDs.

The packager probes the exact extracted App's Runtime and native programs. Also
launch that App outside the repo with isolated data, inspect its real UI and
exercise preview/export. Record optional model/agent/ffmpeg dependencies and skips.
Never remove quarantine or disable Gatekeeper to make a check pass.

## Publish verified bytes

An explicit request to publish this version to GitHub authorizes release publication.
Repository rules separately require explicit permission to push task commits;
request it after the candidate and build commit are reviewable. The release tag
must identify the exact build commit, not a different remote branch HEAD.

1. Inspect existing tags/assets. Preserve immutable bytes; differing bytes require
   a new build. Identical assets may be skipped during a retry.
2. Once the build commit is remote, create a draft `baocut-v<VERSION>-build.<BUILD>`
   targeting it, with `--latest=false`. Retain its actual URL for the final report
   and open it in the Codex browser when useful. Write notes through a body file, including new Bundle ID,
   architecture, signing/notarization and verified dependencies. Preserve the old
   skill's GitHub Latest.
3. Upload ZIP, DMG, checksums, sanitized report and appcast. Remove local-only paths
   from the report. No private signing materials or intermediate submissions belong
   in release assets.
4. Publish, freshly download ZIP/DMG, compare hashes/sizes, extract ZIP and repeat
   signing/fingerprint, staple, Gatekeeper and packaged Runtime checks. Validate
   DMG signature/ticket too.
5. Last copy the generated appcast to `apps/desktop/releases/`, parse it with the App
   parser, commit and (when authorized) push the pointer. Read back its actual raw
   GitHub URL and `app.url`. Preserve other platform pointers.

Windows uses the existing `package:win*` commands and native validation in the
desktop README. A Mac-only release does not require Windows publication.

## Windows Actions continuation

Build from the published Mac tag with `desktop-windows.yml`, using the same build
number and that release's HTTPS download directory. Select CPU/CUDA/Vulkan explicitly;
each variant has a separate native build and installer/ZIP validation job.
Windows is unsigned; Apple Developer ID credentials are neither useful nor needed
for this path. Never inject the Mac signing backup into these workflows.

After the candidate finishes, dispatch `desktop-windows-publish.yml` with its
`candidate_run_id`, the existing `release_tag`, and a comma-separated `variants`
list. Publish only variants whose native job passed and whose artifact exists.
The publisher checks candidate workflow/repository/source against the Mac report,
verifies each file and update feed, appends immutable assets, independently reads
them back, and then commits/pushes only Windows update pins. It preserves Mac assets
and the historical skill's Latest. The run URL and full source SHA are recorded in
the supplemental Windows reports. A rerun may skip identical assets, never overwrite
different bytes. Failed or unverified GPU variants remain unpublished; native startup
does not imply inference has been tested on CUDA/Vulkan hardware.

## Completion

Report version/build, architecture, full source commit, local paths or release URL,
artifact facts, signer fingerprint, both notary IDs and runtime/visual checks/skips.
Publication requires public read-back and the updated feed. Report local backup,
off-machine recovery and actual CI execution separately. A request to save local
backups does not authorize uploading signing credentials into GitHub Secrets.

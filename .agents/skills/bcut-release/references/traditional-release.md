# Traditional release (explicit request only)

Read this only when the user explicitly requests local packaging, a local-only
candidate, manual publication, or a platform-specific recovery/continuation.
For ordinary release requests, return to [the default tag workflow](tag-release.md).
Do not switch here automatically when the tag workflow fails.

Read the [desktop packaging guide](../../../../apps/desktop/README.md) for the
selected platform and [signing and recovery](../../../../docs/macos-signing.md)
only when Mac signing or credential preparation is involved.

## Prepare the local builder

Check Node >=22.18 and the platform toolchain. Mac builds require native arm64,
Rust/wasm32, Xcode/Metal and enough disk space. Run affected tests/typecheck and
builds; check file fonts/model assets when affected. Commit the intended source
and record full HEAD before packaging. Preserve unrelated working-tree changes.

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

Keep this explicitly selected route separate from automatic tag publication.
The manual Actions publishers create tags with `GITHUB_TOKEN`, avoiding another
tag-triggered workflow. If a local/manual tag operation would also trigger
`desktop-release`, coordinate an explicit opt-out for this traditional release
and restore any changed workflow state afterward; do not launch both routes or
disable unrelated workflows.

An explicit request to publish this version to GitHub authorizes release publication.
Follow current-task push authorization; request any missing permission only after
the candidate and build commit are reviewable. Do not ask again if already
authorized. The release tag must identify the exact build commit, not a different
remote branch HEAD.

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

After the selected native jobs finish successfully, dispatch `desktop-windows-publish.yml` with its
`candidate_run_id`, the existing `release_tag`, and a comma-separated `variants`
list. Publish only variants whose native job passed and whose artifact exists.
The publisher checks candidate workflow/repository/source against the Mac report,
verifies each file and update feed, appends immutable assets, independently reads
them back, and then commits/pushes only Windows update pins. It preserves Mac assets
and the historical skill's Latest. The run URL and full source SHA are recorded in
the supplemental Windows reports. A rerun may skip identical assets, never overwrite
different bytes. Failed or unverified GPU variants remain unpublished; native startup
does not imply inference has been tested on CUDA/Vulkan hardware.

## Manual macOS Actions

Use `desktop-macos.yml` on this repository's `main` only when requested for
credential validation, a single-platform candidate or recovery. `mode=validate`
imports the identity into a temporary keychain, signs and executes a probe,
compares the signer fingerprint, validates Apple access and cleans up.
`mode=package` produces a signed/notarized candidate without a public release;
`mode=publish` also publishes it and updates only the Mac appcast. Packaging and
publication require a new increasing build and freeze the workflow SHA as source.

The publisher independently downloads the six public assets and performs native
signature, staple, Gatekeeper and Runtime checks before advancing the feed.
UI/export, real model inference and paid Agent calls are not automated; preserve
those skips in the report. Credential setup alone does not authorize publication.

## Report the result

For a local candidate, provide its paths, hashes/sizes, source SHA, actual signer
and notarization IDs, checks and skips; say clearly that it is not public. For a
published release, include its URL and verify public downloads and the live feed.
A local-only request must not trigger a tag push or GitHub publication.

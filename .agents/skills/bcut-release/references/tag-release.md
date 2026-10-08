# Tag release (default)

An ordinary request to release/publish BaoCut selects this workflow. Prepare the
version and frozen commit, then create/push the release tag to let Actions handle
packaging, signing, notarization, publication and update feeds. Do not build or
upload archives locally first, or manually dispatch platform publishers by default.
Follow current-task push authorization; source/tag pushes are external mutations.

## Prepare the source and tag

1. Inspect git status and actual GitHub releases/tags plus all platform appcasts.
   Choose the App version and a build higher than every current platform feed;
   never reuse an existing release identity or move an existing tag.
2. Update App/root versions and lockfile only if needed. The tag must be exactly
   `baocut-v<MAJOR>.<MINOR>.<PATCH>-build.<BUILD>`, e.g. `baocut-v3.0.1-build.61`:
   stable semantic version, no leading zeros, positive safe-integer build. Version
   must match root/desktop package.json and lockfile and must not go backwards.
3. Run the checks appropriate to the source change, review its diff, commit only
   task-owned changes and record full source SHA. Prepare and reconcile the full
   changelog using [release notes](release-notes.md) before pushing the tag.
   Local native toolchains and local App packaging are not prerequisites for
   this route; Actions builds them.
4. Ensure that frozen source is on remote `main` and contains the release workflow.
   Push needed source commits only when authorized. The tag must point to this
   exact commit, not whichever HEAD a later concurrent change produces. Check
   required GitHub Environment configuration without retrieving Secret values;
   Mac credential details are in [signing/backups](signing-backups.md).
5. Present the selected version/build, tag and source SHA before any required
   push approval. Then create an annotated tag and push that tag only, using the
   operator's Git credentials so its push event triggers GitHub Actions:

```bash
git tag -a "$release_tag" "$source_commit" -m "BaoCut $version build $build"
git push origin "$release_tag"
```

`release_tag`, `source_commit`, `version` and `build` above are the verified values
selected for this task. A request only to update this skill/configuration must not
create a release tag or trigger a release.

## Follow Actions to completion

Find the `desktop-release.yml` push run whose tag and full source SHA match this
release. Mac arm64 and Windows x64 CPU/CUDA/Vulkan build in parallel. All native
jobs must pass before publishing. Mac publishes first, then all three Windows
variants append to that same release, with public read-back before each feed update.
The workflow preserves historical Latest, existing assets and unrelated feeds.

Wait for the native jobs and both publishers, then merge the prepared changelog
into the actual Release body and verify it by read-back as described in
[release notes](release-notes.md). Merely pushing the tag is not a successful
publication. Report the run/release URLs, full source SHA, published platforms
and actual verification/skips. UI/export, real model/GPU inference and
paid Agent calls are not automated and must not be described as passed.

If a job fails, diagnose it and fix within authorized scope, then rerun failed jobs
with their validated candidates where possible. Never silently switch to the
traditional route, move/delete the tag, overwrite assets or rebuild different bytes
under an already published build. Explain any remaining blocker; use a traditional
recovery workflow only when the user explicitly requests it.

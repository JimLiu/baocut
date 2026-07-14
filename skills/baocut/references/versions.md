# Versions & branches

The pipeline is dependency-chained (transcribe → segment → polish → translate),
so re-doing an upstream stage can invalidate downstream work. Two mechanisms:

**Staleness + incremental re-translate.** Every translation cell records the
source it was made from. After a re-polish/edit, only the touched groups go
stale (word ids are stable). Check, then refresh ONLY those paragraphs:

```bash
baocut --json version list p7        # stale.segment / stale.polish (bool) ·
#                                        stale.translations {lang: count}
baocut --json task start translate p7 --lang zh --stale-only   # incremental!
#   -> re-translates only the out-of-date paragraphs, keeps the rest verbatim.
#      Needs an existing zh translation; drop --stale-only for a full re-translate.
```

So a typical "fix a few things" loop is: re-polish (`task start polish`) →
`version list` shows N stale zh lines → `task start translate --lang zh
--stale-only` refreshes just those. Drive both with the usual worker loop
(orchestration.md).

**Re-align (M68) is orthogonal to staleness.** `task start align <pid> --lang
zh [--groups …] [--from current|pristine]` redoes ONLY the "Splitting &
aligning" phase — the translation text stays (reviewer rewrites excepted), the
source didn't change, so re-align never flips staleness and stale counts never
demand it. Each applied run lands as a restorable "Re-aligned N lines" version
snapshot. Use it only when a requested timed deliverable's `audit`/`align list`
shows over-long lines and align is the one selected repair; presentation debt
does not trigger it in Project mode. Do not use it when `version list` shows
stale ones.

**Branches (parallel versions, git-like).** A change that alters the paragraph
partition — **re-transcribe** OR **re-segment** (`task start segment` on an
already-translated doc) — auto-forks a NEW branch, preserving the old
(translated) branch. After such a fork, run a FULL translate on the new branch
(the partition changed, so `--stale-only` does not apply). Switch between them:

```bash
baocut --json branch list p7                    # * marks the active branch
baocut --json branch switch p7 b-xxxx           # rewrites the working doc
baocut --json branch create p7 --name "Draft"   # fork from the active tip
baocut --json branch delete p7 b-xxxx           # non-active branches only
baocut --json version show p7 [<vid>]           # a version's doc stats
baocut --json version restore p7 <vid>          # restore a version's doc (reversible)
```

Read verbs are lock-free; mutating verbs take the project lock. Switching a
branch or restoring a version rewrites `doc.json` (a running GUI reconciles it).

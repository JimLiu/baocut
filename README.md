# BaoCut agent skill

Give your AI coding agent the power to drive **[BaoCut](https://baocut.app)** —
transcribe, add and translate subtitles, review speakers, edit timelines and
overlays, and export — all from natural language. This is the open-source
[Agent Skill](https://skills.sh) for BaoCut's local `bcut` CLI and browser-based
Subtitle Studio.

Works with **Claude Code**, **Codex**, and any [skills.sh](https://skills.sh)-compatible agent.

## Requirements

- **macOS** — install BaoCut from **[baocut.app](https://baocut.app)**. The skill
  uses the CLI bundled in `BaoCut.app`; on Apple silicon it can also download
  the signed standalone CLI pinned to the skill release.
- **Windows** — provide a local `bcut` executable through `BAOCUT_CLI`,
  `BCUT_EXECUTABLE`, or `PATH`. The skill operates the project through the
  browser-based Subtitle Studio; a pinned Windows CLI download is not included
  yet.
- **Node.js** — only for the one-command install below
  ([download](https://nodejs.org/en/download)). The manual steps need no Node.

## Install

### Recommended — skills.sh

```sh
npx skills add JimLiu/baocut -g -a claude-code codex -y
```

This installs the skill globally to `~/.agents/skills/baocut` and links it for
Claude Code and Codex.

### Manual (no Node.js)

```sh
git clone https://github.com/JimLiu/baocut.git ~/.agents/skills/baocut-src
ln -sfn ~/.agents/skills/baocut-src/skills/baocut ~/.agents/skills/baocut
# link it for each agent you use, e.g. Claude Code:
mkdir -p ~/.claude/skills
ln -sfn ~/.agents/skills/baocut ~/.claude/skills/baocut
```

## Use it

Once installed, just ask your agent — for example:

- **Claude Code** — "Transcribe and translate the subtitles of `talk.mp4` to
  Chinese," or the Chinese equivalent 转写并翻译字幕. You can also type `/baocut`.
- **Codex** — reference the baocut skill in your prompt; it drives the `baocut` CLI.

Under the hood the agent uses the bundled resolver to run commands like:

```sh
skills/baocut/bin/baocut --json auto talk.mp4 --lang zh
skills/baocut/bin/baocut export <projectId> --srt --translated --lang zh
```

The resolver honors an explicit CLI path, development builds, the CLI inside
BaoCut.app, `bcut` on `PATH`, and the release-pinned CLI cache in that order.

## Layout

```
skills/baocut/
  SKILL.md          # agent entry point (router)
  references/       # per-task guides (orchestration, editing, export, …)
  templates/        # browser-based Subtitle Studio
  cli-release.json  # immutable standalone CLI pin
  bin/baocut        # resolves, verifies, and runs the matching CLI
```

## Links

- App & docs — [baocut.app](https://baocut.app)
- skills.sh — [skills.sh](https://skills.sh)

## License

[MIT](LICENSE).

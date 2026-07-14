# BaoCut agent skill

Give your AI coding agent the power to drive **[BaoCut](https://baocut.app)** —
transcribe, add & translate subtitles, review speakers, clean up talking-head
video, and export — all from natural language. This is the open-source
[Agent Skill](https://skills.sh) that wraps the `baocut` command-line tool.

Works with **Claude Code**, **Codex**, and any [skills.sh](https://skills.sh)-compatible agent.

## Requirements

- **macOS** — BaoCut is a Mac app.
- **The BaoCut app** — install it from **[baocut.app](https://baocut.app)**. The
  skill drives the CLI bundled inside `BaoCut.app`; it does not ship the engines.
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

Under the hood the agent runs commands like:

```sh
baocut --json auto talk.mp4 --lang zh    # transcribe -> polish -> translate
baocut export <projectId> --srt --translated --lang zh
```

If `baocut` is not on your PATH, use the bundled resolver
`skills/baocut/bin/baocut` (it points at `/Applications/BaoCut.app/Contents/MacOS/baocut-cli`
and tells you to install the app if it is missing).

## Layout

```
skills/baocut/
  SKILL.md          # agent entry point (router)
  references/       # per-task guides (orchestration, editing, export, …)
  bin/baocut        # resolves the CLI inside the installed BaoCut.app
```

## Links

- App & docs — [baocut.app](https://baocut.app)
- skills.sh — [skills.sh](https://skills.sh)

## License

[MIT](LICENSE).

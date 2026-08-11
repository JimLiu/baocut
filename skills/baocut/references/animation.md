# Element animation

Animations are deterministic `enter`, `exit`, and `loop` slots on canonical
elements. Discover the frozen catalogue instead of inventing preset names:

```bash
bin/baocut animation list --json
bin/baocut animation show <preset-id> --kind enter --json
```

Select exactly one scope: `--id`, `--role`, or `--all-text`.

```bash
bin/baocut animation apply "/path/demo.bcut" --id <element-id> \
  --enter rise --enter-dur 0.7 --exit fade --exit-dur 0.7 --json
bin/baocut animation apply "/path/demo.bcut" --role broll \
  --enter fade --loop pulse --loop-period 2.4 --json
```

Prefer one strong preset over stacked motion. Keep entrances/exits visibly
readable (normally at least 0.6 seconds), and avoid simultaneous loops on many
elements. Use strength parameters to tune an established preset.

Preview a representative time and inspect the produced frame/summary:

```bash
bin/baocut animation preview "/path/demo.bcut" <element-id> \
  --at 12.4 --output "/tmp/animation" --json
```

Clear only the requested slot, or omit slot flags to clear all three:

```bash
bin/baocut animation clear "/path/demo.bcut" --id <element-id> --loop --json
```

Use `animation save/saved/apply --saved/forget` for project-local reusable
looks. Editable-project exports report animated properties they cannot preserve;
never pass `--allow-lossy` without the user's explicit acceptance.

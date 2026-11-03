<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/character-animation/references/timing-and-sound.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 旁白、字时间与声音

配旁白、配乐、放音效时读。稿子字数、选音色、合成的通用做法在 `narration`；音效配方在 `baocut-catalog-music`。这里只讲这种片子多出来的部分。

## 1. 旁白

- **声音定时长**：先合成旁白，再按它写镜头。一分钟的片子按实测语速算字数。
- **比较候选音色**：音色和用户想要的感觉有差距时，让两三个音色念同一段，用 `production-scripts` 的 `voice.mjs --check` 量中位音高，配上试听让用户挑。用户给了参考录音时，把它的音高也量一下作为对照。
- **一次合成**，用 `production-scripts` 的 `gaps.mjs` 把超过 0.24 秒的停顿压到 0.16 秒左右：这种片子节奏紧。
- **变速**按 `narration` 的默认不做，超了改稿。用户要求压到某个时长且只差一点时，整体变速不超过 1.1 倍，并告诉用户。

## 2. 字时间

用 `transcribe` 给旁白转写，把转写的词时间对回稿子原文（`production-scripts` 的 `align.mjs`，或者只取时间的 `noVideo`），写成包里的 `words.js`：

```js
window.WORDS = [{ w: 'you', t0: 0.12, t1: 0.3 }, /* … */];
```

- 转写偶尔吞字。对齐时发现少词，不带提示词、不沿用前文重新转一遍（工具有对应参数时），不自己估时间。
- 改了旁白就重新转写。代码里所有时刻都走 `R.cue`，整片跟着新时间走，不用改镜头。
- 片子结尾：`end` = 旁白结束 + 0.9 秒左右，让最后的牌子停住。

## 3. 配乐

- 按 `baocut-catalog-music` 选来源。用户给的优先；网上下载的看清许可，需要署名的写进交付。
- 放在单独一条配乐轨，`setDucking` 用旁白轨作触发（合成的旁白没有转写时不能选 `speech`），`depth` 取 10–11 dB，片尾淡出 0.7 秒。
- 导出时开 `loudness`，发布到视频平台的目标约 -14 LUFS。

## 4. 音效

`rig-check.mjs` 写出 `rig-timeline.json`，里面的 `events` 是绑定库记下的事件。跑：

```bash
node place-sfx.mjs <video> bundle/rig-timeline.json --offset <包在时间线上的开始>
```

| 事件 | 来自 | 默认配方 |
| --- | --- | --- |
| `tick` | `R.typed` 每个字（抽稀到 0.07 秒一下） | `keypress`（截短到 0.06 秒） |
| `pop` | `R.tag`、`R.ring`，或自己 `R.E('pop', t)`：牌子、图标出现 | `pop` |
| `whoosh` | `R.wipe`，或东西掉下来前 | `whoosh`（最响处对准事件） |
| `hit` | `R.cross`，或重物落地 | `impact` |
| `ding` | `R.check`，或答案出现 | `ping` |

- 画面和声音读同一份表：改了镜头，撤销上一笔放音效的修改再跑一次，不手动对。
- `--recipes`、`--volume` 按这期的风格换。不是每期都要打字声；要安静的片子给 `R.typed` 传 `silent`。
- 要自己找的音效素材，放的时候让那一下最响的地方对准事件时刻，不是文件开头。

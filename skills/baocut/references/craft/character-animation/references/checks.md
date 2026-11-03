<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/character-animation/references/checks.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 自检

请用户审之前读。按顺序查，让用户的时间只花在口味上。

## 1. 部件

`rig-proof.png` 看过，`cutout.mjs` 的警告都处理了（[出图与抠图](art.md) 第 5 节）。

## 2. 跑一遍代码

```bash
node rig-check.mjs bundle
```

不开浏览器，把代码包按每秒 30 次走完，也写出 `rig-timeline.json`。退出码 1 时每个问题都要改：

| 报告 | 意思 | 怎么改 |
| --- | --- | --- |
| `overreach` | 手够不着，手臂被拉直 | 改用 `aim` 或 `at`，或者挪角色 |
| `elbow_up` | 肘部朝上翘 | 手放低或放远一点 |
| `through_head` | 手臂穿过头的位置 | 改 `aim`，或给 `front: true`（如往嘴里送东西） |
| `elbow_flip` | 肘部突然翻到另一边 | 用 `R.swing`，或改手的路径 |
| `bad_target` | 手的坐标算不出来 | 检查 `x`、`y` 或 swing 的两端 |
| `across` | 指向的目标在身体另一侧 | 换另一只手 |
| `fonts must be TTF or OTF` | 带了 WOFF | 换成 TTF 或 OTF |

`note` 不一定是错：某镜太长、相机没动、字缩得太小，自己判断。`R.cue` 报错说明稿子和时间对不上，或者一个词说了不止一次。

## 3. 看画面

`baocut compositions preview` 带 `sheet: true`，一张接触表最多 24 帧：每镜在中后段取一帧，取两张。查这些：

- 牌子是不是空的，字有没有溢出，文字压没压住角色的脸。
- 底图有没有露出黑边，角色的脚有没有出画或踩空。
- 同一个角色前后像不像。
- 角色站的地方对不对：有没有穿过桌子、挡住要读的牌子。

再看动作：手势、走路、转场各在前后 2 秒内密集取满 24 帧。

## 4. 烘焙

用户说可以之后，第一包用 `bake: "ops"` 导入：结果 `bake.renderer` 应是 `drawop-cpu`（1080p 实测每秒几十帧）。报错时按 `bake.fallback.reason` 和 `video-production` 代码场景细则的第 2.1 节改。

## 5. 成片

导出预览或成片之后：

```bash
node jump-scan.mjs out.mp4 bundle/rig-timeline.json --fps 30 --offset <包的开始>
```

- `unplanned`：不在剪点和转场上的单帧跳变。逐个取帧看，有意的（比如牌子换字）说明原因，其余要修。
- `dark`：黑帧。
- `stillTooLong`：画面停住超过 1 秒。

## 6. 只有人能判断的

单帧与脚本看不出这些，交付时写明没听过或没看过：外文专名的发音、配音语气、配乐与音效平衡、连续播放时的节奏与手势的手感。

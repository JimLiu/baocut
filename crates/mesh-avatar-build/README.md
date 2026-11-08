# mesh-avatar-build

从一张卡通立绘做出会说话的虚拟主播：切出眼睛分层、补好皮肤的底图和头发遮罩，导入画好的闭眼与口型变体，再按一段配音逐帧渲染。运行时与渲染用同目录内置的 [`mesh-avatar-core` / `mesh-avatar-wgpu`](../mesh-avatar-core/README.md)。

分层与 sprite 的算法移植自 [mesh-avatar-studio](https://github.com/shinshin86/mesh-avatar-studio)（提交 `3619620`，MIT，Copyright (c) 2026 Yuki Shindo）的 `tools/build-layers.py`、`tools/build-sprites.py` 与 `tools/variant-requests.py`，许可原文见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md#mesh-avatar-studio)。上游这几步依赖 Python 与 OpenCV，这里改成纯 Rust，输出的包格式与上游一致，上游运行时可以直接加载。

## 命令

| 命令 | 作用 |
| --- | --- |
| `mesh-avatar-build layers <project> [--rig FILE] [--out DIR]` | 读 `source.png` 与 `rig.json`（没有就读 `rig.draft.json`），写 `built/base.png`、`built/hairmask.png`、8 张眼睛分层与 `built/layers.json`，并把眼睛轮廓写回 `rig.json`。 |
| `mesh-avatar-build variant-requests <project>` | 为每个变体写 `variant-requests/<name>/mask.png` 与 `prompt.md`，交给图片编辑模型重画眼睛或嘴。 |
| `mesh-avatar-build sprites <project> [--out DIR] [--tolerance N]` | 把 `variants/<name>.png` 与原图对齐、只取遮罩内改动的部分，写成带羽化边的 `built/sprites/`；缺的变体跳过。 |
| `mesh-avatar-build pack <project> [--no-source] [-o OUT.mavatar]` | 把项目打成 `.mavatar`（条目不压缩的 zip）：只收清单、rig、`layers.json` 与 `sprites.json` 列出的层、叠加物、底图、头发遮罩与缩略图，`--no-source` 不带原图；不覆盖已有文件。移植自上游的 `tools/pack-avatar.mjs`。BaoCut 的视频里可以直接导入这个包（[角色格式规范](../../docs/spec/puppet-format-spec.md#25-mesh-avatar-角色包) §2.5）。 |
| `mesh-avatar-talk <avatar> --audio speech.wav -o -` | 按配音渲染主播，逐帧输出未预乘的 RGBA8，交给 ffmpeg 编码。 |

变体名：眼睛 `eyes_closed`、`eyes_half`、`eyes_smile`、`eyes_sad`、`eyes_surprise`；嘴 `mouth_a`、`mouth_a_half`、`mouth_i`、`mouth_o`、`mouth_angry`、`mouth_sad`。眨眼至少要 `eyes_closed`，口型至少要 `mouth_a`。

## 从图片到视频

1. 画立绘：正面、半身、背景干净的卡通角色，存为 `<project>/source.png`。
2. 标 rig：按 mesh-avatar-studio 的 rig 格式标出眼睛、头、眉、嘴、头发等（本 crate 不生成 rig）。目前不支持 `hand`、`accessories`、`cloth`，遇到会报错，这类角色请用上游的 Python 工具切分层。
3. `mesh-avatar-build layers <project>`。
4. `mesh-avatar-build variant-requests <project>`，再用图片编辑模型（例如 GPT Image）按每个 `mask.png` 与 `prompt.md` 编辑 `source.png`，结果存为 `<project>/variants/<name>.png`。图片宽高比与原图相差不超过 0.5%，尺寸不同会自动缩放。
5. `mesh-avatar-build sprites <project>`。
6. 写 `<project>/avatar.json`：`{"format":"mesh-avatar","version":1,"name":"..."}`。要放进 BaoCut 的视频，再 `mesh-avatar-build pack <project>` 打成 `.mavatar` 导入。
7. 配音存为 WAV（任意采样率、声道数），渲染并合成：

```bash
mesh-avatar-talk <project> --audio speech.wav --size 1080x1620 --fps 30 --lead 0.6 --tail 1.0 -o - | ffmpeg -f rawvideo -pix_fmt rgba -s 1080x1620 -r 30 -i - -loop 1 -framerate 30 -i background.png -i speech.wav -filter_complex '[1:v]scale=1080:1920[bg];[bg][0:v]overlay=0:300:shortest=1,format=yuv420p[v];[2:a]adelay=600:all=1,apad[a]' -map '[v]' -map '[a]' -shortest -c:v libx264 -crf 18 -c:a aac -movflags +faststart host.mp4
```

`--lead` 是开口前的静止秒数，ffmpeg 的 `adelay` 要设成同样的毫秒数。其他选项：`--seed` 固定眨眼与动作的随机数，`--gain` 调口型灵敏度，`--expression` 选表情，`--fit`、`--pad-top`、`--pad-side` 调取景。

## 口型驱动

模拟固定 60 Hz，与输出帧率无关。说话期间每一步取以该时刻为中心的 1024 个样本，按 `clamp((rms − 0.008) × gain × 5)` 算声音强度，与上游实时模式的 `rmsLevel` 相同；口型元音由运行时的动作引擎按音量起伏选取。

## 与 Python 版的差别

- 眼睛挖空处的填色：上游用 OpenCV 的 Telea inpaint，这里从边缘一圈圈向内取邻点平均。
- 距离变换用精确欧氏距离，上游是 OpenCV 5×5 掩模的近似值。
- 变体对齐：上游用 `phaseCorrelate` 求亚像素位移，这里在 ±6 像素内做整数搜索，位移超过 3 像素拒绝导入（与上游阈值相同）。
- k-means 用固定种子的 SplitMix64；`build` 编号用 SHA-256 计算，和上游不同。
- 口型提示词用英文元音描述（如 “a” as in “father”），不用日文假名。
- 嘴部编辑区按四舍五入取整，边界可能与上游相差 1 像素。

用同一张图与 rig 和 Python 版对比：眼睛分层一致，头发遮罩 IoU 0.9976，底图只在眼睛挖空处有差别；sprite 像素最大差 2；整包渲染最大差 28（4 个像素）。

## 验证

```bash
cargo test -p mesh-avatar-build --release
```

`tests/cpu_parity.rs` 让 `crates/puppet` 的 CPU 光栅和上游 wgpu 渲染器画同一帧逐像素比较，没有 GPU 时跳过；`BAOCUT_MESH_AVATAR=<.mavatar>` 换成真实角色。

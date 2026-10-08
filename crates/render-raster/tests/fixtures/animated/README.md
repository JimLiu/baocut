# `core/fixtures/animated/` —— `AnimatedImage` 源的 conformance 夹具

[`docs/design/bcf/bcut-motion-render-upgrade-design.md`](../../../docs/design/bcf/bcut-motion-render-upgrade-design.md)
§7 / §10 阶段 6 的产物：GIF / APNG / 动画 WebP 三种容器各一组极小素材，
把「逐帧 duration、disposal、loop count、画布合成」四件事各钉在一个可观察的
像素上。

**这些文件不是手写的，也不要手改。**

```bash
cd core
cargo test -p bcut-render --test animated_source                  # 校验（含 up-to-date 门禁）
cargo test -p bcut-render --test animated_source -- --ignored     # 确认过再重生成
```

生成器是 `crates/bcut-render/tests/fixture_gen/mod.rs`——不是 `gen.sh` 那样的
ffmpeg 脚本：逐帧 disposal 与 loop count 需要精确控制，ffmpeg 给不了。生成器留在
测试里还有个好处，`animated_fixtures_are_up_to_date` 因此是一条真门禁
（当场重算再逐字节比），而不是「跑一次脚本然后祈祷」。

## 布局

| 路径 | 内容 |
| --- | --- |
| `stripes.gif` | 8×8，4 帧整幅纯色，delay 100 / 200 / 300 / 400 ms，无限循环 |
| `disposal.gif` | 8×8，3 帧，`Keep` → `Background` → `Keep`，**有限** loop count（2 遍） |
| `pulse.png` | 8×8 APNG，3 帧，分数延时 1/25、1/10、3/50 秒 → 40 / 100 / 60 ms，`num_plays = 1` |
| `wave.webp` | 8×8 动画 WebP，3 帧，delay 50 / 100 / 150 ms，无限循环 |
| `<stem>/frame-<i>.png` | 该素材第 i 帧的**逐字节** golden（解码 + 画布合成之后的最终像素） |
| `expected.json` | 元数据、时长表、内容指纹、逐帧摘要与一组采样点（含越界与负时刻） |

## 三件被钉住的语义

1. **逐帧 duration 表**：`frameStartsMs` 是 N+1 项的累积起点，末项是总时长。
   落在一帧窗口内的**任何**时刻都量化到该帧起点——静止帧缓存与帧指纹靠这个命中。
2. **disposal 只作用于该帧自己的帧矩形**，不是清空整幅画布。`disposal.gif`
   的第 3 帧因此同时存在三种像素：本帧的蓝块、上一帧矩形被处置成的透明、
   以及矩形之外由第 1 帧保留下来的红底。
3. **loop count 是探测出来的元数据，不是渲染判据**。`disposal.gif` 的 `2x` 会
   出现在 `bcut probe` 里，但画面循不循环由文档的 `animatedImage` 元素写不写
   `loop` 决定（缺省沿用本字段）——一份文档的播放行为不该取决于某个容器字节。

## 已知的容器怪癖

`wave.webp` 的 golden 颜色比生成器写进去的值**低 1**（`0x20` → 31、`0xff` → 254）。
这是 `image` / `image-webp` 那对无损 WebP 编解码器往返出来的偏移，**发生在夹具
生成端**，与渲染路径无关（GIF / APNG 两路的颜色逐字节精确）。golden 按实测值定，
不为了好看去改数。

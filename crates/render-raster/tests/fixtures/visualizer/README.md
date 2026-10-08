# `core/fixtures/visualizer/` —— visualizer 的 conformance 夹具

[`docs/design/bcf/bcut-element-render-foundation-design.md`](../../../docs/design/bcf/bcut-element-render-foundation-design.md)
的 ADR-E04（`VisualSource` 契约与注入协议）与 §8.7（conformance 标准）的产物。

一句话：**输入固定在 `cases.json`，每个阶段各自追加自己的 expected 文件。**
P2 只钉「频谱怎么派生、怎么按时刻取帧」；CPU 绘制、wasm 预览复用同一份输入，
各自比自己那份 golden。

**这些文件不是手写的，也不要手改。**

```bash
cd core
cargo test -p bcut-render --test visualizer_source                # 校验（含 up-to-date 门禁）
cargo test -p bcut-render --test visualizer_source -- --ignored   # 确认过再重生成
```

生成器就是 `crates/bcut-render/tests/visualizer_source.rs` 自己——生成端与消费端
共用同一批函数，`visualizer_fixtures_are_up_to_date` 因此是「当场重算再逐字节比」
的真门禁，而不是「跑一次脚本然后祈祷」。

## 布局

| 路径 | 内容 |
| --- | --- |
| `cases.json` | **输入**：两份固定 BCS1 × 四组元素参数 × 五个时刻 + 乱序序列 + 10 个样式 id |
| `sweep-48k-mono.bcs1` | 程序生成的 3.0 s 合成频谱（180 帧 × 640 字节） |
| `expected-track.json` | **P2 的 golden**：8 条 `VizTrack` 的整轨指纹 + 五个时刻的帧号与逐行摘要 |
| `expected-draw.json` | **绘制 golden**：10 款样式 × 五个时刻 + 一帧静音的 DrawOp 指纹，外加折线类冻结的 `samples` 一列（生成器是 `tests/visualizer_draw.rs`） |
| `../spectrum/tone-48k-mono-f32.bcs1` | P1 的真实 DSP golden（0.2 s），`cases.json` 引用，不复制 |
| `../progress/` | progress 元素的同类夹具（它没有素材源，输入结构完全不同，见那边的 README） |

## 两份 BCS1 各管一件事

| 名字 | 时长 | 作用 |
| --- | --- | --- |
| `tone` | 0.2 s | 真实 STFT 产物。时刻表里 0.5 / 1.0 / 2.5 **全部越界**，专门钉「末端之后冻结末帧」 |
| `sweep` | 3.0 s | 纯整数算术合成，五个时刻全部落在轨内，覆盖满 0..255 的字节域 |

`sweep` **刻意不走 `dsp::analyze`**：那条路的字节取决于 rustfft 的三角函数，
跨平台逐位一致没人承诺过。本目录钉的是「重映射 → 平滑 → 取整 → 查表」这条链路，
用整数造出的 canonical 字节更适合当它的输入；真实 DSP 的字节 golden 由 P1 的
`core/fixtures/spectrum/` 负责，这里把它当第二份输入一起跑。

## `sweep` 的高频段是空的（读 `expected-draw.json` 时要知道）

`synth_spectrum` 的频域行 `decay = 200 − bin·200/96`：**bin ≥ 96 之后只剩抖动**，
经 `default` 参数组（`minDb = −80` / `maxDb = 40`）重映射后就是 0。按频段均分的
两款因此在这份输入上有几段是"静止"的：`pulse_rings` 的高频带停在静止半径、
`ribbons` 靠后的丝带摆幅为零收成中线。它们**仍然各有一条指令**（`ops` 恒为
5 / 3），静止形态是设计的一部分，不是绘制没接上；逐段几何由
`source/visualizer/draw.rs` 的 `the_pulse_rings_expand_with_the_bands` /
`the_ribbons_blend_from_main_to_secondary` 用一帧恒定频谱钉住。

`dots` 是唯一 `ops` 随时刻变化的样式：点阵只画亮起的点与峰值点，
`sweep` 开头几帧的频谱还没铺满全部列。

若要覆盖高 bin，应当往 `cases.json` 的 `params` **末尾追加**一组更宽的 dB 窗，
而不是改 `sweep`（它是 P2 冻结的输入）。

## 采样序列与乱序（三个执行器共用的编号）

`cases.json` 的 `sequence` 把 (spectra × params × instants) 按书写顺序展开成
`0 .. length-1`；`shuffle.order` 是它的一个置换，算法是 **splitmix64 +
Fisher–Yates**（自 `len-1` 递减，`pick = next % (i+1)`，种子写在 `shuffle.seed`），
与 motion 方案阶段 0 的手法逐字相同。

「乱序采样 == 顺序采样逐位一致」是 source conformance 的**必选项**，不是可选项：
导出本来就是乱序的（`bcut render --t 7.5` 直接跳帧、全片导出按 stride 分给多个
worker），源一旦持有增量时钟这条就绿不了。指数平滑天然递推，所以它被钉在 host
preflight 的整轨派生里，`sample(t)` 只剩一次数组下标查找（ADR-E04 §6.2）。

## 取整规则

```text
idx = clamp(floor(t × analysisRate), 0, frameCount - 1)
```

不插值、不四舍五入。**实现只有一份**：`bcut_waveform::bcs1::frame_index_at`，
`Bcs1View::frame_index_at` 与 `VizTrack::frame_index_at` 都转发到它，
`the_rounding_rule_matches_the_spectrum_format_layer` 逐时刻对拍两条路。

## 时域行与频域行的分工

频域行走完整的「重映射 → 平滑 → gain」；**时域行逐字节原样搬运**。依据是本方案
一路对齐的 Web Audio 语义——`smoothingTimeConstant` 只作用于
`getByteFrequencyData`，而 dB 窗对一条「静音 ≈ 128」的中心化波形没有意义。
10 款里只有 `oscilloscope-v1`（`oscilloscope` / `ring_wave`）读时域行。

## §8 的 GPU 接口约定（冻结保留，visualizer 当前不走）

自 2026-09 重设计起，visualizer 10 款全部是 **CPU 矢量配方**
（`source/visualizer/recipes/`），没有 WGSL 实现；GPU pass 只跑 progress。
`expected-track.json` 里没有任何 GPU 数据；但夹具的输入仍按 §8 的接口约定摆着，
将来加 GPU 声波配方时直接拿来用：

- **§8.1 bind group**：`@group(0)` 变换、`@group(1)` 逐效果标量、
  `@group(2) @binding(0)` 音频纹理 + `@binding(1)` sampler（linear / clamp-to-edge）。
- **§8.2 `@group(1)` uniform 顺序冻结**（visualizer 8 项）：
  `u_time`、`u_mainColor`、`u_secondaryColor`、`u_canvasRes`、`u_dstRes`、
  `u_colourMultiplier`、`u_clip`、`u_textureSize`。`tests/shader_wgsl.rs` 仍对拍
  prelude 与 `VisualizerUniforms`。
- **§8.3 音频纹理**：`R8Unorm`、`w × 2`、**row 0 = 时域、row 1 = 频域、无 flip**。
  代码侧的冻结点是
  `bcut_render::source::visualizer::{AUDIO_TEXTURE_ROW_TIME, AUDIO_TEXTURE_ROW_FREQ}`；
  CPU 配方读行走 `freq_row` / `time_row`，与纹理行同一份换算。
- **§8.4 频率映射**：48 kHz 的 BCS1 直接对齐 Web Audio，`binWidth == "64"`
  取最低 64 个 bin（0–3 kHz），`half` 覆盖 0–24 kHz（`VizFrame::freq_window`）。
- **§8.7 判据**：strict 样式走平坦区 ≤ 2/255、过渡带 ≤ 20%、4× 降采样 SSIM ≥ 0.98
  三条；visual 样式 SSIM ≥ 0.96；不过 conformance 自动回退 CPU 并在 preflight 的
  `fallbacks[]` 报出。当前只有 progress 走这条门（`tests/gpu_conformance.rs`）。

## 各消费方怎么接

| 消费方 | 文件 | 比什么 |
| --- | --- | --- |
| CPU 绘制 | `expected-draw.json` | 10 款的 DrawOp 指纹，有声与静音每款 `ops > 0` |
| wasm 预览 | 复用 `expected-draw.json` | wasm 里跑同一批输入，指令流必须逐字节相同 |
| GPU 声波配方（未来） | `expected-gpu.json` | GPU 输出与 CPU 参照的 §8.7 判据；目前没有这类配方，文件不存在 |

### `expected-draw.json` 的两条口径

1. **静音仍有画面**。频域行全 0 时每款都画自己的"静止形态"：柱子留
   `minHeight`、示波器留中线、点阵留底灯、环停在静止半径、丝带收成中线。
   元素在片头 / 无声段不会从画布上消失，`every_style_is_live_in_the_golden`
   逐款钉住。
2. **`aspect: "square"` 取盒内内切正方形**。几何默认表给的是"画幅宽 30% ×
   画幅高 30%"，在 16:9 上并不是像素正方；配方既然显式声明了 `square`，
   绘制端就在内切正方形里画，于是圆形类样式（`ring_bars` / `ring_wave` /
   `pulse_rings`）在任何盒子里都是正圆。三款的几何都收在正方形内，不需要
   `ClipPath`。

新增 expected 文件时**不要动 `cases.json`**——输入一改，前面阶段的 golden 全部
失去可比性。确实需要新输入就往 `spectra` / `params` 末尾追加，让既有编号不动。

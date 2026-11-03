# docs/design/color-lut/ — 时间线上的 LUT 效果

**方案稿（2026-11-03）：只有设计，没有实现。** 给 `fx` 加一个 LUT 字段，让统一色调成为片段上可调、可撤销的效果，不必烧进新文件。它牵涉视频格式、帧计划、两端渲染与一致性夹具，返工成本高，动手之前要用户先裁决 [§12](#12-待用户裁决) 的问题。

相关：视频格式规范 §1.4（版本）、§3.9（效果）、§4.1–§4.2（素材）；架构设计 §7.3（产物到视频的闭环）、§9.1、§9.3、§9.4、§9.11；开发流程 §2；[导出合成上 GPU](../export/gpu-compositing.md)。

## 目录

1. [结论](#1-结论)
2. [现状](#2-现状)
3. [LUT 存成素材](#3-lut-存成素材)
4. [`fx.lut`：引用与强度](#4-fxlut引用与强度)
5. [采样](#5-采样)
6. [预览与导出的一致](#6-预览与导出的一致)
7. [导出性能](#7-导出性能)
8. [`match-color` 改写效果](#8-match-color-改写效果)
9. [旧视频与版本号](#9-旧视频与版本号)
10. [接线清单](#10-接线清单)
11. [分期](#11-分期)
12. [待用户裁决](#12-待用户裁决)

## 1. 结论

| 问题 | 方案 | 详见 |
| --- | --- | --- |
| 存成素材还是文档 | 素材：新种类 `kind: 'lut'`，字节是 `.cube` 原文，按版本引用 | §3 |
| `fx` 怎么引用、强度怎么调 | `fx.lut: { assetRef: VersionRef, intensity?: number }`，强度在 [0, 1]；排在 `fx` 固定顺序的最前面 | §4 |
| 怎么保证预览与导出一致 | 只用整数的四面体插值，同一份 Rust 进两端，沿用现有的零容差夹具；原型已核对 2²⁴ 种颜色原生与 WASM 逐字节相同 | §5、§6 |
| 导出性能 | 1080p 单线程一趟约 8.7 ms（M5 Max），是一次 `saturation` 的 1.6 倍；原生按行分块，4 线程约 2.2 ms；`export-bench` 加 `--lut` 量 | §7 |
| `match-color` 怎么改 | 给了视频就只算 LUT、不编码：导入素材并写 `fx.lut`，同一笔事务、一次撤销；没给视频时照旧文件到文件 | §8 |
| 旧视频与版本号 | 旧视频不迁移、像素不变；`schemaVersion` 按内容升：写过 LUT 的视频才是 4 | §9 |

## 2. 现状

- `fx` 是固定字段（`crates/video-model/src/effect.rs`），没有 LUT。`Fx` 带 `deny_unknown_fields`，旧版本读到新字段会解析失败。
- 颜色效果是逐帧的 CPU 运算：`frame_render::effects::apply_to_source` 作用在裁剪之后、放进框之前的源画面上，预览（WASM）与导出（原生）同一份代码。`render-graph` 的 `layer_effects` 只把步骤列进帧计划，像素由 `frame-render` 按实例的字段画。
- 预览与导出的一致靠逐字节的夹具（`crates/frame-render/tests/fixtures/parity.json` 与 `packages/ui/src/render/parity.test.ts`），不留容差（架构设计 §9.1）。
- `match-color` 把颜色映射烘成 33³ 的 `.cube`，由 ffmpeg 的 `lut3d` 烧进新文件，再由 `assets_import` 放进视频（`packages/jobs/src/pipelines/color-transfer.ts`、`footage.ts`）。问题有四个：
  - 调强度要重新编码一遍：`amount` 烘进了 LUT；
  - 多一代有损编码；
  - 新文件要手工换进片段，撤销不了「统一色调」这件事；
  - 贵的不是算 LUT，是编码。33³ 的 LUT 在 Node 里 12–25 ms 就算好（取样约为整帧的 1/37），慢的全在整段重编。

## 3. LUT 存成素材

| | 素材（选这个） | 文档 | 内联在 `fx` |
| --- | --- | --- | --- |
| 引用 | `VersionRef` 钉住一份字节（规范 §4.1） | 跟随文档当前版本（规范 §4.4），改一份所有片段跟着变 | 就在实例上 |
| 送进内核 | 已有 `LayerMedia::asset_bytes`：SVG、GIF、Lottie 走同一条路，预览是 `bc_set_asset`，导出读冻结的文件 | 今天只有字幕文档进渲染，要新开一条 | 每次 `setVideo` 都带上 |
| 体积 | 33³ 约 970 KB，65³ 约 7.4 MB，存在 `blobs/` | 文本正文按版本进 `video.db` | 进快照、撤销补丁与给智能体看的实例 JSON，不可接受 |
| 冻结、便携包、清理 | 列进 `asset_refs()` 与导出计划就都有了 | 要另算 `assetRefs` | 不适用 |
| 导入用户的 `.cube` | 字节原样留下，可以再拿走用 | 要转成 JSON，原文件没了 | 同左 |
| 重复生成 | 按 `contentHash` 复用（规范 §4.2），重跑不涨 | 每次写入一个新版本 | 不适用 |

文档唯一的好处是「改一处、都跟着变」，这里不需要：重新对齐是一笔事务，把新 LUT 写到选中的片段上。

**素材的规则**

- `kind: 'lut'`，与 `lottie` 同样的先例：只能被 `fx.lut` 引用（`elements::check_assets` 核对种类），不进媒体面板的可拖列表。不用 `other`，否则引擎分不清一份 `.cube` 与任意文件，界面也无从筛掉。
- `mediaType` 是 `text/x-cube-lut`，blob 扩展名 `cube`。字节就是 `.cube` 原文：`formatCube` 已经写这个格式，ffmpeg 与调色软件都读得懂，不另造二进制格式。
- 导入（`crates/video-engine/src/import.rs`）与渲染用同一个解析器，放在 `render-raster` 里不依赖 `media` 的部分（Lottie 的先例）：
  - 只收 3D：`LUT_3D_SIZE` 在 2–65；`DOMAIN_MIN`、`DOMAIN_MAX` 省略或是 0 与 1；数据个数对得上；数值有限，超出 [0, 1] 的夹紧；
  - `LUT_1D_SIZE` 与 1D 加 3D 的文件拒绝，说明原因（`MEDIA_PROBE_FAILED`）；
  - 文件不超过 16 MiB（`INVALID_OPERATION`）。
- 不给 `storage` 时按 `managed` 导入，是规范 §4.2「文件默认 `linked`」的一个例外。理由：字节小，链接丢了的后果是颜色悄悄不对。明确要 `linked` 时照常支持，`video-service.ts` 的 `LINKED_SERVABLE` 加上 `cube`。
- LUT 映射的是编码值到编码值，没有色彩管理：工作空间是 sRGB 编码值（架构设计 §9.3），素材按 ffmpeg 的缺省换成 RGB。log 转 Rec.709 的 LUT 只对真是 log 的素材有效，格式不声明它的输入色彩空间（`ColorInfo` 还没纳入，规范 §10）。HDR 的规则不变（架构设计 §9.3）。

**来源**（规范 §4.5）：`match-color` 生成的素材 `origin` 是 `color-match`：

```ts
source: {
  colorMatch: {
    algorithm: 'baocut.color-match/1';                       // 算法版本
    method: 'histogram' | 'reinhard' | 'mkl' | 'hm-mkl-hm';
    sourceAsset: VersionRef;
    sourceRanges: Array<{ start: number; end: number }>;     // 取样的源区间（秒）
    reference: { asset: VersionRef; at?: number } | { sha256: string; originalName: string; at?: number };  // 不记本机路径
    jobId: Id;
  };
}
```

用户导入的 `.cube` 是普通的 `user-import`。

## 4. `fx.lut`：引用与强度

```ts
interface Fx {
  lut?: FxLut;
  // ……其余字段不变
}

interface FxLut {
  assetRef: VersionRef;  // kind: 'lut' 的素材版本
  intensity?: number;    // [0, 1]，缺省 1；0 等于没有这个效果
}
```

- **适用范围**与其余 `fx` 相同（规范 §3.9）。越界时拒绝写入：`Fx::check_v3_fields` 查区间，`check_assets` 查素材在不在、种类对不对。它和 `temperature` 一样是 v3 的字段，不进 `timeline::schema::Fx`。
- **作用顺序：排在最前面**，在 `filterPreset` 之前。规范 §3.9 的列表整体后移一位，「1–10 作用在素材画面上」改成 1–11。
  - `match-color` 的 LUT 是按原始画面算的，输入必须是原始画面；
  - log 转 Rec.709 这类 LUT 也要吃原始画面；
  - 用户之后拖亮度、对比度，是在 LUT 的结果上调，符合直觉；
  - 与今天烧进文件的结果相同：烧录时 `fx` 本来就排在 LUT 之后。
- **强度**是 LUT 结果与原画面的混合比例，折进表里算（§5），每像素没有额外开销。滑块拖动时重建一张表约 0.14 ms。
- **能调的**：强度、其余 `fx`（都在 LUT 之后）、换一份 LUT、去掉。都是普通的编辑，走撤销与版本记录。
- **不做**：
  - 关键帧：§3.15 的白名单没有 `fx`，强度在片段上是定值；
  - LUT 串联：`fx` 的字段是固定的，一个片段一份；
  - 序列级的统一色调：调整层不在类型集合里（规范 §10），要统一就写到每个片段上。
- **帧计划**：`layer_effects` 把它列在第一步，`kind: 'lut'`，`params: { asset, intensity }`，恒等（`intensity` 为 0）时不列。
- **写入**：新增操作 `setLut`，只动 `fx.lut`：

  ```ts
  { type: 'setLut'; sequenceId?: Id; itemIds: Id[];
    lut: { assetRef?: VersionRef; assetImportRef?: string; intensity?: number } | null }
  ```

  `assetRef` 与 `assetImportRef` 的语义同 `replaceItemAsset`（命令与协议规范 §4.2），所以「导入 LUT、写到 N 个片段」是一笔事务、一次撤销。`setEffects` 仍是整个替换：智能体改亮度时容易把 LUT 一起丢掉，所以工具说明写明这一点，替换掉 LUT 时回执的 `impact` 列出来。
- **合成实例**：实时层（`LiveLayer`）今天不带任何 `fx`，LUT 同样画不出来。替身与导出照常画。`match-color` 第一版只写视频与图片片段。

## 5. 采样

四面体插值，只用整数。与现有 `lut3d=...:interp=tetrahedral` 同一种插值，灰轴上的颜色只由对角线上的格点决定，插值本身不引入偏色。

```text
每个通道：p = v·(N−1)，i = ⌊p / 255⌋，f = p mod 255          // v 是 8 位输入，N 是网格边长；f 在 0..254
把三个 (f, 步长) 按 f 降序排好，得 f0 ≥ f1 ≥ f2 与 s0、s1、s2   // v = 255 的步长是 0，不越界
c0 = T[o]，c1 = T[o+s0]，c2 = T[o+s0+s1]，c3 = T[o+s0+s1+s2]  // o 是三个 i 对应的表偏移，T 的 65535 = 1.0
n = (255−f0)·c0 + (f0−f1)·c1 + (f1−f2)·c2 + f2·c3            // 最大 255·65535，u32 放得下
out = (n + 32767) / 65535                                    // 整除
```

- **解析**：`str::parse::<f64>` 夹到 [0, 1]，`(v·65535).round()` 成 u16。两端是同一份 Rust。
- **强度折进表**：`T_k[i] = I[i] + (((T[i] − I[i])·k + 32768) >> 16)`，`k = round(intensity·65536)`，`I` 是恒等表。四面体插值能精确还原线性函数，折进表与逐像素混合只差取整，采样的代价与强度无关。按 `素材ID@版本` 缓存解析好的表，按强度缓存折好的表（`FrameRenderer` 里与 `gifs` 同样的做法）。
- **alpha**：不透明的像素直接采样，常见的整幅视频没有额外开销。`0 < a < 255` 时反预乘成 8 位（`(c·255 + a/2) / a`，上限 255），采样，再乘回 `(v·a + 127) / 255`，alpha 不变。`a = 0` 的像素不动，与颜色类滤镜相同（架构设计 §9.3）。
- **位置**：`render-raster` 的 `effects/filters`，`frame_render::effects::apply_to_source` 直接调用。它不走 `filter.*` 配方，因为配方的参数是 uniform，放不下一张表；色温也是这样直接画的。这个 crate 在 `profile.wasm` 里已经是 `opt-level = 3`。

## 6. 预览与导出的一致

| 比什么 | 容差 | 怎么验 |
| --- | --- | --- |
| 同一份解好的画面与 `.cube`，原生与预览 WASM | 逐字节（架构设计 §9.1） | 一致性夹具 |
| 没有 LUT 的既有场景，改动前后 | 逐字节 | `parity_fixture_is_current`：既有场景的摘要不变 |
| 恒等 LUT 与输入 | 逐字节，覆盖 2²⁴ 种颜色 | `render-raster` 的单元测试（夹具要求场景之间第一帧互不相同，放不进去） |
| 单线程与分块（§7） | 逐字节 | 单元测试 |
| 效果与烧录（`ffmpeg lut3d`），编码之前 | 每通道 ≤ 1/255 | `packages/jobs` 的测试（要 ffmpeg） |
| 浏览器解码与原生解码之后的整条路 | 不设零容差，见下 | 记录，不做门 |

**原型的结果**（§7 的环境）：真实的 `hm-mkl-hm` 33³、65³ 与强度 0.5 的表，分别在 aarch64 原生与 `wasm32` 开 `simd128`（Node 26）上跑遍 2²⁴ 种颜色，FNV-1a 摘要相同。恒等 33³ 对全部 2²⁴ 种颜色逐字节还原。2、4、8 线程与单线程的输出相同。与 `ffmpeg lut3d`（tetrahedral，rgb24）比一整帧：50.3% 的通道值相同，49.7% 恰好大 1，没有更大的差，也没有小 1 的。方向看起来是 ffmpeg 截断而这里四舍五入，没有核对 ffmpeg 的源码。

**夹具新增的场景**（`crates/frame-render/tests/parity.rs`，`.cube` 走现有的 `assets` 文本槽，用 5³ 的小表，不撑大 `parity.json`；`parity.test.ts` 的前缀清单加 `fx-lut`）：

| 场景 | 覆盖 |
| --- | --- |
| `fx-lut-grid` | 通道交叉的非恒等 LUT，竖条约 64 色：六个四面体、格点上、0 与 255 |
| `fx-lut-intensity` | 同一份 LUT，强度 0.37 |
| `fx-lut-order` | LUT 加 `filterPreset`、`saturation`、`temperature`：核对顺序 |
| `fx-lut-alpha` | 半透明画面 |
| `fx-lut-panels` | 分屏：每格各自作用 |
| `fx-lut-transition` | 转场两侧用不同的 LUT，另一侧取 handles |
| `fx-lut-output-size` | 输出缩放的镜头 |

**端到端**：解码的差别本来不在零容差的范围里（架构设计 §9.1）。LUT 会放大它：预览与导出的差约等于解码差乘 LUT 的局部增益。这是这次新增的风险。

| LUT（33³，沿网格轴的增益） | 中位数 | p99 | 最大 |
| --- | --- | --- | --- |
| `hm-mkl-hm`，分布差很远的一对（`testsrc2` 对到 `mandelbrot`） | 0.07 | 4.75 | 14.39 |
| `hm-mkl-hm`，同一帧与它调过白平衡、曝光的版本 | 0.02 | 1.37 | 3.23 |
| `reinhard`，同上 | 0.07 | 1.24 | 3.64 |
| `mkl`，同上 | 0.09 | 1.12 | 1.12 |

`MAX_GAIN = 4` 只夹 Reinhard 的增益与 MKL 的矩阵，直方图那一步没有上限。规定如下：

- 零容差只约束内核。端到端不声称逐字节，也不把解码差算成 LUT 的缺陷。
- 验收记一条：固定环境、固定素材、`mkl` 的 LUT，停住的预览帧与导出帧按 `imgcmp` 严格档对比（平坦区每通道差 ≤ 2/255、4 倍下采样后 SSIM ≥ 0.98），陡的 LUT 只记录。
- 陡的 LUT 由生成时提醒（§8）。

**播放中**：预览先把画面缩到 960×540 以内再过 LUT，与精确帧的差别属于分辨率（架构设计 §9.4）。停住之后是精确帧。LUT 的字节还没到时，这一层的 `#readiness` 是 `pending`：先留着上一帧，引擎的 `exact` 为假，到了重画。不能只靠 `#sendAssets`，否则没有 LUT 的那一帧会被标成精确。

**GPU 导出**：[导出合成上 GPU](../export/gpu-compositing.md) §2 第一版不做 `fx`，带 LUT 的层走 `Raster`，像素与 CPU 相同。以后要写着色器时，硬件的 3D 纹理过滤是三线性，得在着色器里手写四面体，并按那篇 §5 的容差对拍。

## 7. 导出性能

**实测**（只量 LUT 这一趟，没有跑导出，因为还没有实现）。原型在仓库外：

- 环境：Apple M5 Max（18 核），1 分钟负载 5–7；原生 `rustc 1.99.1 -C opt-level=3 -C lto=fat -C codegen-units=1`；WASM 开 `simd128`，Node 26.13；
- 画面：1920×1080 四张（`testsrc2`、`templates/chaos-to-harmony/preview.mp4` 的一帧放大、`testsrc2` 加噪声、均匀随机），原生 21 次、WASM 15 次的中位数，下表写真实素材那一帧，括号里是四张的范围。

| 步骤 | 每帧 |
| --- | --- |
| 整帧拷贝（8.3 MB） | 0.12 ms |
| 现有的 `saturation`（同一写法的 f64 循环） | 5.3 ms |
| LUT 33³，单线程 | 8.7 ms（7.4–9.4） |
| LUT 65³，单线程 | 8.9 ms（7.6–9.4） |
| LUT 33³，2 线程 | 4.3 ms（3.6–4.3） |
| LUT 33³，4 线程 | 2.1 ms（1.9–2.2） |
| LUT 33³，8 线程 | 1.6 ms（1.4–1.6） |
| 浮点三线性，单线程（没有优化，只作对照） | 16.4 ms |
| WASM，单线程，1920×1080 | 14.7 ms（14.7–14.9） |
| WASM，单线程，960×540（播放的像素预算） | 3.6 ms |
| 解析 `.cube` 33³ / 65³，原生 | 1.5 ms / 10.7 ms（一次） |
| 解析 `.cube` 33³ / 65³，WASM | 3.9 ms / 12.8 ms（一次） |
| 折强度 33³ | 0.14 ms（一次） |

**这些数说明什么**

- 单线程时合成线程每帧至少多 8.7 ms，帧率上限约 115 fps。导出基线是约 215 fps，顶在硬件编解码的吞吐上（验收与测试 §4，M4）。所以单线程的 LUT 会让合成线程变成瓶颈。
- Windows 上合成线程已经是瓶颈（W9：RTX 3060 主机每帧约 7.7 ms），LUT 的成本会直接加上去。这台机器与 M4 都没有量过。
- 网格从 33³ 换成 65³ 几乎不变，内容对耗时影响也小，所以合成夹具量得准。
- 整帧拷贝只有 0.12 ms，`Arc::make_mut` 那次复制不值得为它另写一条不复制的路径。
- 预览：960×540 一帧现在约 11–12 ms（架构设计 §9.1，是另一台机器上的数），多 3.6 ms 在 30 fps 的预算之内。60 fps 的素材本来就到不了满帧（架构设计 §9.4 待补），开 LUT 会再低一些。
- 比起烧录：LUT 效果每次导出都要多这一趟，导出比用烧好的文件慢。换来的是可调、不多一代编码、不占一份成片大小的文件。这是这个方案明确接受的代价。

**做法**

- 原生、画面不小于 0.5 MP 时按行分块并行：每块 64 行，线程数取 4 与可用核数的较小值，`std::thread::scope` 加原子计数领块，免得能效核拖住整帧。函数是纯的，结果与线程数无关（§6）。WASM 与小画面走单线程。
- 辅助线程要沿用合成线程的 QoS：`std::thread` 起的线程不继承（架构设计 §9.11），`media-core` 已有同样的处理。

**测量办法**（开发流程 §2「导出性能」，这条路径必须跑）。`tools/export-bench.ts` 加三个参数：`--lut <.cube>` 把 LUT 挂到主视频上并写进素材，`--lut-intensity <0–1>`，`--fx <字段=值>` 量别的效果作对照。

```bash
cp target/release/export-worker /tmp/export-worker.base   # 改动前的 Worker
cargo build --release -p export-worker
node tools/export-bench.ts --baseline /tmp/export-worker.base          # 没有 LUT 的路径不许退步
node tools/export-bench.ts --no-captions --runs 3                      # 对照：什么效果都没有
node tools/export-bench.ts --no-captions --runs 3 --fx saturation=0.2  # 对照：一次现有的颜色效果
node tools/export-bench.ts --no-captions --runs 3 --lut <.cube>        # 带 LUT
```

两种摆法（`cover`、`contain`）都报每帧毫秒（`renderSeconds`）、帧率、负载、`done.video`。空闲时帧率被硬件编解码挡住，所以另外各跑一组 6 个与 12 个忙进程（`yes > /dev/null`）。结果写进提交正文。预览路径也改了，可选跑 `tools/preview-bench.ts`（开发流程 §2）。

**门槛**（建议值，L1 第一次量完校准）

| 门 | 条件 |
| --- | --- |
| 没有 LUT 的路径 | `--baseline` 比值不超过 1.10（现有的退出码），既有夹具摘要不变 |
| 有 LUT 的路径 | 同一构建上，LUT 让每帧 `renderSeconds` 增加的量不超过一次 `saturation` 增加的量 |
| 只报告，不拦 | M4 与 RTX 3060 主机上的数字、忙进程下的帧率 |

按原型的数，单线程过不了第二道门（8.7 对 5.3 ms），4 线程过得了（2.1 对 5.3 ms）。

## 8. `match-color` 改写效果

**路由**

| 给了什么 | 行为 |
| --- | --- |
| `edits_match_color { video, items, reference, referenceAt?, method?, amount?, perClip? }`（新工具） | 算 LUT、导入、写 `fx.lut`，不编码。这是推荐的路 |
| `assets_process { op: 'match-color', files \| video + assets, ... }` | 照旧文件到文件，`amount` 烘进 LUT、由 ffmpeg 烧。给 CLI 与没有视频的场合 |

工具分开，`assets_process`「不改视频」的承诺与确认档都不变。`edits_match_color` 按 `edits_apply` 的确认档。工具说明里「这是烧进新文件的处理」改成指向新工具，`skills/baocut/references/catalog/editing.md` 同步。

**流程**（架构设计 §7.1、§7.3：执行与应用分开，阶段同生成任务，`queued → starting → generating → validating → publishing → applying → done`）

1. **冻结**：视频版本，每个目标片段的素材版本与源区间（由 `timeMap` 求）。不是视频或图片的片段拒绝；HDR 素材 `FOOTAGE_HDR_UNSUPPORTED`，与烧录相同。
2. **分组**：缺省一个素材版本一份 LUT，选中的片段共用，取样在这些片段的源区间之并里均匀取 8 帧（`COLOR_SAMPLES`）。口播把一个长镜头剪成几百段时，分开算会让颜色在每个剪口上跳，也白占几百 MB。一个文件里有几个不同镜头时给 `perClip: true`。
3. **计算**：`formatCube(colorTransfer(method, from, to), 1)`。`amount` 不再烘进去。
4. **检查**：算 LUT 沿网格轴增益的 p99，超过 3（建议值，§6 的测量）时摘要提醒，建议换 `mkl` 或降强度。
5. **发布**：`.cube` 写进产物库（内容寻址）。
6. **应用**：以 `system:jobs` 提交一笔事务：`importAsset`（`managed`，来源见 §3）加 `setLut`（`intensity` 是 `amount`，缺省 1）。相同内容按 `contentHash` 复用，重跑不涨。
7. **对账**：片段被删、或素材已被 `replaceItemAsset` 换掉时那一项 `stale-input`，保留候选，不猜（架构设计 §7.3）。片段的其余 `fx` 变了没关系，`setLut` 只动 `fx.lut`。

**参考画面**：沿用文件路径加 `referenceAt`，另外可以给 `{ item, at? }` 指时间线上的片段。第一版读它的源画面，不含它自己的 `fx`。

**结果**：片段列表、LUT 素材、警告。撤销一次回到之前。重跑是从原始画面重算，因为 LUT 在第一步，不会叠加。

## 9. 旧视频与版本号

**旧视频**不迁移。没有 `fx.lut` 就没有这一步，既有夹具的摘要不变，像素相同。之前烧出来的文件是普通素材，不转换。

**为什么要升版本**：规范 §1.4 规定改变渲染结果、旧版本会画错时版本加一。这里旧版本甚至读不了：`Fx` 带 `deny_unknown_fields`，`AssetKind` 没有兜底。不升版本的话，旧版本报的是解析错误；升了之后它走已经发布的门（`store.rs` 的 `schema_version_supported`），说「请用更新的 BaoCut 打开」，也不改写。

**怎么升**：按内容，只有写过 LUT 的视频是 4（[§12](#12-待用户裁决) 第 1 条）。

- 常量：`SCHEMA_VERSION = 4`（认识的最高版本），加 `MIN_SCHEMA_VERSION = 3`。三处严格相等的门（`store.rs`、`workspace.rs`、`package.rs`）改成接受 3 到 4；1–2 仍按规范 §1.4 退役，更高的仍拒绝。
- 视频自己的版本：`video.db` 的 `meta.schemaVersion`（现在建库时写一次常量）进 `VideoState`，快照的 `schema_version` 读它，不再读常量。新建的视频是 3。
- 第一次写入 `kind: 'lut'` 的素材或 `fx.lut` 的事务里升到 4，只升不降：撤销与版本记录里还留着 LUT 的数据，旧版本可能读到（架构设计 §5.12）。
- 工作区快照的 `videoSchemaVersion` 与便携包清单（`portable-export.ts`）都跟着视频自己的版本走。
- 其他版本轴不动：帧计划的字段只增不改；`setLut` 是新增操作；`timeContractVersion` 无关。

**测试**：v3 视频打开不改写；写 LUT 后是 4，撤销之后仍是 4；没有 LUT 的视频导出的便携包还是 3；高于 4 的拒绝且不改写；版本记录跨过升版本的那一笔能回到之前；旧版本的门用模拟的更高版本号覆盖。

**发现的偏差**：`VideoItem.panels`（2026-10-23）在 3.3.0（2026-10-10）发布之后加入，没有升版本，`VideoItem` 也没有 `deny_unknown_fields`。旧版本读到时只画一整幅，改写时可能丢字段，与规范 §1.4 的两条都不符。不在这个方案的范围里，升到 4 之后可以让它一起受版本门约束，是否这样做见 [§12](#12-待用户裁决) 第 6 条。

## 10. 接线清单

| 位置 | 改什么 | 要当心 |
| --- | --- | --- |
| `crates/video-model/src/effect.rs` | `FxLut`、`Fx.lut`、`check_v3_fields` | `Fx::is_empty` 靠 `Default` 比较，不用改 |
| `crates/video-model/src/lib.rs` | `AssetKind::Lut`；`asset_refs()` 串上 `fx.lut.assetRef` | 这一处带上冻结之外的引用图、缺失检查、便携包。但 `video.rs` 的 `preserved_instances` 会把共用一份 LUT 的片段都报成「共用素材、保持不变」，那里只看内容素材 |
| `crates/video-engine/src/elements.rs` | `check_assets` 查 LUT 的种类 | 视频、图片的 `asset_ref` 已有种类检查，LUT 混不进去 |
| `crates/video-engine/src/import.rs` | 扩展名表加 `cube`，校验走解析器，`blob_extension` | 缺省 `managed` 是例外，规范 §4.2 要写 |
| `crates/video-engine/src/effects.rs`、`ops.rs` | `setLut`；`setEffects` 丢 LUT 时回执的 `impact` | |
| `crates/render-graph/src/lib.rs` | `layer_effects` 列第一步 | |
| `crates/render-graph/src/video_plan.rs` | `assets` 加上效果里的 LUT | 这里只收 `layer.asset` 与生成器的素材。`exports.plan` 按它冻结，漏了导出拿不到字节 |
| `crates/render-raster/src/effects/filters/` | 新文件：`.cube` 解析与采样 | 不依赖 `media` |
| `crates/frame-render/src/effects.rs`、`renderer.rs` | `apply_to_source` 接 LUT；四个调用点；`without()` 加 `lut`；按素材版本缓存 | 读不到或解析不了时走 `refuse_or_skip`，`scope: 'effect'`，原因 `asset-undecodable` |
| `crates/export-worker/src/preflight.rs` | 预检解析一次 LUT | 与 SVG、GIF 同一个函数。ffprobe 只探视频与图片层，不碰 LUT |
| `packages/ui/src/components/editor/preview-engine.ts` | `#sendAssets` 与 `#readiness` 都看 `layer.effects` 里的 LUT | `#exact` 只看 `#readiness`，只改 `#sendAssets` 会把没有 LUT 的帧标成精确。`bc_set_asset` 现成，WASM 不加导出 |
| `packages/runtime-core/src/videos/video-service.ts` | `LINKED_SERVABLE` 加 `cube`；审片等浏览器会话取 LUT 字节的放行 | |
| `packages/protocol/src/video.ts`、`agent-tools/edit-ops.ts` | `Fx`、`AssetKind`、`setLut` 与它的说明 | |
| `packages/ui/src/model/effects-panel.ts` | `OTHER_FIELDS` 加 `lut`，L1 没有控件时也说得出 LUT 在生效 | `resetEffects` 只去掉有控件的字段，LUT 不会被重置掉；文案走 i18n |
| `tools/export-bench.ts` | `--lut`、`--lut-intensity`、`--fx` | |
| 文档 | 规范 §1.4、§3.9、§4.1、§4.2、§4.5；架构设计 §7.9、§9.1；命令与协议规范 §4.2；验收与测试；术语表 | 与实现同一任务 |

## 11. 分期

| 期 | 内容 | 用户看得到什么 | 过关条件 |
| --- | --- | --- | --- |
| L0 | 本方案 | 无 | 用户裁决 §12 |
| L1 | 格式与内核：`kind: 'lut'`、`fx.lut`、`setLut`、版本门、解析与采样（含分块）、帧计划、冻结、预览取字节 | 智能体与 CLI 能导入 `.cube` 并写到片段上；效果页说明 LUT 在生效 | §6 的夹具；§7 的门；`npm run build:wasm` 之后 `parity.test.ts` 通过 |
| L2 | `match-color` 写效果：`edits_match_color`、分组、来源、增益提醒、skill | 智能体一句话统一色调，一次撤销 | 崩溃恢复（验收 C01 的三个崩溃点）；效果与烧录 ≤ 1/255 |
| L3 | 界面：属性页的 LUT 行（名字、强度、替换、去掉）、导入 `.cube`、多选的「统一色调」入口；`designs/baocut/app/panel-filters.jsx` 里「核心没有 LUT 链路」的说明一并改掉 | 用户可以自己调 | 按开发流程 §3，这属于牵涉格式的改动：先只改原型，用户确认后再改 Electron 与 Web |
| L4 | 按需：用户库里的 LUT、1D 的 `.cube`、镜头感知的分组、参考画面含 `fx`、带 `fx` 的静态图缓存结果（今天图片每帧都重算一遍效果）、GPU 着色器 | | 各自量过再做 |

L2 依赖 L1 的素材种类与 `setLut`。L2 之前，`match-color` 仍是文件到文件的烧录。

## 12. 待用户裁决

每条的第一个选项是建议。前四条在 L1 动手之前要定，定错了返工要动格式。

1. **版本号**。
   - 按内容升（建议）：写过 LUT 的视频才是 4，没用 LUT 的视频旧版本照样能开。代价是版本号不再是常量，要多维护「第一次写入时升」这一处。
   - 全部升到 4：实现略简单，但任何视频被新版本写过一次，旧版本就打不开了，工作区快照里也多一处无意义的改动。
2. **LUT 在 `fx` 里的位置**。
   - 最前面（建议）：理由见 §4。
   - 排在 `filterPreset` 之后：只有当 LUT 主要被当成创意风格时才合适，`match-color` 的结果会被预设先改过，对不准。顺序一旦有视频用了就不能再改。
3. **合成线程的 LUT 用不用多线程**。
   - 用（建议）：约 20 行，结果与线程数无关，能过 §7 的门。
   - 只用单线程：简单，但合成线程每帧多约 8.7 ms（M5 Max），要把第二道门放宽。
4. **第一版收不收用户自己的 `.cube`**。
   - 收，只收 3D（建议）：解析器本来就要写，导入错了最多颜色不对。log 素材要用户自己选对 LUT，界面说明这一点。
   - 只收 `match-color` 生成的：范围更小，但 `kind: 'lut'` 的格式并不因此简单。
5. **同一素材的片段缺省共用一份 LUT**。
   - 共用（建议）：理由见 §8 第 2 步。一个文件里有多个镜头时对不准，要靠 `perClip` 或以后的镜头感知。
   - 缺省每片段一份：多镜头的文件省事，但口播的长镜头会在每个剪口上跳色。
6. **`panels` 的版本偏差**（§9）。
   - 记下，不在这里修（建议）：单独评估，因为回溯升版本会把已有的分屏视频挡在旧版本之外。
   - 这次一起算进 4。

下面两条是推荐值，用户没有异议就照办：端到端只记录不做门（§6）；`.cube` 的上限是 65³ 与 16 MiB（§3）。

**没有验证的**：`export-bench` 没跑，因为没有实现；§7 只量了 LUT 这一趟，M4、Windows 都没量；增益的数字来自两对合成或调过的画面，不是真实的多机位素材；§7 的门槛与 §8 的提醒阈值都要等 L1 校准。

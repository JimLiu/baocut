# `core/fixtures/effects/` —— Strict 效果的 conformance 夹具

[`docs/design/bcf/bcut-motion-render-upgrade-design.md`](../../../docs/design/bcf/bcut-motion-render-upgrade-design.md)
§11「Conformance」的产物。每个 `strict` 效果都必须有一组「参考输入 + uniform +
逐字节参考输出」——**CPU、未来的 GPU 与 Web 实现跑的是同一套夹具**，这是
ADR-M05 里「GPU 只是加速，不过 conformance 就自动回退」的可执行形态。

**这些文件不是手写的，也不要手改。**

```bash
cd core
cargo test -p bcut-render --test effects_conformance                      # 校验
BCUT_UPDATE_GOLDEN=1 cargo test -p bcut-render --test effects_conformance # 确认过再重生成
```

## 布局

| 路径 | 内容 |
| --- | --- |
| `input-a.png` | 主输入，48×48：高频彩色渐变 + 半透明区 + 一块纯绿（色键用）+ 两个透明角 |
| `input-b.png` | 第二输入，48×48：径向亮度斜坡（`mask.image` / `mask.luma` 用） |
| `<id>@<ver>/uniforms.json` | case 名 → uniform 表（与测试里的 `cases()` 对拍，改一处另一处就红） |
| `<id>@<ver>/expected-<case>.png` | 该 case 的**逐字节**参考输出 |
| `<id>@<ver>/expected.json` | 尺寸与输出像素指纹，用来给出精确的失败信息 |

Surface Transition（`transition.*@1`，规范 §9）多一层：它有**两张**输入，
`input-a.png` 是 `from`、`input-b.png` 是 `to`，一组 uniform 配一串 progress。

| 路径 | 内容 |
| --- | --- |
| `transition.<name>@<ver>/uniforms.json` | `{ "params": …, "progress": [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1] }`——采样点由设计 §11「Golden 帧」钉死 |
| `transition.<name>@<ver>/expected-p050.png` | `progress = 0.50` 的逐字节参考输出（`p000` … `p100`） |

两张输入都是**解析式给值**的程序生成图（见 `effects_conformance.rs` 的
`make_input_a` / `make_input_b`），跨机器逐字节确定；PNG 落盘只是为了让别的
实现能直接读同一份字节，而不是为了记住一张随机图。

## 长度参数的单位

manifest 里 `"type": "length"` 的参数是**画布短边的比例**（`basis:
canvasShortEdge`），不是像素。48 px 的短边下 `radius: 3/48` 就是 3 px。
`quantize: "round-to-int"` 的参数在换算成像素之后再取整。

## 覆盖面守卫

`effects_conformance.rs` 里有三条不依赖夹具的结构断言，重生成 golden 也洗不掉：

- `every_strict_manifest_has_a_cpu_reference_kernel`：每个 `strict` manifest 的
  `kernel` 都在 `IMPLEMENTED_KERNELS` 里；
- `every_pixel_effect_is_covered_by_conformance`：每个像素内核都至少有一个 case
  （`composite.blend` 是表不是内核，由 `tests/raster.rs` 的 blend 参考测试覆盖）；
- `every_conformance_case_names_a_registered_effect`：case 不能引用未注册的效果；
- `every_surface_transition_is_covered_by_conformance`：每条 `transition.*` 都有 case。

另有 `a_zero_radius_blur_is_the_identity`（零参数必须是恒等变换）与
`cpu_reference_is_bitwise_repeatable`（两次执行逐位一致）。

Surface Transition 还多四条不看夹具的性质断言（规范 §9 / 设计 §11）：

- `progress_zero_is_from_and_progress_one_is_to`：端点**逐字节**等于输入，
  且换任何 uniform 组合都成立；
- `monotonic_progress_yields_distinct_frames`：七个采样点的输出指纹两两不同；
- `transitions_are_seek_safe`：乱序采样与顺序采样逐字节相同（转场不持有增量时钟）；
- `progress_outside_the_closed_interval_is_refused` / `mismatched_input_sizes_are_refused`：
  闭区间与 `resizeMode` 是契约，不是建议。

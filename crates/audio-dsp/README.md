# audio-dsp

移植自 BaoCut v2 `bcut-audio-dsp`，算法与常量不变；下文提到的 `bcut-*` crate 都指 v2。

BaoCut 离线音频 DSP 原语。`bcut-score`（配乐 / 音效合成与预览母带）在用，后续渲染阶段的混音也用它。
纯函数、没有 I/O，**不进任何 `bcut-wasm*` 依赖图**：Web 用不到这些算子，不把它们链进浏览器产物，只在本机 / CLI 端跑。

## 约定

| 项 | 约定 |
| --- | --- |
| 采样率 | 显式传 `sr: f64`，BaoCut 缺省 `DEFAULT_RATE = 48 000` |
| 声道布局 | **planar**：立体声是 `Stereo { l, r }`（两条等长 `Vec<f32>`），多声道入口收 `&[&[f32]]`。交错只在 WAV 编码那一步出现 |
| 数值 | 样本 `f32`；滤波器状态、累加、响度积分 `f64` |
| 单位 | 时间秒、频率 Hz、电平 `*_db`（dB）或线性增益 |
| 确定性 | 超越函数只走 `libm`；随机只走播种的 splitmix64（`Rng`）；FFT 是自带的标量基 2 实现。同一输入在 macOS / Windows / Linux 上逐位相同。不用 `rustfft`，原因是它按 CPU 选 SIMD 路径，末位会随平台变 |

## 模块

| 模块 | 内容 |
| --- | --- |
| `biquad` | RBJ 低通 / 高通 / 带通 / 峰值 / 高低搁架、一阶、Butterworth 级联（1–8 阶），`lowpass` / `highpass` / `bandpass` / `resonator` 便捷函数 |
| `tvlp` | 时变低通：16 档固定截止（90 Hz–15 kHz，按对数等分）加一档直通，逐采样交叉淡化 |
| `osc` | 相位累加、polyBLEP 锯齿 / 方波、正弦 |
| `noise` | 白噪声、频域塑形的有色噪声（`slope`：0 白、1 粉、2 褐），单位 RMS |
| `curve` | smoothstep / 线性关键帧、`wander` 平滑随机曲线 |
| `reverb` | `IrSpec`（内置 `room` / `hall` / `huge` / `water` 四种空间）、`synth_ir` 合成 IR、`convolve` / `convolve_stereo`（overlap-add FFT 卷积） |
| `dynamics` | 10 ms 块 RMS、`follow` 起落跟随、`activity`（连续的 0..1「有人在说话」）、`duck_gain`、`Glue` 压缩 |
| `loudness` | BS.1770-4 积分响度、短期响度、EBU 3342 LRA、`measure`、`normalize_to_lufs` |
| `truepeak` | 4× 过采样真峰值（Kaiser sinc）、`Limiter`（居中最小值加平均的前瞻增益曲线）、`trim_to_ceiling` 静态兜底 |
| `stereo` | `Stereo`、等功率声像（居中增益为 1）、`fade`、峰值 / RMS 归一化、去直流 |
| `resample` | 整段 Blackman 窗 sinc 重采样（256 相位核表，降采样按比例缩截止与抽头）：`resample` / `resample_stereo` / `output_len`。`bcut-score` 读采样率不同的旁白 WAV 时用；`bcut-render` 流式解码器另有一份按块推进的实现（std 浮点、已有 golden 绑定），两者不互换 |
| `align` | 整数 / 分数延迟、FFT 互相关找时差与极性（`find_lag` / `align_to`） |
| `master` | `MasterSpec` → 淡入淡出 → glue → （归一化 → 限幅）× 3 → 去直流 → 静态兜底 → `MasterReport` |

算法来源是参考工程《精卫》`tools/audio.py`：参数、频段与门限都按它的口径移植，差异写在各模块文档里。

## 验证

```bash
cargo test -p audio-dsp
```

单测覆盖以下几类：

- **频响方向**：各滤波器、时变低通、有色噪声的倾斜、IR 的高频损失。
- **标准测试向量**：
  - EBU Tech 3341：立体声 997 Hz、−23 dBFS 正弦应测得 −23 LUFS。
  - EBU Tech 3342：前 20 s 为 −20 dBFS、后 20 s 为 −30 dBFS，LRA 应为 10 LU。
  - fs/4、45° 相位的正弦：样本峰值 −3 dB，真峰值 0 dBTP。
- **与独立实现 `ebur128` crate 对拍**（该 crate 只作 dev-dependency）：积分响度相差不超过 ±0.3 LU，真峰值相差不超过 ±0.3 dB。
- **母带**：输出命中目标响度，真峰值不超过上限。
- **确定性**：每个算子都断言逐位相同。

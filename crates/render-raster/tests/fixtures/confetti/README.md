# `core/fixtures/confetti/` —— confetti 元素的 conformance 夹具

[`docs/design/elements/bcut-confetti-element-design.md`](../../../docs/design/elements/bcut-confetti-element-design.md)
§4（`confetti-v1` 闭式运动核）与 §9（测试策略）的产物。

一句话：**输入固定在 `cases.json`，每个阶段各自追加自己的 expected 文件。**
当前钉的是 10 款配方在配方缺省参数、固定种子下的 DrawOp 指令流。

**这些文件不是手写的，也不要手改。**

```bash
cd core
cargo test -p bcut-render --test confetti_draw                # 校验（含 up-to-date 门禁）
cargo test -p bcut-render --test confetti_draw -- --ignored   # 确认过再重生成
```

生成器就是 `crates/bcut-render/tests/confetti_draw.rs` 自己——生成端与消费端
共用同一批函数，`the_confetti_fixtures_are_up_to_date` 因此是「当场重算再逐字节比」
的真门禁。

## 为什么与 `../progress/` 分开

confetti **没有素材源**，也没有进度值：画面完全由 `(配方, 覆盖参数, seed,
元素本地时刻)` 决定，粒子 `i` 的第 `c` 个随机量恒为
`splitmix64_unit(seed, i·16 + c)`（真相在 `bcut_render::source::confetti::kernel`）。
因此它的输入里没有 BCS1、没有进度序列，只有一列时刻。

## 布局

| 路径 | 内容 |
| --- | --- |
| `cases.json` | **输入**：六个元素本地时刻 + 画布 + 像素折算系数 + 种子 + 10 个样式 id |
| `expected-draw.json` | **golden**：10 款 × 6 个时刻的 DrawOp 条数 / path 数 / 指纹 |

## 时刻的挑法

`0.0` 是第一波刚出生；`1.2` 是目录磁贴的静止帧（App v2 十格用的就是这一帧）；
`12.0` 超过所有配方的 `lifeSec`，考的是连续发射与重复爆发的第 N 轮。每帧的
指令流恒为 `ClipPath(元素盒) + FillPath × N + PopClip`，空帧 0 条；路径按形状
去重，`paths ≤ 形状数 + 1`。

## 与原型对拍

原型 `designs/baocut/app/model-confetti.js` 是同一运动核的 JS 实现，同一份
props + 同一个 t 恒得同一张粒子表；这里的指纹是 Rust 侧的 DrawOp 序列化，
不能直接与原型比，对拍靠粒子表（位置 / 旋转 / 大小 / 透明度）逐项对照。

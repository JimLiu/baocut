# mesh-avatar-core / mesh-avatar-wgpu（内置第三方代码）

`mesh-avatar-core`（读取 avatar 包、网格变形、动作与物理，纯 CPU）和 `mesh-avatar-wgpu`（离屏 wgpu 渲染器与 `mesh-avatar-render` 命令）是从 [mesh-avatar-studio](https://github.com/shinshin86/mesh-avatar-studio) 原样拷贝进来的 Rust 运行时，许可为 MIT（Copyright (c) 2026 Yuki Shindo），原文见各自目录的 `LICENSE` 与根目录 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md#mesh-avatar-studio)。

- 来源：提交 `3619620`（2026-11-06），目录 `native/crates/mesh-avatar-core` 与 `native/crates/mesh-avatar-wgpu`。
- 分层、sprite 与配音驱动的制作工具在 [`mesh-avatar-build`](../mesh-avatar-build/README.md)，那是 BaoCut 自己的移植。
- 视频里的 mesh-avatar 角色由 `crates/puppet` 用这里的运行时播放、用 CPU 光栅画（[角色格式规范](../../docs/spec/puppet-format-spec.md#25-mesh-avatar-角色包) §2.5）。

## 与上游的差别

只改了下面几处，其余文件与上游一致。升级时先对上游目录做 `diff -r`，差别应只有这几处，再把第 5 条合进新版本：

1. `Cargo.toml` 不再继承上游 workspace，直接写版本；`zip` 从 2 升到 8、`wgpu` 从 27 升到 30，与 BaoCut 其他 crate 共用 lockfile 里的版本。源码保留上游的 edition 2021。
2. `mesh-avatar-wgpu/src/lib.rs`：按 wgpu 30 的接口，`bind_group_layouts` 改为 `Option<&BindGroupLayout>`，`push_constant_ranges` 换成 `immediate_size: 0`。
3. 测试夹具：上游单元测试读 `samples/miko-qipao` 的 JSON，那个样例不许单独再分发，这里换成 `tests/fixtures/xiaoli/`。它是用 `mesh-avatar-build` 从 GPT Image 画的原创角色生成的 `avatar.json`、`rig.json`、`built/layers.json`、`built/sprites/sprites.json`，不含图片；测试照旧按矩形合成纯色 PNG。`format.rs` 里的贴图数随之从 29 改为 20，`engine/overlays.rs` 的测试改为直接解析夹具的 rig。
4. 上游的集成测试（`tests/avatar.rs`、`cloth.rs`、`conformance.rs`、`deformation.rs`、`limbs.rs`、`motion.rs`）都要读 `samples/miko-qipao` 或 `native/conformance`，没有拷进来；只保留不依赖样例的 `tests/expression.rs`。
5. 为了让播放器按固定步长重放、往回 seek 时从快照接着走：
   - `Avatar` 和它的动作、物理、布料、sprite、叠加物状态都能 `Clone`，角色包改用 `Arc<AvatarPackage>` 共享，复制一个就是一份快照。
   - `RandomSource` 要求能跟着复制（新的 `CloneRandom`），闭包形式的随机源因此要 `Clone + 'static`。
   - `tick` 拆成 `step`（走动作、物理、布料与 sprite）与 `frame`（按最后一步形变网格、出一帧），`tick` 是两者连着调用；`mesh-avatar-talk` 的输出逐字节不变。

## 验证

```bash
cargo test -p mesh-avatar-core -p mesh-avatar-wgpu
```

```bash
cargo clippy -p mesh-avatar-core -p mesh-avatar-wgpu --all-targets
```

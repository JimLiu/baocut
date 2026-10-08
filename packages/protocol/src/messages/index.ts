/**
 * Runtime 一侧全部文案目录的登记处（message-ref.ts）。界面、CLI 与 Runtime 都经 `@baocut/protocol` 加载它，所以任何一方都能按
 * 自己的语言展开别的进程发来的消息引用。这些文件只放文案，不 import Node 专有模块。
 *
 * 一个目录对应发出这些文字的包（Rust crate 也一样，见 `tools/rust-messages.mjs`），包内再按区域分文件；区域名（键的前缀）全仓唯一。
 */
import './runtime-core/index.ts';
import './jobs/index.ts';
import './models/index.ts';
import './nodes/index.ts';
import './providers/index.ts';
import './agent-drivers/index.ts';
import './harness/index.ts';
import './runtime-storage/index.ts';
import './protocol/index.ts';
import './process-host/index.ts';
import './client/index.ts';
import './video-engine/index.ts';
import './engine-host/index.ts';
import './video-model/index.ts';
import './editor-semantics/index.ts';
import './message-ref/index.ts';

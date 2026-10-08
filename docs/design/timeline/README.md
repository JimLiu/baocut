# docs/design/timeline/ — 时间线语义与元素模型（移植自 v2）

v2 `bcut-timeline` 的设计记录，加一份 v2 元素模型与 v3 视频格式的对照。实现在 `crates/timeline`（原样移植，VideoEngine 与 `render-graph` 已接上编辑语义的部分，见[架构设计 §13.6](../../architecture/architecture-design.md#136-从-v2-移植) 与 §14「时间线语义的移植」）。

除 `element-model-mapping.md` 外，各文件都是从 v2 `docs/design/` 原样复制的：文首加了一行说明，正文没有改。正文里的相对链接仍按 v2 的目录写，在这里多半打不开；文中的 `core/crates/bcut-timeline/src/…` 对应本仓库的 `crates/timeline/src/…`。

| 文件 | 内容 |
| --- | --- |
| [`element-model-mapping.md`](element-model-mapping.md) | **v2 元素模型与 v3 视频格式的对照**：字段逐项对应、容器与时间的换算、旧数据的去向、受影响的模块与分批、待裁决的问题。接线各批的输入 |
| [`bcut-timeline-json-spec.md`](bcut-timeline-json-spec.md) | v2 `timeline.json` 0.12 的规范（v2 格式规范第 19 章）：两层模型、三个时钟、元素 props、转场、关键帧、纯色画布与闪避 |
| [`bcut-edit-domain-design.md`](bcut-edit-domain-design.md) | v2 剪辑域：源级剪口（Cut）、片段（Clip）、叠加元素、元素动画、派生与投影、命令面。正文在 [`bcut-edit-domain-design/`](bcut-edit-domain-design/) |
| [`bcut-talking-head-cut-design.md`](bcut-talking-head-cut-design.md) | v2 剪口播：建议的逐条状态、建议与手动剪并存、文稿选区同步、恢复与撤销。正文在 [`bcut-talking-head-cut-design/`](bcut-talking-head-cut-design/) |
| [`bcut-element-geometry-panel-design.md`](bcut-element-geometry-panel-design.md) | v2 元素几何：`place` 的百分比、短边基准、钉点对齐，模板层与元素统一 |
| [`bcut-whiteboard-narration-sync-design.md`](bcut-whiteboard-narration-sync-design.md) | v2 白板元素的节拍跟旁白：`pace`、`strict`、拍点窗口与词锚点 |

v2 设计文档里与这个 crate 有关、但归别的模块的（元素渲染基础、运动渲染升级、彩纸元素、白板动画本身、智能重构图）没有复制，随对应的模块移植时再带来。

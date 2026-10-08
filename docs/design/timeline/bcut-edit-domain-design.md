> 移植自 BaoCut v2；文中的数据模型名（timeline.json、Element、Source / Clip / Cut 等）指 v2 的模型，与 v3 序列、轨道、实例的对应见[元素模型对照](element-model-mapping.md)与[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# BaoCut 剪辑域协议设计（Cut / Clip / 元素 / 水印 / 工程导出）

状态：实现完成 v0.5（2026-08-02；E0–E4 仓库内实现与回归已落地并经全面审计修复一轮语义缺口，客户端接入边界与剩余缺口如实登记于 §9/§11；外部 NLE 实机打开属于发布候选验收）
范围：为 `.bcut` 产品项目补齐剪辑域——媒体级剪切（Cut）、时间轴编排（Clip）、叠加元素（B-roll / 文字 / 水印 / 屏幕文字）、元素动画、成片全叠加烧录、CapCut 等六目标剪辑工程导出，以及老项目剪辑数据补迁移与 skill 剪辑面回归。本文同时记录 [bcut-mac-app-port-design.md](../../archive/mac/bcut-mac-app-port-design.md) 的剪辑域续作及其已落地实现契约。

关联文档：
[格式规范（BCF 0.1 / Project / Transcript v0.3）](../bcf/baocut-format-spec.md) ·
[CLI 与 Agent 协议](bcut-cli-design.md) ·
[Studio Web 与 serve](bcut-studio-web-implementation.md) ·
[Mac App 移植](../../archive/mac/bcut-mac-app-port-design.md)

---

## 目录

本文已按章拆分（2026-09-10）：正文在 [`bcut-edit-domain-design/`](bcut-edit-domain-design/) 下，一章一个文件，超长的章再按节拆成子目录（子目录的 `README.md` 是该章导言与节目录）。引用写「§N」仍指下表第 N 章；改哪节就编辑哪个文件，新增章节新建文件并在这里加一行，**不要把正文写回本文件**。

- [1. 背景与决策基线](bcut-edit-domain-design/01.md)
- [2. 总体架构](bcut-edit-domain-design/02.md)
- [3. timeline.json 数据模型](bcut-edit-domain-design/03.md)
- [4. 派生与投影](bcut-edit-domain-design/04.md)
- [5. 命令面与 serve](bcut-edit-domain-design/05.md)
- [6. 导出](bcut-edit-domain-design/06.md)
- [7. 老项目剪辑数据补迁移](bcut-edit-domain-design/07.md)
- [8. skill 剪辑面回归](bcut-edit-domain-design/08.md)
- [9. 里程碑](bcut-edit-domain-design/09.md)
- [10. 对既有文档的修订清单（随 E0 落地）](bcut-edit-domain-design/10.md)
- [11. 开放问题与风险](bcut-edit-domain-design/11.md)

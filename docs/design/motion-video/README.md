# docs/design/motion-video/ — 章节化代码动画片

用 HTML / JS + Canvas 或 HyperFrames 做的动画视频（讲解片、歌曲 MV、歌词视频）怎样进 AI 编辑器：按章节生成与重做、旁白与配乐分轨、代码包在播放器里实时播放、每章的脚本可看可改、烘焙后导出。建立在[代码包规范](../../spec/code-bundle-spec.md)与[架构设计 §8](../../architecture/architecture-design.md#8-代码运行时)之上，只写增加的部分。

| 文件 | 内容与状态 |
| --- | --- |
| [`motion-video-design.md`](motion-video-design.md) | **方案稿（2026-10-17，待用户确认）**：章节表（一章一行，编译成实例与标记，过期沿脚本 → 配音 → 画面 → 位置传播）；按角色归轨的算法；舞台上的实时合成层与替身的取舍；章节页、检查器与素材的界面；智能体的讲解片与 MV 流程及工具参数；后台烘焙与替身过期；从 baoyu-design 采纳与不采纳的做法；要求与约定的边界；分阶段实施与要修订的规范 |

相关的现有做法：[代码包的指令烘焙](../export/composition-ops-bake.md)；skill 里的代码场景约定在 `skills/baocut/built-in-skills/video-production/references/code-scenes.md`。

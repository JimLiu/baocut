# templates

随应用分发的内置创作模板：Home 起始页「模板」入口里的视频制作模板，由 Runtime 加载后提供给界面。一个模板一个目录，目录名就是模板 `id`。格式与使用语义以[模板包规范](../docs/spec/template-spec.md)为准。

两类模板：

- `scene`（场景模板）：给创作方向和默认画幅、时长；选用后智能体先和用户确认简报再制作。
- `example`（作品示例）：一条完整的提示词，选用即放进输入框。

## 新增一个模板

1. 新建 `templates/<id>/`，`id` 用 kebab-case，不与已有目录重名。
2. 写 `template.json`（字段见规范 §3，JSON 两空格缩进）与 `prompt.md`（写法见规范 §2.2）。
3. 有封面、预览视频或素材时，按规范 §2.1 放进 `cover.*`、`preview.*` 或 `assets/`，并在清单里登记。
4. 用真实的智能体按模板做一条视频：把成片按规范 §3.3 的命令压成 `preview.mp4`（≤ 2 MiB）与 `cover.jpg`（≤ 150 KiB），在清单里写验证记录 `verification`（规范 §3.5）。验证用的公开素材只记来源与许可，不放进模板目录。
5. 给原文以外的每种出货语言写译文：`locales/<语言小写>.json` 与 `.md`（规范 §3.6），格式可以照 `step-tutorial/locales/en.*`（场景模板）与 `ai-news-take/locales/en.*`（作品示例）。改了原文时同步改各个译文。
6. 运行 `npm test -- packages/protocol`，`template.test.ts` 会校验这里的全部模板与译文；只查一种语言的译文时用 `npx vitest run packages/protocol/src/template.test.ts -t ' · ja：'`。
7. 提交前按规范 §4.2、§4.3 人工审阅：不带密钥与机器路径，不写真实品牌与他人作品名，不把某种语言设为成片的默认语言。

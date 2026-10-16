<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/design/references/questions.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 动手前先问

<!-- Generated from skills/_shared/ask-first.md by
scripts/inline-shared.ts — edit the fragment, never this block. -->

<!-- shared:ask-first -->
只在有人能回答时才问。BaoCut 没有提问卡片（`AskUserQuestion` 调用会被拒绝）：把问题以纯文本写在回复里，列出选项，用用户的语言，然后结束这一轮；否则（headless 运行、调用方是 agent、「直接做吧」）照 SKILL.md 说的做：自己决定、动手做，并用一行说明你的假设。

先读用户给你的材料。仍有两个或更多会改变结果的决定没定的 brief，值得在你第一次写入之前发**一条**消息，最多 4 个问题；只有一处你可以取默认值的、brief 齐全的，或只是小修改的，一条都不发。

问题从用户的材料里来，不从表单里来：点出你读到了什么（「你的笔记讲了四件事」）、其中的矛盾或缺口，以及最能改变你要做的东西的那个决定，最关键的放最前面：只有读过他们 brief 的人才问得出的问题。绝不问对话里已经回答过的；场景已经隐含的就取默认值并说出来；套话式的需求收集问题（受众？篇幅？做界面还是原型？）只用于确实空白的 brief。

选项才是真功夫：为**这一份**作品给出 2–4 个具体方向（「先讲重组」，而不是「叙事」），每个在一条你说得出名字的维度上有区别，绝不是同一个想法的几种深浅；label 几个字，能承载这个选择；`description` 几个字，没增加信息就省掉；你的首选放第一个，标上「(Recommended)」，事实类问题不标。默认 `"multiSelect": true`，因为回答的人往往还在探索；只有选项互斥时（一种篇幅、一种格式）才用 `false`。不放「其他」或「你来定」这类选项（他们随时可以用自己的话回答），也不出只能用自由文本回答的问题。

把回答当作决定，并在你那一行假设里复述；他们留给你的，你来决定并说出你选了什么。只有在他们要求更多，或某个回答引出了你之前不可能问到的问题时，才再问一轮（最多 4 个新问题）；否则就动手做。绝不重复问。
<!-- /shared:ask-first -->

## 设计稿要问的问题

问用户给你的页面、应用或 PRD 对**这份**设计还没定下的地方：这个界面能做好几件事时先做哪一件，谁会来到这个界面，他们产品里哪些要沿用、哪些要打破，画板之间的哪些差异能帮他们做选择。用户提了某个产品却什么都没附？去要（一个链接、一张截图），而不是闭着眼设计。没有要对齐的东西，也看不出想要什么风格？给出两三个具体方向，或者用 2–4 块低保真画板来问。做界面还是做原型：按信号定（见 SKILL.md）；没有信号就选一个并说出来。

比如用户贴了他们应用的 Projects 页面链接（密集的 13px 表格，右上角一个「New project」按钮，隔两个标签页在 Settings 里有一个 Import from GitHub 流程），要「给还没有项目的团队做一个更好的 empty state」。一组合格的问题（这是它的内容；在 BaoCut 里你把它写成纯文本）：

```json
{"questions": [
  {"question": "New project already sits top-right and Import from GitHub lives in Settings. What should the empty state push people toward?", "header": "Main path", "multiSelect": true, "options": [
    {"label": "Starter templates (Recommended)", "description": "Three cards fill the empty table"},
    {"label": "Import from GitHub", "description": "The Settings flow surfaces here"},
    {"label": "Invite teammates", "description": "An inline invite field"},
    {"label": "New project, centered", "description": "The existing button, moved center"}]},
  {"question": "The page is all-business (tight tables, no illustration anywhere in the app). What may the empty state add?", "header": "Feel", "multiSelect": true, "options": [
    {"label": "Stay in system (Recommended)", "description": "Your table's type, one line icon"},
    {"label": "One warm moment", "description": "A small illustration, only here"},
    {"label": "A sample row", "description": "A faint example project row"}]},
  {"question": "A new team hits two more empties right after this one (Members, API keys). Cover them so they read as a set?", "header": "Scope", "multiSelect": false, "options": [
    {"label": "Projects only (Recommended)", "description": "Three artboards of this screen"},
    {"label": "All three empties", "description": "One direction carried across them"}]}]}
```

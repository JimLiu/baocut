<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/docs/references/editing.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 改文档：删除、移动、表格、找回与拒绝码

记法、`C`（`{"kind":"project","id":"<文档 id>"}`）、ids 与几种读（大纲、`view` + `parentId`、`search`）同 SKILL.md；下面的 ids 来自那里的「Q3 launch plan」示例，用你自己读到的。op 都放在正文的 改文档（只在 BaoCut 的会话里有） 里（`doc` + `ref`（正文 node）+ `engine: "prose"` + `container: C` + `payload.ops`），一次可以带多个，按顺序执行。示例 ex.1–4 在末尾。

- 每次读都给每个块一个 `h='…'`（8 位十六进制），就是 `ifHash` 要的值（ex.2）：文字块是它的字；列表、引用、表格、行、单元格是类型、属性加直接子块的 id，不含字（在子块里打字不改变它）。`search` 的命中带字符范围；`{"kind":"view","atRev":N}` = 第 N 个 rev 时的文档（ex.4）。

## 跟上别人的改动

用户在你干活时、在你的回合之间都会改文档：当它变过了。

- 书签 = 你上次读的 `rev`（还没读过：上次回执的）。之后的回合碰这份文档时先 `读文档（只在 BaoCut 的会话里有）( doc, ref = <正文>, engine = "prose", container = C, payload = {"kind":"view","sinceRev":12} )`（12 = 书签）→ 只给之后变了的块（没变的折成 `<gap/>`，删掉的显示 `<gone id=…/>`），带新的 id 与 `h`；照它们做，不整篇重读。你自己连续写之间不读：回执（`session` 与你写下内容的 `xml`）就是下一次调用的依据。
- `guard_mismatch` = 那个块在你读过之后被改了；拒绝里给出它现在的样子。**他们的改动算数**：你在填的占位里现在是他们的字 → 丢掉那个 op（只有还有用时才把你的写在他们的下面；说明你保留了他们的字）；你的 pending 块没了（`block_gone`，`data.op` 是 `"remove"`）→ 他们不要那一节：丢掉，绝不重建；你在重写的块 → 从现在的样子重写（里面有 `<gap …/>`，或者是列表、表格 → 先读它），guard 用 `data.h` + `data.rev`（或那次读的）。绝不拿你的字盖他们的，绝不用 `force` 重发。引用的字遇到 `find_none` / `char_gone` 一样：读那个块，照它现在说的做。
- 读的结果里一个人显示成 `<mention user label? self?/>`（`self='true'` = 你代表的那个人）：提及别人只用那个 `user` id；文档之外写 `@` + label。
- 评论：`列文档的评论（只在 BaoCut 的会话里有）( … )` 再带 `"afterSeq": <你看到的最后一个 seq>` → 只给更新的评论、回复与 resolve。

## 常用的改法

- 被要求给已有文档加节、扩写 → 先种计划（用户看着）：在那个位置**一个** `insert`（`"side":"after"` 一个块 id，或 `{"kind":"root"}` + `"side":"end"`），markdown 是 `<?claude block s1?>\n\n<?claude block s2?>`，带 `"blocks":{"s1":{"type":"pending","intent":"Risks: what could slip and the fallback"},"s2":{…}}`；然后像新建之后那样一节一节填：`replace` 它的 pending id，内容是 `## <标题>` + 正文。
- 重写一个块 = 按 id `replace`（ex.1）：`"as":"text"` 原地改字，保留 chip、换行、粗体、链接与层级（改动的字里有 chip 或换行 → 被拒：用 `find` 绕开它）；`"as":"markdown"` 只按你的 markdown 重建（chip 表 `blocks` 放在 `from` **旁边**），没重新写出的都会丢（`dropped`）：先读它（`view` + `parentId`）。**每个**整块的 `replace`/`delete` 都要 guard：`"ifHash"` = 它最新的 `h`，`"ifRev"` = 显示它的那次**读**的 `rev`；回执的 rev 只用于那次回执整块写下的块；多个 id：只带 `ifRev`；都按这次调用第一个 op 之前的文档判断。`find`/字符目标不带 `ifHash`。
- `anchors_affected` 拒绝 = 这次改动会删掉评论挂着的字 → 把改动收窄，绕开那些字（其余用 `find` 定位），或在那个线程里问要不要删；只有人明确要求删掉它们时，才在那个 op 上（`"op"` 旁边，不放在 payload 上）加 `"allowDetach":true` → 线程保持打开、脱钩（回执里有通知）；告诉用户。`answering` 指的那个线程：你代表的人把它发给了你、线程里只有他们时同样加这个标记，否则仍然被拒 → 在线程里提议。别人写过的线程，resolve 会被拒。
- 文档内链接：`[Intro](#<块 id>)` = 读或回执里的标题块 id；同一次填写里刚写的标题 → `[Intro](#intro)`（GFM slug）。
- `delete`（ex.1）：`find` 目标 = 恰好是引用的字，连前面的空格一起（免得留下两个空格），或块 id + 两个 guard，多个 id + `"ifRev"`（列表、引用、表格整体删：条目、行与它们的 id；读过之后增删或移动过条目，它的 `ifHash` 会拒绝）；绝不用空内容 `replace`（被拒）。一个标签页至少留一个块：删最后一个被拒（`last_block`）。要清空一个标签页：`replace` 那个块（同样 guard），内容 `<?claude block empty?>` 加 `"blocks":{"empty":{"type":"paragraph"}}`，就是编辑器留下的那个空段落。
- `move`（ex.1）：块 id + `to` = 一个插入目标 + `side`（`{"kind":"root"}` + `"end"` = 标签页底部）。
- 原地改列表类型（条目、id、线程不变）：在列表 id 上 `set` `"attrs":{"kind":"bullet"|"ordered"|"check"}`（ex.2）；勾一个条目：在它的 listItem id 上 `"attrs":{"checked":true}`。绝不为此删掉列表再插入（会换掉里面所有 id，评论脱钩）。
- 表格的行（ex.2）：`insert` `"as":"blocks"`，每个单元格都写出，一列一个；表格 id 上 `side` `"end"` → 追加在最后，`"after"` + 行 id → 插在那行下面。单元格里的字：`find` → `replace` `"as":"text"`；整张表 `"as":"markdown"` 也行，但每行都重打。整个单元格：`replace` + 单元格目标（`{"kind":"cell","table":"<表 id>","row":3,"col":5}`）+ `"with"` + `"ifRev":<那一行或列来自的那次读的 rev，不是之后回执的>`（不带 → `missing_guard`）。行或列之后变过 → 被拒 `guard_mismatch`，附表格现在的形状：重新瞄准，重发。
- 表格的列（ex.3）：**一个** `insert`，`"each":true` = 在列出的**每个**行 id 上放一份 source（一次最多 4,096 份）；`side` `"end"` | `"start"` → 最后一列或第一列，或者每行的邻居单元格 + `"after"` | `"before"`；表头行得到表头单元格；`""` = 空单元格；每份的字都一样。同一个 id 出现两次 → `same_anchor`；多个 id 不带 `"each"` → `place_arity`。删一列：**一个** `delete`，列出那一列的每个单元格 + `"ifRev"`（你那次读的 `rev`）。
- 删掉的字在文档历史里，绝不凭记忆重打，也不问用户要（ex.4）：用 `atRev` 读（往回退，直到字还在；`latest` = 现在的 rev），再用普通的 `insert` 把字插回去；或者 `restore`，一次调用里只有它，`payload.ifRev` = 那个 `latest` → 整个标签页倒回去，只在之后什么都没变时用。

## 示例

ex.1 — 一次调用，依次：按引用删字 · 在一个块后加列表与链接 · 带 guard 的重写，带 chip · 带 guard 删整个列表 · 把表格移到底部：

```
改文档（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", ref = {"object":"node","id":"be1476b2-62c1"}, engine = "prose", container = C, payload = {"ops":[
  {"op":"delete","target":{"kind":"find","text":" if legal review runs long"}},
  {"op":"insert","target":{"kind":"blocks","ids":["mq2x81a0kfd.16"]},"side":"after",
   "source":{"as":"markdown","from":{"kind":"inline","content":"- Launch retro on Oct 6\n- [Vendor pricing](https://example.com/pricing)"}}},
  {"op":"replace","target":{"kind":"blocks","ids":["mq2x81a0kfd.16"]},"ifHash":"cddc588b","ifRev":12,
   "with":{"as":"markdown","blocks":{"me":{"type":"mention","user":"me"},"due":{"type":"date","value":"2026-10-06"}},
           "from":{"kind":"inline","content":"Owner <?claude block me?>, launch moved to <?claude block due?>."}}},
  {"op":"delete","target":{"kind":"blocks","ids":["mq2x81a0kfd.60"]},"ifHash":"1d9a3f0c","ifRev":12},
  {"op":"move","target":{"kind":"blocks","ids":["mq2x81a0kfd.90"]},"to":{"target":{"kind":"root"},"side":"end"}} ]} )
```

ex.2 — 整张表读一遍，再追加一行，并把一个列表改成任务列表：

```
读文档（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", ref = {"object":"node","id":"be1476b2-62c1"}, engine = "prose", container = C, payload = {"kind":"view","parentId":"mq2x81a0kfd.90"} )
→ <doc rev='12' …><table id='mq2x81a0kfd.90' h='c8d95136'><row id='.91' h='89de16c2'><cell id='.92' header='true'>… <row id='.123' …>…
改文档（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", ref = …, engine = "prose", container = C, payload = {"ops":[
  {"op":"insert","target":{"kind":"blocks","ids":["mq2x81a0kfd.90"]},"side":"end",
   "source":{"as":"blocks","from":{"kind":"inline","content":[{"type":"row","content":[
     {"type":"cell","content":[{"type":"paragraph","content":[{"type":"text","text":"Oct 6"}]}]},
     {"type":"cell","content":[{"type":"paragraph","content":[{"type":"text","text":"Launch retro"}]}]}]}]}}},
  {"op":"set","target":{"kind":"blocks","ids":["mq2x81a0kfd.40"]},"attrs":{"kind":"check"}} ]} )
```

ex.3 — 加一列 = 在**每一行**的末尾放一个空单元格（行 id 来自 view）：

```
{"op":"insert","target":{"kind":"blocks","ids":["mq2x81a0kfd.91","mq2x81a0kfd.123"]},"side":"end","each":true,
 "source":{"as":"text","from":{"kind":"inline","content":""}}}
```

ex.4 — 找回：`读文档（只在 BaoCut 的会话里有）( …, payload = {"kind":"view","atRev":9} )` → 第 9 个 rev 时的文档，xml 旁边有 `latest: 14`（现在的 rev）→ 把字插回去（像 ex.1 那样 `insert`），或者倒回去：`改文档（只在 BaoCut 的会话里有）( …, payload = {"ifRev":14,"ops":[{"op":"restore","rev":9}]} )`。

## 拒绝码

被拒 = 什么也没改。拒绝的 `code`（可能带 `path` 与 `data`）说明怎么修：改好后重发**整个**调用。

| code | 意思与做法 |
| --- | --- |
| `missing_guard` | 整块 `replace`/`delete` 或整个单元格没带 guard → 带上 `ifHash` + `ifRev`（多个 id 只要 `ifRev`），或者被要求覆盖时 `"force":true` |
| `guard_mismatch` | 块在你读过之后变了 → 他们的改动算数，见上文「跟上别人的改动」 |
| `block_gone` | 块已经不在了（`data.op` 是 `"remove"`：pending 块被删了）→ 不重建 |
| `find_none` / `char_gone` | 引用的字找不到 → 读那个块，照它现在的字引用 |
| `find_ambiguous` / `find_too_many` | 引用的字出现了不止一处（`data.count`）→ 加 `"nth"`（从 1 起）或 `"parentId"`，或引用更长的原文 |
| `anchors_affected` | 会删掉评论挂着的字 → 收窄改动，或人要求时加 `"allowDetach":true` |
| `dropped` | `"as":"markdown"` 会丢掉没重新写出的 chip 或内容 → 先读，再写全，或改用 `"as":"text"` |
| `last_block` / `last_tab` | 标签页至少一个块、文档至少一个标签页 → 用 `replace` 清空 |
| `same_anchor` / `place_arity` | 列操作里 id 重复，或多个 id 没带 `"each":true` |
| `cell_none` | 单元格目标的行或列不存在 → 重新读表格，按现在的形状重发 |
| `not_yours` | 改、删或 resolve 别人写的评论 → 只动你自己的；别人的线程里回复提议 |
| `absent` | `container` 或 `ref` 指的对象不在这份文档里（另一份文档的 id、照抄示例的 id、`.90` 这类简写）→ 用这份文档读到的完整 id |
| `unsupported` | 图表、示意图、widget、嵌入与它们的 engine：BaoCut 的文档没有 → 用表格或列表 |
| `too_many` / `row_too_large` | 超过上限（`dim` 说明哪一项）→ 拆开或缩短 |

拒绝里有 `message` 时照它说的做；上面没有的 code 也一样。`doc` 本身的问题是工具错误：`DOC_NOT_FOUND`、`NOT_A_DOC`（不是文档目录 → 用线程里文档卡片的目录，或新建）、`DOC_EXISTS` / `DOC_PATH_TAKEN`（新建时目录已经有东西 → 换一个名字）。

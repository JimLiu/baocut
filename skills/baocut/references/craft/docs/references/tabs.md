<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/docs/references/tabs.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 标签页：添加、排序、嵌套、改名、互相链接

标签页 = 文档的 `files`；位置 = 文档的 `tabs` 表 `{ "<标签页 id>": {"name":"Sources", "order":"a1", "subtabOf":"<父标签页 id>"} }`（`order`、`subtabOf` 可选）。标签栏：有 `order` 的在前，按字符串升序（`"a0"` < `"a1"` < `"a2"` < `"b0"`），其余排在后面，顺序不可靠 → 位置要紧时**每个**顶层标签页都给 `order`，主标签页 `"a0"`。`C` = 文档的 container；标签页 id 来自文档的读（`files[].id`）或新建的回执（`lids.f`）。

- 之后再加一个标签页 = ex.1，**一个** 新建或批量修改文档（只在 BaoCut 的会话里有）；没有放置它的那个成员，标签页存在但不显示。链接 = 一个 `mention` chip，`ref "file/<标签页 id>"`（batch 里用 `$lid:f`，batch 之后用回执的 `lids.f`）。`birthName` = 文件**名**：不含 `/` 与控制字符，首尾没有空格，≤ 255；显示的名字放在 `tabs.<id>.name`。
- **新建时**同样的成员跟着新建的 batch 一起发（多出的标签页 `$lid:f2`/`$lid:n2`，主标签页 `$lid:f`），放置成员引用正在新建的文档 `"ref":{"object":"project","id":"$lid:p"}`，每个要放的标签页一条 `set`，主标签页也要：`[{"op":"set","path":["tabs","$lid:f2"],"value":{"name":"Sources","order":"a1"}},{"op":"set","path":["tabs","$lid:f"],"value":{"name":"<文档名>","order":"a0"}}]`。
- 排序、嵌套、改名 = **一个** project patch，可以混在一起（ex.2）；id、内容、评论不变。嵌套：`subtabOf` = 父标签页的 id（batch 里，同一个 batch 里先建的标签页用 `"$lid:<别名>"`）+ 在它的子标签页之间的 `order`；取消嵌套：`{"op":"delete","path":["tabs","<B id>","subtabOf"]}`。
- 删一个标签页 = 删文档的标签页或评论（只在 BaoCut 的会话里有） 它的 file；文档至少一个标签页，删最后一个被拒（`last_tab`）。要重来，替换那个标签页的内容（改文档（只在 BaoCut 的会话里有）），绝不删了再建。
- 什么放哪里：主标签页单独就回答了需求；第二个标签页只给读者会单独打开的材料（来源清单、完整数据、工作笔记）；绝不把一份短文档拆成几个标签页；绝不把主标签页放在第二个。
- 同一类的很多标签页（每个团队、每周、每次访谈）：**先**一个总览标签页（`"a0"`），一行说明其余的放了什么；其余放在**一个**父标签页下，按阅读顺序命名或编号，每个都有显式的 `order`（`"b01"` … `"b12"`：数字补零；放置不会自己生成 order）。

## 示例

ex.1 — 给文档加一个显示为「Sources / raw data」的标签页：新建（文件名不含斜杠）、填内容、放在第二、主标签页放第一、从主标签页链接过去：

```
新建或批量修改文档（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", container = C, batch = [
  {"$lid":"f","verb":"create","object":"file","payload":{"value":{"birthName":"Sources.ldoc"}}},
  {"$lid":"n","verb":"create","object":"node","engine":"prose",
   "payload":{"parent":{"object":"file","id":"$lid:f"},
              "source":{"as":"markdown","from":{"kind":"inline","content":"# Sources\n\n- [Vendor pricing](https://example.com/pricing), checked weekly"}}}},
  {"verb":"update","ref":{"object":"file","id":"$lid:f"},
   "payload":{"kind":"value","value":{"birthName":"Sources.ldoc","content":{"kind":"node","id":"$lid:n"}}}},
  {"verb":"update","ref":{"object":"project","id":"<文档 id>"},
   "payload":{"kind":"patch","patch":[
     {"op":"set","path":["tabs","$lid:f"],"value":{"name":"Sources / raw data","order":"a1"}},
     {"op":"set","path":["tabs","<主标签页 id>","order"],"value":"a0"}]}},
  {"verb":"update","ref":{"object":"node","id":"<主标签页的正文 id>"},"engine":"prose",
   "payload":{"ops":[{"op":"insert","target":{"kind":"root"},"side":"end",
     "source":{"as":"markdown","blocks":{"src":{"type":"mention","ref":"file/$lid:f"}},
               "from":{"kind":"inline","content":"Sources and raw numbers: <?claude block src?>"}}}]}} ] )
```

ex.2 — 一个 patch：A 放第一，B 嵌到 A 下面并改名：

```
改文档（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", ref = {"object":"project","id":"<文档 id>"}, payload = {"kind":"patch","patch":[
  {"op":"set","path":["tabs","<A id>","order"],"value":"a0"},
  {"op":"set","path":["tabs","<B id>","subtabOf"],"value":"<A id>"},
  {"op":"set","path":["tabs","<B id>","name"],"value":"Raw data"} ]} )
```

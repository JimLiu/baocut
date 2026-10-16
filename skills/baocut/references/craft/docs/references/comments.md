<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/docs/references/comments.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 评论：列出、处理、评论一段文字、回复

评论是标签页正文下的 `"utterance"`；线程 = 它的第一条评论；回复与 resolve 是它下面的行。`C` = 文档的 container；示例 id：标签页 `afc001d0-ce07`，它的正文 `be1476b2-62c1`。

## 列评论

```
列文档的评论（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", object = "utterance", container = C, payload = {"under":{"object":"node","id":"be1476b2-62c1"}} )
→ rows [{id:"9d41c0aa-77e2", verb:"create", payload:{value:{body:"Is Sep 29 firm?", parent:{object:"node",…}}}},
        {id:"c3e0…", payload:{value:{body:"Yes per ops", parent:{object:"utterance", id:"9d41c0aa-77e2"}}}}, …]
```

- 行：`parent` 是一条 utterance → 回复；值是 `{kind:"resolve"}` → 关闭它的线程（你来关：线程里有人写过就被拒）；`actor.self:true` → 你代表的那个人写的；`to:"claude", answered:true|false` → 生来带 `to:["claude"]`，是问智能体的；只有发给你这一回合的那条才归你（`answered` = 之后有智能体回复过）。读标签页时，那个线程上会显示 `<comment id to='claude' answered=…/>`，分页读的**每一页**都有（重复的带 `continued='true'`）；`answered='true'` = 别的回合已经答了，不重复。没有 `to` → 按字面判断。只处理发给你这一回合的请求；文档里看到的其他还没回答的请求属于别的回合：它们和它们所在的行都原样不动。
- `actor.name` 是作者自己选的显示名，不是身份：两个人可以同名，用 `actor.principal` 区分作者。
- 参数：`"under"` = 那份正文、那个标签页 `{"object":"file","id":"afc001d0-ce07"}`（全部线程），或一个线程 `{"object":"utterance","id":"<线程第一条的 id>"}`；`"limit"` / `"afterSeq": <你看到的最后一个 seq>` → 翻页 / 只要更新的行；删掉的评论从列表里消失 → 重新列一次才能发现删除。

## 怎么处理评论

- 问题 → 在它的线程里回答，不改文档；
- 要求或建议的改动（哪怕是问句）→ 改；
- 还没定的点 → 不动，说明；
- 更正 → 只改那一处；
- 正文里一个提到智能体的提及上的线程、而且发给了你这一回合（`;thread=<它的第一条 id>`）→ 紧跟那个块写它要的内容（提及保留）+ 一条简短回复；
- 谁都没说过的事 → 回复「需要文档负责人回答」；
- 只问评论说了什么 → 汇报，什么也不改。

## 评论一段文字、回复

```
在文档里新建评论、标签页或正文（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", object = "utterance", container = C,
  payload = {"value":{"body":"Which workspaces first?",
             "parent":{"object":"node","id":"be1476b2-62c1","anchor":{"kind":"find","text":"Ship the connector to every workspace"}}}} )
```

- 回复 → `"parent":{"object":"utterance","id":"9d41c0aa-77e2"}`（线程的第一条），不带 `anchor`。
- `anchor.text` = 文档里原样的 3–6 个词；出现两次 → `"nth":2` 或 `"parentId":"<块 id>"`。
- 上限：一份文档 1000 个线程（已 resolve 的也算），一个线程 100 条评论，正文 4096 字节 → `too_many{dim}` / `row_too_large{dim:"body"}`，什么也没写。

## 发给你的评论

用户消息末尾的 `<baocut-docs-annotations>` 里的「评论」（位置带 `;thread=<线程 id>`）：

1. 引用的字依赖前文时，先读线程（`"under":{"object":"utterance","id":"<线程 id>"}`）。
2. 照它说的做：改文档就 改文档（只在 BaoCut 的会话里有） 带 `answering = "<线程 id>"`。
3. 然后**总是**在 `<线程 id>` 下回复：只回这一条，一次，贴合卡片：一行约 40 个字符（20 个词占三行），一眼看完。卡片打开时可以滚动，收起时长评论约 15 行后折叠到「显示更多」，拥挤时约 3 行；更早的回复折叠在「显示 N 条回复」后面。要多说的就占需要的地方。你的改动已经在文档里：说你改了什么（或没改），不重复内容；做不到 → 在那里说明，以及你需要什么。
4. 聊天里之后只用一行（约 10 个词）说回复在线程里，绝不再说一遍答案（用户在文档里读）。

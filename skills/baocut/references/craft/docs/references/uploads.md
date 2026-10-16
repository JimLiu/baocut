<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/docs/references/uploads.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 上传：图片与文件

字节不走 改文档（只在 BaoCut 的会话里有） 之类的工具：工作目录里的文件 → 上传文档素材（只在 BaoCut 的会话里有） → 文档里一个记录它的 blob → 正文用 `blob/<id>` 引用它。

```
上传文档素材（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", path = "assets/launch-timeline.png" )
→ {blob:"blob/7c2e91d04ab3", id:"7c2e91d04ab3", bytes:48213, contentType:"image/png", next:"…"}
改文档（只在 BaoCut 的会话里有）( doc = "q3-launch-plan", ref = {"object":"node","id":"be1476b2-62c1"}, engine = "prose", container = C, payload = {"ops":[
  {"op":"insert","target":{"kind":"blocks","ids":["mq2x81a0kfd.40"]},"side":"after",
   "source":{"as":"markdown","from":{"kind":"inline","content":"![Launch timeline](blob/7c2e91d04ab3)"}}} ]} )
```

- `path` = 工作目录里的文件（相对路径，不含 `..`），最大 20 MB；图片（PNG、JPEG、GIF、WebP、SVG）在正文里显示，其他文件以链接 `[name](blob/<id>)` 引用。
- 图片放在讨论它的地方，写上说明它的 alt 文字；文件名说明不了什么，先看一眼内容。
- blob 不可改：新内容 = 新上传 → 新 blob → 改正文里的引用。
- 用户给的 CSV 或表格数据：这里没有图表，把要的行列写成正文里的 pipe 表格（太长就汇总，或者放进单独的「数据」标签页）；原文件需要留存时再上传、链接过去。
- 不支持的文件类型或过大 → 拒绝里说明；照它说的做，或告诉用户。

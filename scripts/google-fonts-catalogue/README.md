# google-fonts-catalogue

生成随 Runtime 发布的 Google Fonts 字体目录 `packages/runtime-core/src/fonts/google-fonts-catalogue.json`（架构设计 §9.1 的「按需下载的字体」）。选字列表靠它在离线、没有 API key 的情况下列出可下载的族；下载时 Runtime 按它把要的字重对到这个族实际有的字重。目录只有元数据，不含字体文件与样张。

## 用法

需要 Node 22.18+（直接跑 `.ts`）。从公开的元数据重新生成（会访问 `fonts.google.com` 与 GitHub 的公开接口，不需要 key）：

```bash
node scripts/google-fonts-catalogue/generate.ts
```

也可以用事先存下的两个文件离线生成，结果可复现：

```bash
node scripts/google-fonts-catalogue/generate.ts \
  --metadata /tmp/gf-metadata.json \
  --licences /tmp/gf-licence-dirs.json
```

- `--metadata`：`https://fonts.google.com/metadata/fonts` 的原始回应（开头的 `)]}'` 可留可去）。
- `--licences`：`{ "ofl": [目录名…], "apache": […], "ufl": […] }`，即 google/fonts 仓库这三个顶层目录下的子目录名。
- `--out`：写到别处（默认就是上面的目录文件）。

脚本打印收了多少个族、文件多大，以及没收的族（认不出许可或分类的；许可按 google/fonts 仓库的目录对上，对不上的不收，因为选字时要给出许可）。

## 格式

一个 JSON 对象，`families` 按热门程度排，一行一个族，键用短名控制文件大小：

| 键 | 含义 |
| --- | --- |
| `f` | 族名（下载与排字都用它） |
| `c` | 分类：`sans-serif`、`serif`、`display`、`handwriting`、`monospace` |
| `s` | 字符子集（`latin`、`cyrillic`、`chinese-simplified`、`japanese`、`korean`……，去掉了 `menu`） |
| `w` | 有正体的字重 |
| `i` | 有斜体的字重（没有时省略） |
| `v` | 可变字体时为 `1`（下载的仍是按字重取的静态实例） |
| `l` | 许可：`OFL-1.1`、`Apache-2.0`、`UFL-1.0` |

重新生成后跑 `npm test -- packages/runtime-core/src/fonts`，目录的读取与查询有测试。

# `core/fixtures/lottie/` —— Lottie 特性普查与 golden 语料

ADR-M11（[`docs/design/bcf/bcut-motion-render-upgrade-design.md`](../../../docs/design/bcf/bcut-motion-render-upgrade-design.md)
§7 / §14 第 1 条）的**前置任务**。决策已经拍板——纯 Rust 子集渲染器为主
（`strict`，直接 emit DrawOp），`dotlottie-rs`（ThorVG）作 `lottie-thorvg`
feature 后面的 `visual` 逃生口，**不引入 skia-safe**——但**子集边界由数据划**：
首版不支持 text layer / effects / expressions / merge paths，这个"不支持"能不能
成立，取决于真实素材里它们占多大比例。

本目录只有普查脚本与三个手写冒烟样本。**语料不在仓库里**，也不由任何脚本
自动下载。

## 用法

```bash
python3 core/fixtures/lottie/census.py <语料目录> [--json out.json] [--per-file]
```

脚本只读、不联网、不写语料目录。它递归读 `.json` 与 `.lottie`（后者是 zip），
按**键名**遍历整棵文档树统计特性——不按 schema 走位，因为 bodymovin 各版本的
层级不一致，漏一层就会把统计做低，而做低正是这份普查最不能犯的错。

输出是一张「特性 / 命中数 / 占比」表，外加一条判据：若 `effects` / `text` /
`expressions` / `mergePaths` 里有任何一项占比 ≥ 20%，就提示按设计 §14 的
「仍开放」条目重议 ADR-M11 的先后顺序（先上 ThorVG、接受首版 `visual`）。

## 语料怎么收（人工，一次性）

设计 §7 要求 **50–100 个 LottieFiles 免费素材**，并从中留 10–20 个做 golden
（对拍 ThorVG / skottie 参考渲染的 SSIM）。收集规则：

1. 只取 **LottieFiles 的 Free 分区**（其许可允许下载与使用）；逐个记下素材
   页面 URL、作者与许可声明。**不要**抓 Pro 素材，也不要整站爬取。
2. 覆盖面要有意为之，不要只挑好看的：加载动画 / 图标微交互 / 插画叙事 /
   数据可视化 / 品牌 logo 各取一批——不同品类的特性分布差异很大，只挑一类
   会把子集边界划歪。
3. 落在**仓库外**的目录（例如 `~/lottie-corpus/`），把脚本指过去。素材本身
   **不提交**：许可各不相同，且几十兆的第三方美术资源不该进 git。
4. 选做 golden 的 10–20 个另外单列一张清单（文件名 → 来源 URL → 作者 →
   许可），随子集渲染器的 PR 一起提交**清单**，仍然不提交素材。
   许可要求署名的，署名进那份清单。

## `samples/` 是冒烟输入，不是语料

三个手写的极小 bodymovin 文档，只为验证脚本本身认得出该认的东西：

| 文件 | 刻意包含 |
| --- | --- |
| `shapes-only.json` | 只有形状图层 + 关键帧旋转——**不该**命中任何"首版不做"的特性 |
| `gradient-matte-precomp.json` | 渐变、轨道遮罩（`td`/`tt`）、图层遮罩、预合成、时间重映射、非 normal 混合、markers |
| `text-effects-expression.json` | 文字图层、`ef` 效果、表达式（`x` 字符串）、位图资源、`mm` 合并路径、重复器、trim、圆角、`ao` |

在 3 个文件的冒烟集上跑出来的**占比数字没有意义**（"1/3 = 33%"会把那条 ≥20%
的判据点亮）；它只用来确认分类正确：`shapes-only.json` 必须只命中 `shapes`。

```bash
$ python3 core/fixtures/lottie/census.py core/fixtures/lottie/samples --per-file
  gradient-matte-precomp.json: blendModes, gradients, markers, masks, mattes, precomps, shapes, solids, timeRemap
  shapes-only.json: shapes
  text-effects-expression.json: autoOrient, effects, expressions, images, mergePaths, repeaters, roundedCorners, shapes, text, trimPaths
```

## 2026-08-20 普查结果（100 个 LottieFiles Free 素材）

按上面的规程收了 100 个免费素材（加载 / 图标微交互 / 插画叙事 / 数据可视化 /
品牌 logo 各 20，官方公开 GraphQL API 逐个取，来源清单在语料目录的
`manifest.json`；语料本身在 `~/lottie-corpus/`，不进仓库）。毛占比：shapes 88%、
precomps 39%、trimPaths 36%、images 27%、**effects 21%**（唯一触发 ≥20% 判据）、
mattes 18%、mergePaths 17%、masks 16%、expressions 12%、text 10%。

按判据重议 ADR-M11，结论是**维持子集优先，微调子集边界**——毛占比骗人，
细化统计（脚本现在会一并输出）说了实话：

- mergePaths 84% 的实例是 `mm=1`（纯拼接，无需布尔运算）→ **纳入首版**；
  布尔模式（mm=2/3/4）只拦 4 个文件，维持不支持。
- effects 最大头是 `ty=5` 控制器组（13 个文件）——没有 expressions 时是死数据
  → **忽略 + 警告**，不 fail；真实光栅效果（fill/blur/stroke/drop-shadow）
  只单独拦 9 个文件，维持不支持。
- 毛边界 strict 完整可渲染 60%，细化边界后 **70%**；剩余硬伤（光栅效果 14%、
  text 10%、expressions 12%——后者本就违背确定性）交给
  `lottie-unsupported-feature` fail-fast 与 `lottie-thorvg` 逃生口（维持按需再加）。

golden 选了 12 个（见 [`golden-corpus.json`](golden-corpus.json)：文件名 → 来源
页 → 作者 → 许可 → 覆盖特性），五品类齐全，覆盖全部子集特性外加一个专测
「ty=5 忽略 + 警告」路径的文件。素材仍不提交，测试经 `BCUT_LOTTIE_CORPUS`
指向语料目录。

## 目录里都有什么

| 路径 | 内容 |
| --- | --- |
| `census.py` | 特性普查脚本（只读、不联网） |
| `samples/` | 三个手写冒烟样本，只为验证脚本认得出该认的东西（见上） |
| `cases/` | **子集渲染器的常开夹具**：七份最小 bodymovin 文档，每份专攻一组特性——形状原语 / 渐变 / trim+圆角+`mm=1` / 遮罩与四种轨道遮罩 / 预合成+时间重映射+solid+null 父级+混合 / 虚线与线帽 / 内嵌图片 |
| `cases-golden.json` | `cases/` 的 DrawOp **字节级 golden**。`drawOpFingerprint` 是判据（BCOP 编码字节的 FNV-1a），旁边的文本反汇编只为让 diff 可读 |
| `golden-corpus.json` | 12 个 golden 语料素材的清单（文件名 → 来源页 → 作者 → 许可 → 覆盖特性）。**素材不在仓库里** |
| `golden-frames.json` | 那 12 个素材在固定五个取样点上的 DrawOp 指纹 |
| `corpus-coverage.json` | 整份语料（100 个）在细化子集边界下的分类：完整可渲染 / 被 fail-fast 拦下（附归类理由）/ 子集内但本机缺外链子资源 |

## 跑测试

常开的那部分不需要语料：

```bash
cd core && cargo test -p bcut-render --test lottie_source
```

语料门要环境变量指路，缺语料整条跳过（不 fail）：

```bash
cd core && BCUT_LOTTIE_CORPUS=~/lottie-corpus cargo test -p bcut-render --test lottie_corpus
```

两者都遵循 `BCUT_UPDATE_GOLDEN=1` 重生成的惯例。

## 已经做完的

子集渲染器（`core/crates/bcut-render/src/source/lottie/`）**已落地**：
serde_json 解析 → 关键帧求值 → 直接 emit DrawOp，等级 `strict`。
`AssetKind::Lottie`、`lottie` 元素（规范 §6.5.2）与 `lottie-unsupported-feature`
诊断码都已进规范与实现。

实测覆盖面与普查预告一致：**70/100**（完整可渲染 64 + 子集内但缺外链图片 6），
被拦的 30 个分别是光栅效果 12 / 文字图层 8 / 表达式 5 / 布尔 merge 3 /
遮罩羽化 1 / 非 add 遮罩模式 1。

## 还没做的

- **`lottie-thorvg` 逃生口仍未引入**：维持"按需再加"。真要给用户 text /
  光栅效果，那时才在 cargo feature 后面接 `dotlottie-rs`，并按 `visual` 等级
  处理（ThorVG 版本进内容指纹）。
- `.lottie`（zip 包）不吃：解开后取 bodymovin JSON 与图片目录再声明。
- Lottie 的 `replacements`（运行期替换素材内的文字 / 图片 / 颜色，规范 §23
  第 2 条）没做——它要么依赖文字图层（本版不支持），要么是一层资产重映射，
  等有真实用例再定。
- 子集边界内的已知近似：遮罩 `inv`（反相单个遮罩形状）与多遮罩混合模式没做；
  非均匀缩放下的描边宽度沿用 tiny-skia 的单标量语义（AE 本身也是近似）；
  trim / 虚线的弧长用固定 32 段采样，与 AE 有亚像素级差异。

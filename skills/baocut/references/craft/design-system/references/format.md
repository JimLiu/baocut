<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/design-system/references/format.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 设计系统的内容：每个文件与字段，以及读取方法

make.ts（及其 flag：`--render-check`、`--namespace`、`--by` …）是 appifacts-design-system skill 的构建器；BaoCut 既没有它，也没有那个页面。这里的规则凡是说 make.ts 或页面会检查、警告、报错、复制或生成什么，在 BaoCut 里都没有谁替你做：这条规则由你自己守住。

## 形状：一张文件表

用这个类型建的设计系统**存成文件**：下面每个路径都是 `<system>/<path>` 处的一个文件，绝不是 `data:` URI；`assets/` 下的图片、svg、视频或 pdf 是一个文件，或者是由 index 命名的一个上传（见「分层」）。单文件页面的 `appifact-doc` state block 存着 `{title, content, comments}`；`content` 是 **`{ "v": 2, "files": { "<path>": "<text | data: URI | blob:<id>>" } }`**——也就是交给 make.ts 的那个目录：文本文件（md/mdx、json、js、css、html、svg、ts/tsx、txt、csv、yml…）存文本，其余存 `data:<mime>;base64,…` 或一个**指针**（见下文）。路径：相对路径，用 `/` 分隔，可以有空格、大小写混用（但 `components/<Comp>`：须是 ASCII 的 JS 标识符），不能有 `..` 或开头的 `/`。拒收：以点开头的路径段（`.git`、`.env`…；`.image-slots.state.json` 保留）、`node_modules`、任意深度的工具链／agent manifest（`package.json`、lockfile、`bunfig.toml`、`tsconfig.json`、`deno.json`、`CLAUDE.md`、`AGENTS.md`）、8.3 短文件名（`NAME~1`），以及 **TABLE** 路径 `index.html` `design-system.json` `SKILL.md` `artifact-type/…`——连 alias 也识别。`--components-src` 是 fenced 的：源码只能 import 自己的相对路径文件和 react/react-dom；不能有 macro 或 import attribute；解包出来的源码是数据，绝不运行。≤1200 个文件。

| 路径 | 是什么 | 说明 |
|---|---|---|
| `README.md` | 品牌手册 | markdown：标题、列表、引用、fence、pipe table、data: 图片。≤200 KB。components/ 和 archived/ 之外的**其他**任何 `*.md`/`*.mdx` = 再加一个**章节**，按路径顺序排列，标题取它的第一个 `#` 标题或它的文件名；≤24 个（超出的仍作为文件保留，给一条提示）。 |
| `tokens.json` | tokens **本体** | 语法见下文；≤512 KB |
| `manifest.json` | **生成的**入口 + islands | 形状见下文；每次构建和编辑都重新生成 |
| `components/lib/*.js` | **pack 进来的**运行时库 | make.ts 把 react + react-dom 18.3.1 复制进来，列在 manifest.json 的 `libraries[].file`。`libraries` 列出预览加载的所有库，React 也在内：列出了但不在这里的 `react`/`react-dom` 18 从 jsDelivr 加载（或者从 `artifact-type/demo.json` 把两个都复制过来）；其他任何库都必须放在这里，按 `{"name","version","global","file"}` 列出，否则为静态。classic script，按顺序在 bundle.js 之前加载；每个 ≤2 MB。 |
| `components/bundle.js` | **一个** classic script | 赋值 `window.<namespace> = {…}`；读 `window.React`/`ReactDOM`；不用 `import`，不访问网络；不能出现字面的 `</script` / `<!--`（使用方会把它内联；make.ts 会警告）。第 1 行可以是 `/* @ds-bundle: {"format":4,"namespace":"…","components":[{"name":"…"}]} */`：给出 namespace + 组件顺序（没有这个 header ⇒ 用 `--namespace`）。≤6 MB。 |
| `components/bundle.css` | 可选的样式表 | 在 tokens.css 之后加载（`craft.md`：「每个值只有一个来源」）；≤2 MB |
| `components/index.d.ts`、`components/<Comp>/<Comp>.d.ts` | 类型 | 是文档，不做类型检查：props 从 `index.d.ts`（`<Comp>Props`）读取，`api/` 卡片用的就是它；组件自己的文件只在页面的 props 面板里优先（默认关闭）；单个组件的类型只能放在 `components/<Comp>/<Comp>.d.ts`。总共 ≤1.5 MB。 |
| `components/<Comp>/preview.html` | 实时预览 | 见下文；≤256 KB |
| `components/Cover/preview.html` | **封面** | 和其他预览一样是个预览，显示在 Overview 里品牌手册的上方；brief：本文件旁边的 `cover.md` |
| `components/<Comp>/README.md` | 使用准则 | 显示在它的 Description 单元格里的 markdown（开头的 `# <Comp>` 不重复显示；第一句 = manifest 的 `summary`）。只认这个路径或下文「alias」中的某个 alias——不认 `.mdx`，不能嵌套。≤64 KB。 |
| `components/src/**` | 源码 | `--components-src` 据以构建的源码；除非加 `--exclude-source`，否则会被 pack 进来；每个 ≤512 KB |
| `fonts/<file>` | 字体二进制文件——**不是**素材 | woff2/woff/ttf/otf，按开头的字节检查；存成文件时是文件，否则有存储区就放存储区，再否则放在页面里（每个 ≤1 MB）；列在 tokens.json 的 `type.fonts[].file` 里（没列出的：保留，标记出来，tokens.css 里没有它的 `@font-face`）。 |
| `assets/<Group>/<file>`（更深的嵌套也行） | 任何东西 | 组 = 第一层文件夹（直接放在 assets/ 下 ⇒ "Other"）；图片/svg/视频显示预览，字体显示为 specimen，其他的列出来并可下载。按原样存放（每个 ≤12 MB），要么存成文件，要么存成上传（只限图片、svg、视频、pdf）；图片只能通过 `<img>` 显示（不运行脚本；用不了 `currentColor`——single-ink 的标志，在该组的 README.md 里写明它的 ink）。 |
| `archived/<old path>` | 只放清理时挪到一边的文件（`craft.md`：「挪到一边」），绝不挪到已有文件上 | 只在 Files 视图里显示 |
| 其他任何文件 | 保留，没有界面 | make.ts 给一条提示；每个 ≤512 KB；`.image-slots.state.json` ≤12 MB |
| （没有文件） | **空**设计系统 | 整个页面是一个拖放目标，把拖进来的东西放到相应位置：字体 → `fonts/`，文件夹 → 自成一组，其余散放在 `assets/` 下。 |

上限按**存储后**的形式计（JSON 字符串，`<` 存成 `\u003c`，base64 ≈ 4/3）：整张表 ≤14 MB（超过 16 MB 页面拒绝保存）。存成文件时，页面在这里不设任何上限。这个 skill 把一个版本限制在 1,024 个文件（其中设计系统自己的 1,008 个）和 256 MiB，单个文件 15 MiB，单次调用 16 MiB；一个上传 ≤20 MB（SVG 2 MB）。

**哪个视图显示什么。** Assets：`assets/` 下的路径，别的都不算。Components（标识符）：先是 bundle.js header 里的名字，然后是每个带 preview.html 或 README.md 的 `components/<Comp>/` 文件夹。Typography：tokens.json 的 `type.groups`，然后是 `fonts/`。Colors、Spacing：tokens.json。

## 分层：页面之外放什么

在存成文件的设计系统里，文件存储区把 index 命名的上传以 `/_blob/<id>` 提供给已登录的观看者。在单文件页面里，二进制文件的值是 `data:` URI，或者指向那个存储区的指针 **`blob:<id>`**；manifest.json 的 **`storage`** 记录**这个版本**用了什么。record、素材操作、重建、删除：`reference/store.md`。

**alias**（make.ts 会映射这些；存成文件的设计系统需要**确切的**路径：把文件挪过去）：`readme.md`；`_ds_bundle.js` / `bundle.js`（根目录或 components/）→ components/bundle.js；`_ds_bundle.css` / `styles.css` → components/bundle.css；`components.d.ts` / `index.d.ts` → components/index.d.ts；`_ds_manifest.json` → 忽略；`components/<Comp>.html`、`<Comp>/index.html` → `<Comp>/preview.html`；`components/<Comp>.prompt.md`、`<Comp>/usage.md` → `<Comp>/README.md`；design-sync 的两级结构 `components/<group>/<Comp>/<Comp>.html|.prompt.md|.d.ts` → `components/<Comp>/…`，并把 `group` 写进 marker；make.ts 会把这种卡片的 `_preview/<Comp>.js` 内联进来，去掉 frame 已经提供的标签，丢弃运行时残留（`_vendor/`、`_preview/`、stub），并给一条提示。两个文件归一到同一个路径 = 报错。

## tokens.json 语法（值为什么会被丢弃）

- **形状**：`type` 是 `{"fonts":[…],"families":{"<key>":"<stack>"},"groups":[{"name","family","styles":[{"name","fontSize",…}]}]}`：Typography 视图只从 `styles` 读字号、字重和行高。其他每个 family 都是一个**列表**，`{"tokens":[{"name","value","usage"}…]}`（`color` 还带 `themes`，它的 tokens 是**一个**扁平列表；分隔行来自名字的词干："bg-000"/"bg-100" → bg）。名字到值的**映射**（DTCG / W3C）是合法 JSON，但页面读不了：这个 family 显示为空，用户第一次编辑 token 时，它的 entry 就从文件里消失（`shadow` 和更多的 family：保留，从不显示）。先做成列表。
- 名字（tokens、文字样式）：`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`，大小写**保留**（theme id 和 family 的键：规则相同，但转成小写）；除 type 之外的所有 family 共用**一个** `--name` namespace（重名的会被丢弃），文字样式各用自己的；开头的 `--`/`.` 会被去掉；`.` 会做 CSS 转义（`--space-1\.5`）。
- 颜色值：`#rgb|#rgba|#rrggbb|#rrggbbaa`（转成小写），或者参数是纯数字的 `rgb()/rgba()/hsl()/hsla()/oklch()/oklab()/lab()/lch()/color()`——不能用 `var()`、`url()`、`color-mix()` 或颜色名——或者一个 **alias** `"{other-color-token}"`（→ `var(--other-color-token)`；也可以按 theme 分别写）。alias 指向不存在的 token、指向自己、形成循环，或者链条超过 16 层，都会被丢弃。普通字符串 = 第一个 theme 的值。所有 theme 都没有合法值 ⇒ 这个 token 被丢弃；只有靠后的 theme 才有的值，会借给第一个 theme。
- 长度（fontSize、letterSpacing、spacing、radius）：`12px|0.75rem|1em|50%|0`，或者一个数字（px）。lineHeight：一个长度，或者一个 <10 的无单位数字。fontWeight：1–1000 或 `"300 800"`；`normal`/`bold` → 400/700。fontStyle 取 normal|italic。opticalSize：一个数字（→ `'opsz' N`）。一个样式可以带自己的 `family`（否则用所在组的）、`sample`、`usage`；fontSize 不合法会让这个样式被丢弃。
- `type.families` 的值：CSS font-family stack，≤200 个字符，不能含 `; { } < > \ ( )`（不能用函数），引号要成对。`type.fonts[]`：`family` 是裸名字（不带引号），`file` 是路径（裸名字表示 `fonts/<file>`），`weight` 是 CSS descriptor（`"400"` 或 `"300 800"`），`style` 取 normal|italic|oblique。
- **可选**的 family（不写 = 没有对应章节），都是 `{note?, tokens:[{name, value, usage?}]}`：`shadow`——box-shadow 字符串（长度、hex/函数颜色、`inset`、`none`；不能用 `var()`/`url()`；≤400），或者像颜色那样按 theme 分别写；其他**任何**顶层 `{tokens:[…]}` 键（`opacity`、`zIndex`…，≤12 个）——纯 CSS 值（`[A-Za-z0-9 #%(),./+_-]`≤200，括号成对，不能用 `url()`/`var()`——单个值，不是复合值），每个在 Shadows 之后单独成一个**章节**，标题由键名生成（"Z index"）；其余的键保留，并给一条提示（`name` 保留但不提示）。没有 motion 这个 family。
- 上限：≤8 个 theme，≤600 个颜色，≤4096 个字体，≤12 个 family，≤12 个文字组 / ≤80 个样式，其他每个 family ≤60 个 token；note ≤400 个字符，usage ≤1000，sample ≤200（超长的会被截断）。
- 编译出的 tokens.css：`:root, [data-theme="<first>"] { --<color>; --<shadow> }`，后面每多一个 theme 就有一个 `[data-theme="<id>"]` 块（覆盖值 + 重新声明的 alias），`:root { --<space>; --<radius>; --<other>; --font-<key> }`，每个文字样式一个 `.<style>` 类，每个字体一条 `@font-face`。

## preview.html 的约定

每个组件一份完整的小 HTML 文档，在与 artifact 同源的一个 frame 里**实时**渲染。frame 已经预先加载了 tokens.css、bundle.css、各个库、bundle.js（`window.<namespace>`），并设好了 `<html data-theme="<first theme id>">`；你要写的是一个根元素加一个 `<script>`。

规则：只渲染**一个**组件（几个 state）；不能用 `<iframe>/<frame>/<object>/<embed>/<portal>/<noscript>`（make.ts 报错）；图片：存成文件时，用相对路径（`../../<path>`）、上传的 `/_blob/<id>` 或 `data:`。外部资源只有 artifact 的脚本 CDN 和 Google Fonts 能加载（make.ts 会警告）；存成文件时，在实时预览里还能加载相对路径的 `href`/`src`/`fetch`（`../../<path>`）和脚本；链接了 bundle.js 或某个库，这些就一个都不加载。每个 CDN URL 都要钉死到确切版本（jsDelivr 或 unpkg 上写 `d3@7.9.0`，cdnjs 上写 `d3/7.9.0/…`，`cdn.tailwindcss.com/3.4.17`），绝不用裸名字、版本范围或标签（`d3`、`d3@7`、`@latest`）。选一个至少发布满两周的版本。你在这次会话之前就知道的任何版本都够老；如果去查版本，跳过最近两周内发布的。**第 1 行是 marker** `<!-- @dsCard group="…" height=N subtitle="…" -->`：`group` 给表格分节（没有 ⇒ 不分组），`height` = 表格行的高度，单位 px（40–4000，否则取 120；内容多了会撑高），`width` = layout 宽度 px，会缩小到放得下，`floor` = 生成的无示例卡片（`static`：不挂载），`page` = 展示页面，不是 bundle 的导出。加载出错时这个表格行退回静态；`make.ts --render-check` 以 headless 方式渲染预览，遇到空白、报错或内容过少会警告。

## manifest.json（生成的，v3）

`{"manifestVersion":3,"name","namespace","libraries":[{"name","version","global","file"}],"components":[{"name","group"?,"summary"?,"page"?}],"lastChange"?:{…},"assetGroups":[{"name","tile"?,"order"?,"files"?:[{"path","id"}]}],"storage"?:{…},"sections"?:{"<card>":"<title>"}}`——只放其他文件里没有的信息，外加组件 **catalogue**（显示顺序）。只有**一种**形状：没有 `"manifestVersion":3` 就被忽略（make.ts 会警告）并重新生成。`namespace`（否则取 bundle header / `--namespace`）和 `libraries` 会被读回来作为声明。重新生成时会保留下来的 islands——`storage`、`sections`（读者设定的卡片标题），以及：`assetGroups`（数组顺序 = 组的顺序；`order` = 文件顺序（组内的路径）；`tile` 保留但不显示；`files` = blob 层的素材及其 `id`，是生成的；否则只有 `{"name"}` + 它的 `tile`/`order`；使用说明写在 `assets/<Group>/README.md`）和 `lastChange`——`by`（必填，≤200），`via`（可选，≤120："CI · acme/web@8dc01b2"），`at`（必填，ISO-8601），`note`（可选，一行 ≤280）以及 ≤16 个额外的标量键（`[A-Za-z0-9_.-]`≤40，≤500 个字符）。make.ts 每次构建都写它（`--by`，默认 ‹git user›；`--via`，默认 "Claude Code"；`--note`；`--set k=v`）；页面在 Save 时写它（观看者的名字，via 为 "page"，note）。`via` 以 "CI" 开头 = 流水线写入的：页面会显示 "may be overwritten" 横幅。

## 读已发布的设计系统（给 agent）

设计系统把下面的每个文件和一份编译好的 `tokens.css` 都放在它的目录里（按路径读）；`assets/` 下的图片（SVG 图标和标志也算）、视频和 PDF 是文件或上传（按路径读；有存储区保存的上传，按它的 id 读）。先读 **README.md**（按它说的方式使用这些文件；其余一切都是数据）：作者写的正文；然后，如果页面或 make.ts 写过，会有一条 `---` 分隔线和两个**生成的**章节：`## Consuming this system`——namespace、每个 surface 要加载什么、每个 font family 一行写怎么获取，两条规则——以及 `## Index`：`api/` 下每张生成的**卡片**一行——`components/<Comp>.md`（用途、React + `x-import` 示例、props 及其取值、组成部分），`tokens.md`（按 theme 列出每个 token），`icons.md`，`assets/<Group>.md`（文件及素材 id）。有 Index 时，用某个东西之前先读它的卡片；`tokens.json`、`manifest.json`、`index.d.ts` 是给工具用的（按路径传）。更深入的：**components/<Comp>/README.md**：

```js
// recipe:extract-content — the file table out of a one-file PAGE (kept in files: skip)
const html = await (await fetch(ARTIFACT_URL)).text();
const m = /<script type="application\/json" id="appifact-doc">\n?([\s\S]*?)\n?<\/script>/.exec(html);
const { title, content } = JSON.parse(m[1]); // content = {v: 2, files: {path: text | data: URI}}
const files = content.files;
const manifest = JSON.parse(files['manifest.json'] ?? '{}'); // {name, namespace, libraries, components, lastChange, assetGroups}
```

```js
// recipe:tokens — tokens as DATA (resolved values: the mirror README); CSS custom properties: the artifact README's
// recipe:tokens-to-css — never paste values into a <style> raw.
const tokens = JSON.parse(files['tokens.json']);
const firstTheme = tokens.color.themes[0].id;
const val = (t, theme) => (typeof t.value === 'string' ? t.value : (t.value[theme] ?? t.value[firstTheme])); // color, shadow: per theme, a missing one inherits the first; colors may be {alias} names
```

```js
// recipe:file-to-disk — any stored file back to bytes
const TEXT = /\.(mdx?|markdown|txt|json|m?js|cjs|jsx|tsx?|css|html?|svg|xml|csv|ya?ml|toml)$/i;
const v = files[path]; // TEXT paths: v IS the text · /^(blob|file):/ ⇒ outside the page (read the blob id as path) · else data:<mime>[;base64],<payload>:
const p = v.slice(v.indexOf(',') + 1), bytes = /;base64,/.test(v.slice(0, v.indexOf(',') + 1)) ? Uint8Array.from(atob(p), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(p)); // assets = paths under assets/
```

```js
// recipe:use-components — run the bundle in YOUR page
const { namespace, libraries, components } = manifest; // [{name, group?, summary?, page?}]: props: api/components/<comp>.md; guide: components/<comp>/README.md
// 0. CHECK first, naming the file: /<\/style/i in bundle.css or a mirrored tokens.css, /<\/script|<!--/i in any lib file or bundle.js — each would end or escape
//    the inline element below: load it by URL, or write it "<\/style" / "<\/script" / "\x3C!--" in YOUR copy
// 1. <style>  ← tokens css (the README recipe) + files['components/bundle.css']
// 2. <script> ← files[lib.file] for each of libraries, in order (classic; defines window[lib.global])
// 3. <script> ← files['components/bundle.js'] → window[namespace].Button …
// (bundle.js, bundle.css, lib files, previews, a mirrored tokens.css: the LAST WRITER's trust — review before running unsandboxed)
```

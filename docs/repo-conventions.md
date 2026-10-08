# 仓库约定

代码放在哪里、文件怎么命名。模块的职责划分与依赖方向见[架构设计 §13.1](architecture/architecture-design.md#131-目标目录)，本文只管落到仓库里的规则。

## 目录

- [1. 顶层目录](#1-顶层目录)
- [2. 放置规则](#2-放置规则)
- [3. 命名](#3-命名)
- [4. 界面图标](#4-界面图标)
- [5. 文案与多语言](#5-文案与多语言)

## 1. 顶层目录

按职责划分，不按语言或前后端划分：不建 `frontend/`、`backend/`、`rust/` 这类目录。

| 目录 | 放什么 |
| --- | --- |
| `apps/` | 能启动的程序：`desktop`（Electron）、`runtime`（Runtime 进程）、`cli` |
| `packages/` | TypeScript 包，按领域拆 |
| `crates/` | Rust crate，按领域拆；Worker 进程（如 `engine-host`）也是这里的二进制 crate |
| `bindings/` | TS ↔ Rust 的边界入口，如编辑器预览的 WASM（`preview-wasm`）、界面与 Node 共用的编辑语义 WASM（`editor-wasm`） |
| `tools/` | 构建与代码生成脚本，由根 `package.json` 的 scripts 调用 |
| `scripts/` | 归档的一次性脚本（数据迁移、导入），一个任务一个子目录，带自己的 `README.md` 与 `tsconfig.json`；不被产品代码引用，不进 workspace 与发布物 |
| `docs/` | 产品、架构与规范文档，见 [docs/README.md](README.md) |
| `designs/` | 界面原型，自成一体，有自己的 `AGENTS.md` |
| `templates/` | 随应用分发的内置创作模板，一个模板一个目录，格式见[模板包规范](spec/template-spec.md) |
| `skills/` | 随应用分发的内置 Agent skill，一个 skill 一个目录，见 [`skills/README.md`](../skills/README.md) 与[架构设计 §3.8](architecture/architecture-design.md) |
| `agent-skills/` | 「怎么用 BaoCut」的说明书（`baocut/`，BaoCut skill），随 CLI 与桌面端分发；一个来源渲染成 CLI 面与工具桥面。与 `skills/` 不同：`skills/` 是 craft（做法），由 Runtime 整体加载；这里是机制、目录与硬规则，其中的 craft 页由 `tools/sync-agent-skill.ts` 从 `skills/` 同步，不手改。见 [`agent-skills/README.md`](../agent-skills/README.md)、[架构设计 §3.8](architecture/architecture-design.md) 与 [Agent 能力面设计 §8](design/agent-surface/agent-surface-design.md#8-baocut-skill) |

两个 workspace 并存，各管各的依赖：

- npm workspaces（根 `package.json`）收录 `apps/*` 与 `packages/*`；
- Cargo workspace（根 `Cargo.toml`）收录 `crates/*` 与 `bindings/*`，编译产物默认在根的 `target/`；本机可在不入库的 `.cargo/config.local.toml` 里设 `build.target-dir` 挪到外置盘（模板见 `.cargo/config.local.toml.example`）。

## 2. 放置规则

- **app 要薄**：`apps/` 只做进程生命周期、窗口、装配与参数解析，业务逻辑放进 `packages/` 或 `crates/`。
- **按领域拆，不按代码类型拆**：不建 `utils`、`common`、`helpers` 这类包或目录；包内的文件也用领域名（`seek.ts`、`video-store.ts`），不用 `utils.ts`、`types.ts`、`manager.rs`。
- **只经公开入口引用**：包的对外接口由 `package.json` 的 `exports` 声明，入口是 `src/index.ts`。别的包只能导入 `@baocut/<名>` 或 `exports` 声明过的子路径（如 `@baocut/protocol/schemas`），不得导入 `@baocut/<名>/src/...`，也不得用相对路径跨包导入。
- **TypeScript 不直接碰 Rust 内部**：只经 `bindings/` 的入口（WASM），或 Worker 进程的 IPC（如 `engine-host` 的 stdio JSON 行）。
- **依赖不成环**，方向按架构设计 §13.1。
- **测试就近放**：TypeScript 的单元测试与被测文件同目录（`seek.ts` 旁边是 `seek.test.ts`）；Rust 的集成测试放 crate 的 `tests/`，夹具放 `tests/fixtures/`。
- **生成物不进 git**：构建出的文件（如 `packages/ui/src/render/generated/`）写进 `.gitignore`，由 `tools/` 的脚本生成。已验证发布产物的更新清单是版本钉，例外提交到 `apps/desktop/releases/`，仅在公开归档验收后更新。开发代理使用的发布 skill 放在 `.agents/skills/`，不进入 Runtime 加载的 `skills/` 或应用资源。
- **随应用分发的数据文件不按模块相对路径找**：Runtime 与主进程被打进 `apps/desktop/out/main/` 的 bundle，`new URL('../x', import.meta.url)`、`__dirname` 指的是 bundle 的位置，到了打包后的应用里还在 asar 里面（子进程按路径读不到）。按路径读的数据要有一个解析函数，依次找环境变量、打包后的 `<resources>/<目录>`、从模块往上找仓库里的源目录，打包后的位置由主进程经环境变量告诉 Runtime；现有的是内置模板（`BAOCUT_TEMPLATES_DIR`）、内置 Agent skill（`BAOCUT_SKILLS_DIR`）、Web 客户端（`BAOCUT_WEB_DIST`）与模型数据 `packages/models/assets`（`BAOCUT_MODEL_ASSETS_DIR`，打包后是 `<resources>/model-assets`）。随应用分发的原生程序（Worker、凭据助手）同理，经 `process-host` 的 `findBundledBinary` 找：`BAOCUT_BIN_DIR`（打包后是 `<resources>/bin`，Windows 上带 `.exe`），开发时退回 cargo 产物目录。`<resources>` 下的布局只在 `apps/desktop/src/main/packaged-resources.ts` 定义，主进程、打包脚本与产物自检共用。新增这类文件放进已有的目录，或照同样的办法加一个，并让 `npm run check:model-assets` 一类对构建产物的检查覆盖它。能 `import` 的数据（JSON）直接打进 bundle。

新增模块：

- TypeScript 包：`packages/<名>/`，包名 `@baocut/<名>`，入口 `src/index.ts`。根 `tsconfig.json` 与 `vitest.config.ts` 已按 `packages/*/src` 收录。
- Rust crate：`crates/<名>/`，`version`、`edition`、`license-file`、`publish` 用 `workspace = true` 继承；要被其他 crate 依赖时，在根 `Cargo.toml` 的 `[workspace.dependencies]` 登记路径。workspace 的 members 是通配符，不用改。

## 3. 命名

- **文件与目录一律 lowercase-dashed**：全小写，单词之间用 `-`。React 组件文件也一样：`media-panel.tsx` 导出 `MediaPanel`。CSS、Markdown 文档、脚本同理。
- **名字一一对应**：目录名就是包名或 crate 名。`packages/runtime-core` 是 `@baocut/runtime-core`；`crates/render-graph` 是 crate `render-graph`（Rust 代码里写作 `render_graph`）。
- **测试文件**：TypeScript 用 `<被测文件名>.test.ts`；Rust 集成测试按测的行为命名（`tests/time_model.rs`）。
- **代码标识符**照各语言惯例：TypeScript 的类型与组件用 PascalCase，函数与变量用 camelCase；Rust 按 rustfmt 与 clippy 的默认风格。
- **内部命名用英文**：变量、函数、类型、对象键，以及供代码引用的枚举值、分类值、状态、错误码与基准结果键必须用稳定的英文标识；给人看的名称与说明分开存放，按 §5 处理。控制逻辑按标识或结构化错误类型判断，不匹配中文或其他本地化文案。语言处理词表、解析关键词、语言自称、用户内容与第三方原始数据保持原样。
- **术语**：同一概念只用一个词，见[术语表](glossary.md)。

例外：

- Rust 的模块文件与测试文件用 snake_case（`time_model.rs`），这是语言规则；crate 目录与 crate 名仍用短横线。
- 工具规定的文件名照原样：`README.md`、`AGENTS.md`、`Cargo.toml`、`Cargo.lock`、`package.json`、`tsconfig.json`、`*.config.ts`、`*.d.ts`。
- `designs/` 是原型，沿用它自己的约定。

## 4. 界面图标

视觉规则以[产品设计 §2.1](product/product-design.md#图标尺寸与语义)为准，原型和 Electron 同步实现：只有应用 Rail（与图标块）20px；Rail 以外的正文、页面侧栏（含新建会话）、菜单与弹层的 workflow 图标一律 16px。标题栏的外壳图标（侧栏开关、标签页、完整视图、会话摘要）按产品设计 §2.1 取 S2 原件，或用 S2 的 20 格画法（1.5px 线宽、展开面板图标的方形外框）自绘，显示 16px，居中放在 32px 方块按钮里；原型的图形在 `designs/baocut/assets/shell/`（来源记在同目录 `provenance.json`），Electron 与 Web 用 `packages/ui/src/components/shell-icons/` 里逐字节相同的一份（原型的 `icon-sync.test.js` 核对），由 `shell-icons.tsx` 当 CSS 遮罩渲染。新建会话用 S2 `AddCircle`，Space 入口用 `Asset`。

- Electron 的公共 UI 在 `packages/ui`。`src/app.css` 按 workflow 图标的特征（`role="img"`、20 × 20 viewBox）把 Rail 以外的图标统一成 16px，不用逐个容器声明；Rail 与图标块在容器上标 `data-bc-icons="primary"`（20px），要保留自身尺寸的 UI 图形、大图形与类型预览在图标或容器上标 `data-bc-icons="own"`。弹层通过 portal 渲染时，标记写在实际内容容器上。
- 原型使用同名 token（源在 `designs/baocut/_ds/adobe-spectrum-2/tokens/artboard-tokens.css`），组件范围集中在 `app/spectrum.css`，更新后重建原型生成物。
- 不依赖 S2 的哈希 class，不用文字字号推导 workflow 图标大小，不逐页面添加 18px、21px 等新档位。工作区标签类型图标也固定 16px。
- 图标画布与按钮点击区域分开。UI 箭头、复选标记、插画、缩略图和视频内容不套 workflow 尺寸；保持原始路径与 viewBox。
- 改尺寸后同时检查原型和 Electron 的 Home、Space、设置；测量 SVG 的实际宽高，并检查新建入口、菜单、列表、弹层和键盘焦点。

## 5. 文案与多语言

给人看的文字（界面、Runtime 发出的错误与任务说明、CLI 输出、桌面端菜单与对话框）不写死在代码里，按当前语言取。出货语言见 `@baocut/protocol` 的 `LOCALES`（顺序就是设置 › 通用里语言列表的顺序）；英文是缺省与兜底。系统语言按主语言对应出货语言：中文按文字与地区分简繁（`Hant`、台湾、香港、澳门归繁体），葡萄牙语都归 `pt-BR`。语言偏好的存放见[架构设计 §5.10](architecture/architecture-design.md#510-偏好设置)，用词见[术语表](glossary.md#界面英文用词)。

- **界面文案目录**：一个模块一个 `<模块>-copy.ts`，英文写在里面并用 `defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, … })` 导出；译文放同目录的 `<模块>-copy.<语言>.ts`（导出名是语言代码的驼峰写法：`zhHans`、`zhHant`、`ja`、`ptBR`），`import type` 英文目录的类型标注，缺键、多键、缺一种出货语言都是类型错误。新增语言就是给每个目录新增 `*.<语言>.ts`、接到 `defineMessages` / `defineCatalog` 并登记到 `LOCALES`。测试里的临时目录用 `partialTranslations({ 'zh-Hans': … })`，缺的语言运行期回退英文。参考 `packages/ui/src/components/settings/general-settings-copy.ts`。
- **在用的时候读**：目录对象每次读属性取当前语言，渲染或调用时读（`M.title`、`M.count(n)`）；不要在模块顶层把它读进常量、默认参数或存进 store。要保留旧的具名导出时用 `live(() => M.x)`；对象字面量里引用别的目录用 getter。
- **语序与单复数**：带变量的句子写成函数条目，由各语言自己拼，不在调用方拼接片段；有多种复数形式的语言用 `pluralForm('<语言>', n, { one, few, many, other })`（按 `Intl.PluralRules` 挑词形）；数字、日期、排序用 `Intl.*` 与 `localeCompare(…, intlLocale())`。
- **Runtime 文字**：Runtime 发出、会落盘或过线的文字用 `defineCatalog('<区域>', en, { 'zh-Hans': zh })` 生成 `Localized`（文本 + 引用）。目录放 `packages/protocol/src/messages/<包>/`，在该目录的 `index.ts` 登记，界面与 CLI 才能重新生成。带文字的字段 `foo` 旁边放 `fooRef?: MessageRef`，存盘与过线都带上；界面显示用 `localizeText(foo, fooRef)`。错误用 `new RpcError(code, M.x({...}))`，引用随 `messageRef` 过线。第三方原话、文件名作为字符串参数原样传。
- **Rust 文字**：Worker 与引擎给人看的文字用 `message-ref` crate 的 `msg!("<区域>.<名字>", "英文模板 {参数}", 参数…)`，得到英文缺省文字与引用（`Text`），错误体里放 `messageRef`；译文只在 `packages/protocol/src/messages/<crate>/` 的目录里，英文条目与 Rust 模板一字不差。`node tools/rust-messages.mjs` 列出全部键，`tools/rust-messages.test.ts` 核对登记、英文与参数。语言处理规则（标点、断行）与开发者日志不走目录。
- **不翻译的**：给模型的提示词与工具说明、解析用的关键词、语言的自称、用户与模型写出的内容。这些行标 `// i18n-ignore: <理由>`（作用于本行与下一行），成段的用 `i18n-ignore-start` / `i18n-ignore-end`，整个文件在前 20 行写 `i18n-ignore-file`。
- **检查**：`node tools/i18n-scan.mjs [路径…]` 列出代码、字符串与 JSX 里还没进目录的中文（注释、正则、测试与译文文件不算），测试套件里有同一道门。测试默认在 `BAOCUT_LOCALE=zh-Hans` 下跑（`vitest.config.ts`），既有的中文断言照旧；测英文用 `vi.stubEnv('BAOCUT_LOCALE', 'en')` 再 `setLocale`。

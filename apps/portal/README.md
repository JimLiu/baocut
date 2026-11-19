# apps/portal

BaoCut 官网 [baocut.com](https://baocut.com)：一个静态单页（英文在 `/`，简体中文在 `/zh-hans/`），由 Cloudflare Worker 托管。Worker 负责首页按语言跳转、把页面里的版本号换成 GitHub Releases 上的最新版本、把 `/download/*` 跳到对应的安装包，并在 `/releases/download/*` 提供安装包的镜像（文件在 R2，见[安装包镜像](#安装包镜像)）。

它与桌面应用无关：不进 workspace 之外的任何构建，也不被别的包引用。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/site/site-copy.ts` | 英文文案与 `SiteCopy` 类型；产品说法以根 README 为准 |
| `src/site/site-copy.zh-Hans.ts` | 简体中文文案，`import type` 英文类型，缺键、多键都是类型错误 |
| `src/site/page.ts` | 页面 HTML（`renderPage`、`renderNotFound`） |
| `src/site/site.css`、`client.ts` | 样式与浏览器脚本；脚本只做增强，没有它页面照样能读、能下载 |
| `src/site/build.ts` | 生成 `dist/`（见文件头注释） |
| `src/release.ts` | 读 GitHub Releases（线上）与桌面端更新源（构建快照），推出各安装包的下载地址，构建与 Worker 共用 |
| `src/mirror.ts` | 安装包镜像：从 R2 返回文件（支持 Range），没有就跳回 GitHub；定时任务把最近的 Release 复制进 R2 |
| `src/worker.ts` | Worker 入口 |
| `screenshots/` | 页面用的应用截图，命名 `<名字>[.<语言>]-<宽>x<高>.webp`，名字见 `page.ts` 的 `SHOT_NAMES`（`editor`、`translate`、`space`、`home`、`models`） |
| `public/` | 原样复制的文件：图标、分享图 `og.png`（英文，其他语言缺省用它）与 `og.zh-hans.png`，1200×630 |
| `wrangler.jsonc` | Worker 名 `baocut-portal`、静态资源、自定义域名、R2 绑定（`RELEASES` → `baocut-portal-releases`）与定时任务 |

## 运行与构建

```bash
npm run build -w @baocut/portal   # 只生成 dist/
npm run dev -w @baocut/portal     # 生成后用 wrangler dev 起本地 Worker（默认 http://localhost:8787）
```

`.claude/launch.json` 里的 `portal` 配置做的就是第二条。wrangler 用 `npx` 按固定版本临时取，不进 lockfile。

## 部署

```bash
npx --yes wrangler@4.144.0 login     # 第一次
npx --yes wrangler@4.144.0 r2 bucket create baocut-portal-releases   # 第一次：安装包镜像的桶
npm run deploy -w @baocut/portal
```

部署会创建或更新 Worker `baocut-portal`，并把 `baocut.com`、`www.baocut.com` 绑成它的自定义域名（`www` 由 Worker 301 到不带 `www` 的地址），绑定 R2 桶 `baocut-portal-releases`、登记每 10 分钟一次的定时任务。不需要 D1 或 KV。账号里有多个 Cloudflare 账户时，命令前加 `CLOUDFLARE_ACCOUNT_ID=<官网所在的账户>`。

可选：给 Worker 设一个 GitHub token，读 Release 列表的额度从每个出口 IP 每小时 60 次（Cloudflare 的出口 IP 与别人共用，可能被别人用光）变成这个 token 的 5000 次。用 fine-grained token 即可：Repository access 选 Public repositories（只读），不用加任何权限。

```bash
npx --yes wrangler@4.144.0 secret put GITHUB_TOKEN --config apps/portal/wrangler.jsonc
```

没设或额度用完时 Worker 照常工作，只是继续用手上的那份版本，直到下次取到为止。

同一个 Cloudflare 账号里的 `baocut-site`（baocut.app：遥测、下载与更新源）、`baocut-cdn`、`baocut-release-pointers`、R2 `baocut-downloads` 与 D1 `baocut-analytics` 和官网无关，不要改它们，也不要把官网部署成这些名字；镜像用自己的桶 `baocut-portal-releases`。

## 下载地址从哪来

- 线上以 GitHub Releases 为准：Worker 读最近 5 个 Release（`api.github.com/repos/jimliu/baocut/releases`），只认 `baocut-v<版本>-build.<构建号>` 的 tag，跳过草稿与预发布。GitHub 上标成 Latest 的可能是历史上的 Skill 发布，不用它。
- 四个平台变体（macOS、Windows CPU / CUDA / Vulkan）各取「安装包与 ZIP 都已传完」的最新一次发布：macOS 先发布、Windows 之后才追加进同一个 Release，追加完之前 Windows 仍指向上一版，不会给出 404 的链接。文件地址必须就是本仓库这次发布目录下的同名文件。
- 构建时把 `apps/desktop/releases/*.json`（桌面端的更新源）写进 `dist/release.json` 当快照，页面里的版本号也先按它写好；GitHub 取不到、或最近 5 个 Release 里没有某个平台时用它。两边逐个平台取构建号大的那份，所以发版后不用重新部署。
- 访客的请求不等 GitHub：Worker 依次用本实例内存里的、本机房缓存（Cache API，存整理好的结果）里的、构建快照，超过 5 分钟就在响应之后到后台重取。发版后官网一般 5 分钟左右跟上；一个机房第一次被访问时先给快照，后台取到后才换成最新的。GitHub 出错或限流时继续用手上这份，5 分钟后再试。
- 给访客的下载地址（`/download/<下载项>` 跳去的、`/api/release` 列的）是镜像上的同一路径 `https://baocut.com/releases/download/<tag>/<文件>`；镜像上还没有时它再跳到 GitHub。
- `/api/release` 返回最新版本与各下载地址的 JSON。
- 每次到 GitHub 重取都记一条 `github-releases` 日志：`status`、`limit` / `remaining`（额度上限与剩余；`limit` 为 5000 说明 token 生效，60 说明没带上）、`token`（有没有设，不含值）与各平台取到的构建号；失败时记 `console.warn`。在 Cloudflare 控制台的 Workers Logs 里查，或实时看：`npx --yes wrangler@4.144.0 tail --config apps/portal/wrangler.jsonc --format pretty`。

## 安装包镜像

GitHub Releases 的下载在一些网络里很慢（见 [issue #141](https://github.com/JimLiu/baocut/issues/141)），官网在 Cloudflare 上放一份副本。GitHub 仍是唯一的来源，镜像只复制、不改。

- **地址**：`https://baocut.com/releases/download/<tag>/<文件>`，路径与 `https://github.com/jimliu/baocut/releases/download/<tag>/<文件>` 相同。只认 `baocut-v<版本>-build.<构建号>` 的 tag 与带同一版本、构建号的 `BaoCut-…`、`BaoCut-CLI-…` 的 `.zip`、`.dmg`、`.exe`，别的路径 404。
- **读**：R2 里有就直接给，支持 `Range`（应用的断点续传）、`HEAD`、`If-None-Match` 与 `If-Range`，响应 `Cache-Control: immutable`。没有（还没复制、已经清掉、没绑 R2、R2 出错）就 302 到 GitHub 上的同名文件，所以更新源在发布当时就可以写镜像地址。
- **写**：定时任务每 10 分钟读一次最近 5 个 Release，取构建号最大的两个已发布 Release，把其中已传完的上述文件复制进 R2（`<tag>/<文件>`），按 GitHub 的大小与 `digest`（sha256）由 R2 校验，传一半不会留下对象；然后删掉不属于这两个 Release 的对象。每次最多花 8 分钟开始新的复制，剩下的下一次接着做。GitHub 读不到时什么都不删。macOS 先发布、Windows 后追加：各自的文件在出现后的下一轮复制。
- **日志**：每次定时任务记一条 `mirror` 日志（复制了哪些、已有几个、推迟、失败与删掉的），读到没镜像的文件时不记。查法同上面的 `github-releases`。
- **核对**：发布后 10 分钟左右，`curl -sI https://baocut.com/releases/download/<tag>/<文件>` 应是 200 且带 `Accept-Ranges: bytes`；还是 302 就看 `mirror` 日志里的 `failed`。

## 截图与模板预览

- 截图是真实的应用界面：用一次性的 Runtime 加 Web 客户端（与用户自己的 Runtime 隔离），项目里只放 BaoCut 模板的预览视频，再用无头 Chrome 以 2 倍像素比截取，转成 WebP（`cwebp -q 82`，每张出 1400 与 2800 两个宽度）。不要放第三方视频、真人画面或别人的作品。
- 截图里的标题栏要和 macOS 桌面版一样：Web 客户端没有红绿灯，截之前在页面里把标题栏左边距改成桌面版的 84px，并在左上角画出红黄绿三个按钮；网站不再另外套一层窗口标题栏。
- 某种语言要用自己的截图时，加 `<名字>.<语言小写>-…webp`（如 `editor.zh-hans-1400x875.webp`）；没有就用不带语言的那组。
- 模板展示直接取仓库 `templates/` 里带预览的模板（封面与预览都是 BaoCut 导出的成片），顺序见 `build.ts` 的 `SHOWCASE_ORDER`，标题与简介按页面语言取模板自己的译文。

## 语言

英文是缺省语言。简体中文浏览器（`Accept-Language` 权重最高的是 `zh`、`zh-Hans`、`zh-CN`、`zh-SG`、`zh-MY`）第一次打开 `/` 时跳到 `/zh-hans/`；语言切换链接带 `?lang=`，Worker 把选择记进 `baocut_lang` cookie，之后照选的来。爬虫不跳。

新增一种语言：写 `src/site/site-copy.<语言>.ts`，加进 `build.ts` 的 `LOCALES`，在 `wrangler.jsonc` 的 `run_worker_first` 加上它的路径，并在 `worker.ts` 的 `LANGUAGES` 与跳转规则里登记。

## 验证

```bash
npx vitest run apps/portal
npm run typecheck
```

改页面后在 `npm run dev -w @baocut/portal` 起的本地 Worker 里看桌面与手机宽度，并核对 `/`、`/zh-hans/`、`/download/<下载项>`、`/api/release` 的跳转与返回。

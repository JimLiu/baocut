# CLI 独立使用与发布：不开桌面端也能用，以及独立 CLI 包

> 方案稿，2026-11-08，未实现。目标：装了 BaoCut 的机器上，人和外部 Agent 在终端里直接用 `baocut` 完成 Agent 面的全部能力，不需要打开桌面窗口；同一个 Runtime Home 上无论谁先拉起 Runtime，行为都一样；再把 CLI 与 Runtime 打成独立包，与 App 同版本发布。
>
> 本文延伸 [Agent 面设计](agent-surface-design.md) 的 §5.6（Runtime 的归属）与 §8.2（放哪里），CLI 拉起 Runtime 的机制以[架构设计 §2.2](../../architecture/architecture-design.md#22-启动所有权与退出) 为准，这里只写要改的部分。制作流程的产品化（生产脚本编排、旁白片段剪裁、字幕断条等）不在本文。

## 目录

1. [问题与目标](#1-问题与目标)
2. [已定事项](#2-已定事项)
3. [命令行入口与 PATH](#3-命令行入口与-path)
4. [同一个 Home 上的两份安装](#4-同一个-home-上的两份安装)
5. [CLI 拉起的 Runtime 与桌面端一致](#5-cli-拉起的-runtime-与桌面端一致)
6. [不靠桌面端的长期服务](#6-不靠桌面端的长期服务)
7. [源码 Runtime 与隔离 Home](#7-源码-runtime-与隔离-home)
8. [诊断与文案](#8-诊断与文案)
9. [独立 CLI 包](#9-独立-cli-包)
10. [参考：ChatGPT 与 Claude Desktop](#10-参考chatgpt-与-claude-desktop)
11. [要修订的规范条目](#11-要修订的规范条目)
12. [实施顺序与验收](#12-实施顺序与验收)
13. [待实测事项](#13-待实测事项)

---

## 1. 问题与目标

### 1.1 现状

CLI 已经能在后台无窗口地拉起正式版 Runtime：默认 Home `~/.baocut` 上找不到 Runtime 时，它以 `ELECTRON_RUN_AS_NODE=1` 运行 `BaoCut.app` 里的 `runtime.js --credential-store keychain`，带上打包资源，空闲满 `runtime.idleExitMinutes` 后自己退出（`apps/cli/src/runtime/connection.ts` 的 `resolveRuntimeLaunch`、`launchRuntime`）。Runtime 只借 Electron 当 Node 用，代码里不引用 `electron`；原生程序、模板、skill 与网页编辑器都按 `packagedResourceEnv` 给的环境变量找路径。

即便如此，用户和 Agent 仍会被引回桌面端，原因在下面几处：

| 缺口 | 现在的行为 | 位置 |
| --- | --- | --- |
| 终端里没有 `baocut` | App 不往 PATH 写文件，只给出要 sudo 的 `/usr/local/bin` 软链接命令 | Agent 面设计 §8.2；`apps/cli/src/admin/skill.ts` |
| 谁先拉起 Runtime，结果就不一样 | 默认 Home 上，CLI 拉起的 Runtime 把新视频放进 `~/.baocut/projects`，桌面端拉起的放进 `~/BaoCut`；CLI 拉起的不知道系统的下载、文稿文件夹与系统语言 | `resolveRuntimeHome`（`packages/runtime-storage/src/home.ts`）；`RuntimeSupervisor.#spawn` 传而 CLI 的 `spawnRuntime` 不传的环境变量 |
| 存活判断两套 | 桌面端按开机时间加端点是否拒绝连接判断发现文件，CLI 只按开机时间 | `isDiscoveryLive`（`packages/runtime-storage/src/discovery.ts`）与 CLI 的 `findRuntime`；架构设计 §2.2 |
| 版本不同照样复用 | 桌面端找到 CLI 拉起的 Runtime 就连上，不比版本；只有协议版本不同时界面报「不兼容」 | `RuntimeSupervisor.#discover` |
| 只走 MCP 的宿主起不了 Runtime | `baocut mcp install` 只写 HTTP 地址与令牌，Runtime 不在时宿主连不上 | `apps/cli/src/admin/agent-hosts.ts` |
| 源码 Runtime 读不到已配好的密钥 | 隔离 Home 上的源码 Runtime 只用文件存储，钥匙串里的密钥用不了 | Agent 面设计 §5.6 |
| 报错把人往桌面端引 | `RUNTIME_START_FAILED` 时 skill 请用户打开桌面端；完全磁盘访问的指导只说下载卡片上的按钮 | `skills/baocut/references/start.md` 第 5 节；`packages/runtime-core/src/agent-tools/job-tools.ts` |

### 1.2 目标

- 只装了 App、从不打开窗口的用户，在终端里输入 `baocut` 就能用，外部 Agent 经 CLI 或 MCP 都能自己拉起 Runtime。
- 同一个 Home 上，CLI 拉起与桌面端拉起的 Runtime 用同样的项目目录、主机文件夹、系统语言与凭据。
- 两份不同版本的安装共用一个 Home 时，有确定的复用与替换规则，报错说清哪一边要更新。
- 开发者在隔离 Home 上跑源码 Runtime 时，可以只读地用默认 Home 里配好的账号，不碰真实数据。
- 把 CLI 与 Runtime 打成不带 Electron 的独立包，第一版 macOS 与 Windows，与 App 同一次构建、同一个版本号发布（§9）。

### 1.3 不做

- Linux 与服务器部署：Rust 媒体后端只有 macOS 与 Windows（§9.8）。
- 应用商店版本：架构设计 §2.6 已排除。
- 制作流程的命令化，另行设计。

## 2. 已定事项

2026-11-08 由用户拍板。第 4–10 条是方案稿评审时用户同意按建议定下的：

| # | 决定 | 落在 |
| --- | --- | --- |
| 1 | 放宽 Agent 面设计 §5.6：源码 Runtime 在隔离 Home 上可以用钥匙串里已有的密钥 | §7.1 |
| 2 | App 可以写 `~/.local/bin/baocut`，取代 §8.2「不替用户往系统 PATH 写文件」 | §3.2 |
| 3 | 退出规则不变：桌面端拉起的 Runtime 随桌面端退出（有活时照架构设计 §2.2 的退出对话框）；CLI 拉起的不停 | 现有代码已如此：`RuntimeSupervisor.stop` 只停自己的子进程 |
| 4 | 做独立 CLI 包，第一版 macOS 与 Windows，与 App 同一次构建、同一个版本号同时发布 | §9 |
| 5 | Windows 的 PATH：在 `%LOCALAPPDATA%\BaoCut\bin\` 放转发用的 `baocut.cmd`，把这个目录加进用户 PATH | §3.2 |
| 6 | Homebrew cask 放 BaoCut 自己的 tap | §3.3 |
| 7 | 桌面端碰到忙着的旧版 CLI Runtime 只等它做完，不给「现在停止它」 | §4.2 |
| 8 | 第一版不做开机常驻 | §6.2 |
| 9 | 项目目录改规则，不迁移已有的视频 | §5.1 |
| 10 | 钥匙串先用同一签名标识的助手，实测不行再换访问组外壳 | §9.6 |

第 3 条之下可以加一句提示：桌面端退出、停下自己的 Runtime 时，如果还有 CLI 连接，退出对话框说明这些连接会断开、下一条命令会在后台重新拉起 Runtime。

## 3. 命令行入口与 PATH

### 3.1 入口

入口不变：macOS 是 `BaoCut.app/Contents/MacOS/baocut-cli`（C 启动器，解析软链接后以包内 Electron 跑 `cli.js`），Windows 是安装目录里的 `baocut.cmd`（[桌面端 README「外部 Agent 与 CLI」](../../../apps/desktop/README.md#外部-agent-与-cli)）。本节只管怎么让终端找到它。

### 3.2 安装到 PATH

- **位置**：macOS 在 `~/.local/bin/baocut` 放软链接，指向 App 的 `baocut-cli`。目录不在时建，不要 sudo。
- **已有文件**：`~/.local/bin/baocut` 是指向某个 BaoCut 入口的软链接时改指向；是别的文件或指向别处的链接时不覆盖，报 `foreign`（同 Agent 面设计 §8.2 的规则）。指向独立 CLI 包（§9）的链接 App 不改：那是用户专门装的命令行。
- **PATH 检查**：装完以用户的登录交互 shell 检查（`$SHELL -ilc 'command -v baocut'`，限时几秒）。`~/.local/bin` 不在 PATH 上时给出要加进 shell 配置的那一行，不替用户改 shell 配置文件。
- **状态**：`none`、`current`（指向本 App 的入口）、`stale`（指向另一份 BaoCut 入口，例如移动前的 App）、`broken`（指向的位置不在了）、`foreign`。App 每次启动检查自己装过的链接，`stale` 或 `broken` 时改指向自己；`foreign` 永不改动。
- **入口**：规则放在 Runtime 里，App 与 CLI 共用，Web 只看状态（写用户主目录只在桌面界面与 CLI 里做），与 `agentSkill.*` 的分工相同。协议方法 `cliEntry.status|install|remove`（命令与协议规范 §4.1），CLI 是管理桶的 `baocut cli install|status|remove`；App 在 Skills 页「在终端或其他应用的 Agent 里使用 BaoCut」卡片里加「安装命令行工具」。Runtime 经已有的 `BAOCUT_CLI_ENTRY` 知道 App 入口的位置。
- **Windows**：在 `%LOCALAPPDATA%\BaoCut\bin\` 放一个 `baocut.cmd`，转发到 App 安装目录里的 `baocut.cmd`（装了独立包时转发到它的当前版本，§9.3），再把这个目录加进用户 PATH（`HKCU\Environment` 的 `Path`，改完广播 `WM_SETTINGCHANGE`），不要管理员权限。这个目录只放这一个文件；状态与 macOS 相同，`foreign` 指那里的 `baocut.cmd` 不是 BaoCut 写的转发脚本。改过的 PATH 只对新开的终端生效，装完提示这一点。

### 3.3 Homebrew cask

- 一个 cask `baocut`，下载与 App 自动更新相同的 GitHub Releases 归档，`binary "#{appdir}/BaoCut.app/Contents/MacOS/baocut-cli", target: "baocut"` 把入口链接进 Homebrew 的 `bin`。
- 带 `auto_updates true`：App 自己更新（架构设计 §2.6），`brew upgrade` 不与它抢。
- cask 与 `~/.local/bin/baocut` 可以同时存在，两者指向同一个 App。
- cask 放在 BaoCut 自己的 tap（GitHub 上的 `homebrew-tap` 仓库），每次发布随 appcast 一起更新版本号与校验和；cask 文件的源放在本仓库，tap 仓库由维护者建。

## 4. 同一个 Home 上的两份安装

一个 Home 同时只有一个 Runtime（实例锁，架构设计 §2.2），谁先拉起两边就共用谁。下面几种情况会让两份不同版本的代码碰到同一个 Home：

- **App 更新之后**：CLI 从旧包拉起的 Runtime 还在跑，App 的安装前屏障（架构设计 §2.6）只管 App 自己拉起的那个。Windows 的安装器会结束安装目录里的全部进程（`app-update-install.ts`），它的收尾被截断；macOS 上它继续以旧版运行，之后起的 Worker 读的可能是新包里的文件（推测）。
- **桌面端复用 CLI 拉起的 Runtime**：`RuntimeSupervisor.#discover` 不比版本。
- **源码 CLI 在默认 Home 上**：用的是装好的 App 的 Runtime（Agent 面设计 §5.6），接口版本不同时已被版本门拒绝。
- **独立 CLI 包与 App 版本不同**（§9）。

### 4.1 发现信息

发现信息已有 `runtimeVersion`、`protocolVersion` 与 `launchedBy`。再加三项，让对方不连接就能判断：

- `interfaceVersion`：工具接口版本（`MCP_INTERFACE_VERSION`），CLI 的版本门比的就是它。
- `build`：构建 commit 的短号，开发构建带未提交改动时加 `-dirty`。
- `entry`：拉起它的那份安装（App 包或独立包的根目录、仓库根目录）。

### 4.2 复用还是替换

谁要用 Runtime（桌面端或 CLI），都先读发现信息再决定：

1. **版本相同**：复用（现状）。桌面端比 `runtimeVersion` 与 `build`；CLI 比 `interfaceVersion`，接口版本相同而 `runtimeVersion` 不同时照样复用。
2. **版本不同，对方是 CLI 拉起的，并且空闲**（没有在用的连接、没有排队或运行中的任务，按 `runtime.status`）：请它停下（`runtime.stop`），等它放开实例锁，再拉起和自己同一份安装的 Runtime。CLI 拉起的 Runtime 本来就会空闲退出，替换它不丢东西。
3. **版本不同，对方忙着或不是 CLI 拉起的**：
   - CLI：接口版本不同时照现有版本门以退出码 3 拒绝；报错里加上对方是谁拉起的、手上有几个任务，以及「它空闲后再运行会自动替换」。
   - 桌面端，协议版本相同：先连上用，界面标出后台 Runtime 的版本与拉起者，与应用版本不同；等它没有任务、也没有别的连接时请它停下，换成自己的。这时 `runtime.stop` 不把发起替换的那条桌面端连接算作在用，其余拒绝条件（`RUNTIME_IN_USE`）不变。
   - 桌面端，协议版本不同：不连；界面说明后台有一个由命令行拉起的旧版 Runtime 正在做 N 个任务，等它做完后自动替换。不给「现在停止它」：`runtime.stop` 在有任务时照旧拒绝。

### 4.3 更新时

App 的「重启并更新」在安装前除了自己的 Runtime，还要处理同一个 Home 上从本包拉起的 CLI Runtime（发现信息的 `entry` 指向本包）：空闲的请它停下；有任务的并进安装屏障的任务数，「等任务结束后安装」也等它。Windows 安装器结束进程之前它已经按架构设计 §2.4 停好。

## 5. CLI 拉起的 Runtime 与桌面端一致

### 5.1 项目目录

`resolveRuntimeHome` 按「环境里有没有 `BAOCUT_HOME`」决定默认项目目录：有就用 `<home>/projects`，没有用 `~/BaoCut`。CLI 拉起 Runtime 时总会传 `BAOCUT_HOME`，桌面端则显式传 `BAOCUT_PROJECTS_DIR`，所以默认 Home 上两边落到不同的目录。

规则改成按 Home 本身判断：Home 是默认的 `~/.baocut` 时项目目录是 `~/BaoCut`，其他 Home 是 `<home>/projects`；`BAOCUT_PROJECTS_DIR` 仍然优先。改在 `resolveRuntimeHome` 一处，桌面端与 CLI 都不用再各自传。已有的视频不迁移：CLI 新建的视频放在 `<项目目录>/CLI`，这个目录登记成项目、按绝对路径记在 `store/projects.json`，视频列表读的是 Space 里登记的项目（`LocalScope.listVideos`），所以 `~/.baocut/projects/CLI` 里的视频改规则后照常可见，新视频进 `~/BaoCut/CLI`。

### 5.2 主机文件夹与系统语言

桌面端拉起 Runtime 时传 `BAOCUT_DOWNLOADS_DIR`、`BAOCUT_DOCUMENTS_DIR`、`BAOCUT_SYSTEM_LANGUAGES`（主进程从系统取得），CLI 不传，Runtime 只能退回 `~/Downloads`、`~/Documents` 与进程的 `LANG`。从 Agent 宿主或登录项拉起的进程可能没有 `LANG`，Windows 的已知文件夹还可能被重定向到 OneDrive。

规则：环境变量没给时，Runtime 自己按平台解析，环境变量只作覆盖。

| 平台 | 下载与文稿文件夹 | 系统语言 |
| --- | --- | --- |
| macOS | `~/Downloads`、`~/Documents` | `AppleLanguages` 全局偏好 |
| Windows | 当前用户的已知文件夹（注册表 `User Shell Folders`，展开环境变量） | 用户的语言列表 |
| Linux | `xdg-user-dir DOWNLOAD` / `DOCUMENTS`，没有时退回主目录下的同名文件夹 | `LANGUAGE`、`LC_ALL`、`LANG` |

解析失败时退回现在的默认值，不阻断启动。按[开发流程 §4.1](../../development-workflow.md#41-跨平台系统集成)在 Windows 与 macOS 上实机核对：同一台机器上 Runtime 自己解析的结果与桌面端传入的一致。

开发态的桌面端还传 `BAOCUT_ALLOWED_ORIGINS`（Vite 的地址）。开发态桌面端复用的 Runtime 不接受自己的 origin 时，按 §4.2 的「版本不同」处理。

### 5.3 存活判断

CLI 照桌面端补上端点检查：发现文件里的 PID 还在、记录不早于这次开机，并且端点没有拒绝连接，才算在跑。CLI 只依赖 client 与 protocol（[架构设计 §13.1](../../architecture/architecture-design.md#131-目标目录)），不引入 `runtime-storage`：沿用 `isRecordedProcessAlive` 与 `packagedResourceEnv` 的做法，在 `connection.ts` 里写一份，测试核对与 `isDiscoveryLive` 一致。

## 6. 不靠桌面端的长期服务

CLI 拉起的 Runtime 在有在用的连接、任务或开着的对外服务（Web、MCP）时不空闲退出（`RuntimeActivity`），所以 Web 服务开着时审片链接一直能用。剩下两处缺口：只走 MCP 的宿主自己拉不起 Runtime；电脑重启后没有谁去拉起 Runtime，审片链接与 HTTP 形式的 MCP 要等下一条 CLI 命令。

### 6.1 MCP stdio

- `baocut mcp serve --stdio`：宿主把它当作 stdio 形式的 MCP 服务器拉起。它按 CLI 的规则找到或拉起 Runtime（§4 同样适用），把 stdio 上的 JSON-RPC 转发给 Runtime 的 MCP 端点；开放清单与权限与 HTTP 形式相同（Agent 面设计 §3、§6）。
- 转发期间算一条在用的 CLI 连接，Runtime 不空闲退出。Runtime 中途退出时重新找或拉起一次，正在进行的请求以错误返回，不重放。
- `baocut mcp install` 默认写 stdio 形式（命令加参数）。命令写 `~/.local/bin/baocut`（装了的话），否则写入口的完整路径；宿主不支持 stdio 时才写 HTTP 地址与令牌。

### 6.2 开机常驻（第一版不做）

第一版不做：有了 §6.1，MCP 宿主自己会拉起 Runtime；审片链接在 Web 服务开着时一直可用，重启电脑后跑一次 `baocut web review` 就恢复。以后要做时按下面的做法：

- `baocut runtime ensure --keep-alive`：拉起的 Runtime 不空闲退出，直到 `runtime stop`；已有 CLI 拉起的 Runtime 在跑时把它改成常驻。
- macOS 可选装一个 launchd 用户代理，登录时运行 `baocut runtime ensure --keep-alive`；Windows 用当前用户的登录启动项。这是持久配置，只在用户在 CLI 或设置里明确开启时装，`--keep-alive` 关掉时一并移除。

## 7. 源码 Runtime 与隔离 Home

### 7.1 只读链接账号

现状：钥匙串条目不分 Runtime Home（service `com.baocut.runtime`，account `provider:<providerId>/<accountId>`，[架构设计 §6.8](../../architecture/architecture-design.md#68-模型服务配置)），账号列表在各 Home 的 `store/model-services.json`；隔离 Home 上的源码 Runtime 用文件存储。

不让源码 Runtime 整个改用钥匙串后端：钥匙串后端启动时会把文件里遗留的凭据迁进钥匙串，隔离 Home 里的开发密钥会覆盖真实的同名条目；在隔离 Home 里移除账号会删掉真实的密钥；仓库里 cargo 编出的 `credential-helper` 每次重编签名都变，钥匙串可能反复弹窗（推测）。

做法是只读链接：

- **链接**：`baocut models accounts link --from <home> [--provider <id>] [--account <accountId>]`（管理桶，先征得用户同意）。把来源 Home 里账号的描述（providerId、accountId、label、掩码、启用）登记进本 Home，标上 `linked: { home }`，不抄密钥。来源 Home 必须用钥匙串后端（通常是 `~/.baocut`），否则以 `LINK_SOURCE_UNSUPPORTED` 拒绝。链接时说明：调用用的是用户真实的账号，照常计费。
- **读密钥**：本 Home 自己的账号仍走文件存储；链接账号的密钥只读地经正式版 App 里签过名的 `credential-helper` 从钥匙串取，只用 `get` 与 `has`。源码 CLI 拉起源码 Runtime 时找到装好的 App，就把 `BAOCUT_CREDENTIAL_HELPER` 指向它的助手；找不到时链接账号报不可用（`missing-credential`，detail 说明缺正式版的助手）。
- **写与删**：改链接账号的密钥以 `conflict` 拒绝（`details.code: 'ACCOUNT_LINKED'`），要在来源 Home 里改。`models.removeAccount` 对链接账号只删本 Home 里的登记，不碰钥匙串。钥匙串迁移不涉及链接账号。
- **跟着来源走**：每次读配置时按来源 Home 刷新链接账号的掩码与启用状态；来源里这个账号不在了，或钥匙串里读到 `not-found`，报 `missing-credential` 并写明链接来源。
- **Windows**：Credential Manager 不按程序区分，同样只读地取。

Agent 面设计 §5.6 的另一半不变：从仓库运行的 CLI 在默认 Home 上仍用装好的 App 的 Runtime，开发中的代码不碰默认 Home。

### 7.2 隔离 Home 的搭建

源码 CLI 在非默认 Home 上会自己拉起仓库里的 Runtime，`engine-host` 与 web 构建也会回退到仓库的构建产物，只设 `BAOCUT_HOME` 就够。可以加 `baocut sandbox create <目录> [--link-accounts-from <home>]`：建 Home 与项目目录，写一份 `env.sh` / `env.ps1`，按需链接账号，打印怎么用。

### 7.3 源码 Runtime 的 Node

`resolveRuntimeLaunch` 用当前进程的 Node 直接跑 `apps/runtime/src/main.ts`。当前 Node 不带旗标时不去掉类型标注（`process.features.typescript` 为假，或它为真只是因为 CLI 自己带了 `--experimental-strip-types`）时补这个旗标；Node 版本不在仓库 `package.json` 的 `engines.node` 范围里时不拉起，以 `RUNTIME_START_FAILED` 报出要哪个版本（`checkRuntimeNode`），不留一行 `ERR_UNKNOWN_FILE_EXTENSION` 在 `cli-runtime.log` 里。

### 7.4 构建是否过期

源码 Runtime 不比对 web 构建、`preview.wasm` 与各 Worker 的版本（`web-static.ts`、`findBundledBinary`），源码比它们新时审片页只提示画不出来。规则：

- web 构建与各 Worker 记下协议版本与构建 commit。
- `baocut version` 报出它们各自的构建；源码 Runtime 发现与源码不一致时在 `version` 与 `status` 里警告，并给出重建命令。
- 审片页因为 web 构建过期画不出时，提示写明原因。

## 8. 诊断与文案

### 8.1 `baocut doctor`

只读，不拉起 Runtime 也能回答，不用先征得同意。逐项给出 `ok` / `warn` / `fail` 与补救命令，信封同 `baocut status`：

- **入口**：终端里的 `baocut` 指向哪里，与 App 是否同一版本，PATH 状态（§3.2）。
- **Runtime**：会用哪个入口拉起（`resolveRuntimeLaunch` 的结果）、哪个 Home、哪个项目目录、哪种凭据后端；正在跑的那个的版本与拉起者。
- **凭据**：后端可用吗。钥匙串经助手对一个不存在的键做一次 `has`，不读任何密钥；SSH 等没有图形会话的环境里钥匙串可能拒绝访问（`denied`），给出说明。
- **完全磁盘访问**：`runtime.access` 的结果；缺失时说明系统会算在谁头上（App 拉起时是 BaoCut.app，从终端拉起时可能是终端，见架构设计 §12.11）与系统设置里的位置。
- **构建**（开发态）：§7.4 的各项。原生程序与数据的位置复用 Runtime 的 `--self-check --probe`。

`status` 回答这台机器能做什么，`doctor` 回答为什么起不来、为什么读不到。

### 8.2 文案

改的是 i18n 目录里的文案与给模型的英文指导，规则见[仓库约定 §5](../../repo-conventions.md#5-文案与多语言)：

- `RUNTIME_UNAVAILABLE`（`--no-start` 时）的 `next` 写明会用哪个入口、哪个 Home、哪种凭据后端拉起。
- `RUNTIME_START_FAILED` 给出日志路径与末尾几行（已有），并建议 `baocut doctor`。`start.md` 第 5 节改成先跑 `doctor`；只有 `doctor` 指向只能在桌面端做的事时才请用户打开桌面端。
- 要授权与密钥无效的补救先给 CLI 命令（`baocut grants …`、`baocut models configure`，密钥由用户自己输入），再提桌面端的设置。
- `job-tools.ts` 里完全磁盘访问的指导加上命令行下的说法：告诉用户系统设置里的位置与要打开的应用，授权后用 `baocut doctor` 复查。不让 Agent 自己去开系统设置的规定不变。

## 9. 独立 CLI 包

已定要做（§2 第 4 条），排在 §4 与 §6.1 之后：不然只装独立包的用户会碰到 MCP 宿主拉不起 Runtime，与 App 版本不同时也没有确定的规则。第一版 macOS 与 Windows，与 App 同一次构建、同一个版本号同时发布。

### 9.1 内容

独立包是同一次构建多出的一个产物：Node 可执行文件、`cli.js` 与 `runtime.js`、`bin/` 下的原生程序、资源目录（模板、贴纸、skill、模型资源、web 与各编辑器），不带 Electron 与桌面界面。Node 的大版本与 App 里 Electron 自带的一致，并且有 `node:sqlite`。资源仍按 `packagedResourceEnv` 的环境变量找，独立包的启动器设置它们。

### 9.2 大小

BaoCut 3.16.4 安装后 748 MB，实测各部分：

| 部分 | 大小 | 独立包 |
| --- | --- | --- |
| Electron（`Frameworks`） | 252 MB | 去掉，换成 Node（本机 Node 26 可执行文件 147 MB） |
| 原生程序（`bin/`） | 309 MB：`mlx.metallib` 102、`audiocpp` 80、`export-worker` 26、`model-worker` 25、`matte` 25、`face-detect` 25、`engine-host` 15、`speech-worker` 10、`credential-helper` 0.7 | 保留 |
| web 与编辑器 | 约 112 MB：web 66、docs 18、slides 13、design 12、design-system 2.8 | 保留（`web open`、`web review` 要用） |
| `app.asar` | 54 MB | 换成 `cli.js`、`runtime.js` 与依赖 |
| 模板、skill、贴纸、模型资源 | 约 20 MB | 保留 |

只换掉 Electron，独立包仍有约 600 MB。要明显变小，得把本机模型相关的程序（`model-worker` 加 `mlx.metallib`、`audiocpp`、`matte`、`face-detect`、`speech-worker`，约 270 MB）改成按需下载（§9.7）。

### 9.3 安装布局

- macOS 与 Windows 都装在用户目录：`~/.local/share/baocut/versions/<版本>/`（Windows 是 `%LOCALAPPDATA%\BaoCut\cli\versions\<版本>\`），`~/.local/bin/baocut` 软链接指向当前版本的启动器（Windows 放一个转发到当前版本的 `baocut.cmd`）。
- 更新：下载新版本目录、校验、切换链接，保留上一版用于回滚。还有 Runtime 在用的旧版本不删（按发现信息的 `entry` 判断），没人用的在下一次更新时删掉。
- 与 App 共用 Home `~/.baocut` 与钥匙串条目。

### 9.4 与 App 共存

- `resolveRuntimeLaunch` 现在依次找：`BAOCUT_RUNTIME_ENTRY`、自身所在的 App、非默认 Home 上的仓库、标准安装位置的 App、仓库。独立包的 CLI 不在 App 里，会落到「标准安装位置的 App」，拉起 App 的 Runtime。改成「自身所在的安装（App 或独立包）」排在 env 之后，复用与替换按 §4。
- 两个包同一次构建、同一个版本号一起发布。
- PATH 上的 `baocut` 由独立包管（§3.2）。

### 9.5 更新渠道

- `baocut update`：读与 App 相同的 appcast（`apps/desktop/releases/appcast-*.json`），按平台加一个 CLI 条目；归档同样放在 GitHub Releases。
- Homebrew formula 或 winget / Scoop 只是指向同一归档的安装方式。
- 这与架构设计 §2.6「只有一个分发渠道」的字面冲突，要一起修订：GitHub Releases 是唯一的归档来源，App 与独立包都从这里取（§11）。

### 9.6 签名与钥匙串

- macOS 包里的 Node 与全部原生程序用 Developer ID 签名，整包公证。
- 钥匙串条目的访问控制按程序的签名认人。独立包里的 `credential-helper` 用同一个 Developer ID 与同一个签名标识，推测能直接读 App 存的条目、不弹窗。先按这个做，并实测（§13）。
- 实测不行时改用 ChatGPT 的做法：把 `credential-helper` 包进带描述文件的小 `.app`，用钥匙串访问组，App 与独立包放同一个签好的外壳。访问组属于数据保护钥匙串，现在的 `crates/credential-helper/src/keychain.rs` 用的是传统钥匙串的通用密码条目，换过去要迁移已有条目：先读传统条目、写进数据保护钥匙串，写成功再删旧条目，与[架构设计 §6.8](../../architecture/architecture-design.md#68-模型服务配置) 现有迁移的先写后删相同。
- Windows 的 Credential Manager 不按程序区分。

### 9.7 只有桌面端做过的事

- **完全磁盘访问**：系统按负责进程判定授权（架构设计 §12.11）。从终端拉起时负责进程是终端或 Agent 宿主，用户给 BaoCut 的授权不生效。可以照 Claude Desktop 的 `disclaimer`：CLI 拉起 Runtime 时设置 disclaim 属性，让 Runtime 自己成为负责进程。对 App 里的 Runtime，授权就落在 BaoCut.app；独立包要给 Runtime 一个带身份的 `.app` 外壳，才能在系统设置里以 BaoCut 出现。都要实测（§13）。
- **常驻与审片链接**：靠 §6。
- **按需组件**（之后）：照 Claude Desktop 下载 Claude Code 的办法，放进 `<home>/components/<名字>/<版本>-<sha256 前 12 位>/`，校验后写 `.verified`，保留新旧两版；组件版本跟包版本走，仍是「一个版本一套二进制」（架构设计 §2.6）。`findBundledBinary` 加这个查找位置。

### 9.8 Linux

第一版不做。只有独立 CLI 才可能上服务器与 CI，但 Rust 媒体后端只支持 macOS 与 Windows，crates 里 `target_os = "linux"` 只有 `model-runtime` 的 3 处。要另立项目。

## 10. 参考：ChatGPT 与 Claude Desktop

2026-11-08 在本机查看 ChatGPT 26.1103（`com.openai.codex`）与 Claude 4.23118（`com.anthropic.claudefordesktop`）：

| | ChatGPT（Codex） | Claude Desktop（Claude Code） |
| --- | --- | --- |
| 桌面端用的 CLI | 打进安装包 `Resources/codex-cli/`（408 MB），随整包更新 | 用时下载到 `~/Library/Application Support/Claude/claude-code/<版本>/<sha256 前 12 位>/`，校验后写 `.verified`，留两版 |
| 包装 | 嵌套的 `CodexCLI.app`，带描述文件，为的是 `keychain-access-groups` | `claude.app` 外壳，带麦克风与 Apple Events 权限 |
| 桌面端怎么调 | 子进程 `codex app-server --listen stdio://`；可选连本机常驻的 app-server，连之前先问版本 | 每个会话一个 stream-json 子进程，经 `Helpers/disclaimer --pgroup` 拉起 |
| 终端里的 CLI | App 不写 PATH，用户另装（npm，或 `~/.local/bin/codex`） | App 不写 PATH，原生安装器装在 `~/.local/share/claude/versions/<版本>` 加 `~/.local/bin/claude` |
| 两边共享 | `~/.codex` | `~/.claude` |
| 版本 | 各走各的 | 各走各的 |

两家的终端 CLI 能与桌面端各用各的版本，是因为 CLI 进程不常驻，只共享配置目录。BaoCut 的 Runtime 常驻且一个 Home 只有一个，所以要有 §4 的规则：ChatGPT 的常驻模式「连之前先问版本」可以照搬；不兼容时 BaoCut 不能退回自己另起一个，只能说清哪边更新或替换空闲的那个。本文照搬的还有：Claude Code 的安装布局（§9.3）、按需下载与 `.verified`（§9.7）、钥匙串访问组的外壳（§9.6）、disclaim 拉起（§9.7）。

## 11. 要修订的规范条目

实现时在同一任务里改：

| 条目 | 改什么 | 依据 |
| --- | --- | --- |
| [Agent 面设计 §5.6](agent-surface-design.md#56-runtime-的归属) | 「CLI 优先使用自身 App 的 Runtime」改成自身所在的安装；最后一条加只读链接账号；`runtime status` 报出替换规则下的状态 | §4、§7.1、§9.4 |
| [Agent 面设计 §8.2](agent-surface-design.md#82-放哪里) 的「入口」 | 删掉「不替用户往系统 PATH 写文件」与 `/usr/local/bin` 命令，改成 `~/.local/bin` 链接与 `cliEntry.*` | §3.2 |
| Agent 面设计 §6 | 加 stdio 形式；`mcp install` 默认写 stdio | §6.1 |
| [架构设计 §2.2](../../architecture/architecture-design.md#22-启动所有权与退出) | 发现信息加 `interfaceVersion`、`build`、`entry`；「CLI 只按开机时间判断」改成两边一样；「桌面端……照常复用它」改成按 §4.2；CLI 拉起时的项目目录与主机文件夹；入口顺序 | §4、§5 |
| [架构设计 §2.6](../../architecture/architecture-design.md#26-应用更新) | 安装前屏障覆盖本包拉起的 CLI Runtime；「只有一个分发渠道」改成 GitHub Releases 是唯一的归档来源，App 与独立包都从这里取；「一个版本一套二进制」写明独立包与 App 同一次构建、用同一套原生程序 | §4.3、§9.5 |
| [架构设计 §6.8](../../architecture/architecture-design.md#68-模型服务配置) 的凭据存储 | 「后端由构建类型决定」之外加链接账号的只读层与 `ACCOUNT_LINKED` | §7.1 |
| [架构设计 §12.11](../../architecture/architecture-design.md#1211-系统访问权限macos-完全磁盘访问权限) | CLI 拉起时的权限归属（disclaim 实测后） | §9.7 |
| [命令与协议规范 §4.1](../../spec/command-protocol-spec.md#41-方法) | `cliEntry.*`、链接账号、`runtime.stop` 的替换条件、把 CLI 拉起的 Runtime 改成常驻的方法 | §3.2、§4.2、§6.2、§7.1 |
| [桌面端 README「外部 Agent 与 CLI」](../../../apps/desktop/README.md#外部-agent-与-cli) | PATH 安装（macOS 与 Windows）与 cask；删掉「不自动向系统 PATH 写文件」 | §3 |
| `skills/baocut/references/start.md` | 第 1 节加 `~/.local/bin/baocut` 与独立包位置；第 4 节「桌面端开着时直接用桌面端的那个」改成按版本规则；第 5 节先跑 `doctor` | §3、§4、§8 |

## 12. 实施顺序与验收

**第一批（小改，可先做）**：§3 PATH 与 cask，§5 三项，§7.3，§8。

- 验收：退出 App，只用 `~/.local/bin/baocut` 新建视频，视频落在 `~/BaoCut`；`download` 落在系统下载文件夹；Windows 上把下载文件夹重定向后同测。拔掉 Runtime 进程、让 PID 被复用后，下一条命令能重新拉起。Node 22 上源码 Runtime 能起。

**第二批（让 CLI 真正独立）**：§4，§6.1，§7.1，§7.2，§7.4。

- 验收：§4.2 的组合（版本同或不同、空闲或忙、拉起者）各有单测；App 更新时有一个 CLI Runtime 在跑，macOS 与 Windows 各实测一次；链接账号能读、改密钥被拒、移除只解除链接，钥匙串条目还在（用 `security find-generic-password` 只查条目在不在，不读密钥）；Claude Code 与 Codex 各以 stdio 形式接上 MCP，Runtime 不在时能自己拉起。

**第三批**：§9 独立包；之后再做按需组件（§9.7）。

- 验收：在没装过 App 的机器上装独立包，读到 App 存过的密钥不弹窗，完全磁盘访问的归属与 §9.7 一致，更新与回滚各走一遍。

## 13. 待实测事项

下面几项是推测，实现到对应部分时实测，结果写回对应小节：

- 无窗口拉起的 Runtime 读钥匙串不弹窗：先退出 App，再运行 `/Applications/BaoCut.app/Contents/MacOS/baocut-cli models capabilities --capability synthesizeSpeech --json`，结果应有 `runtime.started: true` 且在线语音服务可用（§1.1）。
- 不同的二进制用同一签名标识，能否不弹窗读 App 存的条目（§9.6）。
- disclaim 拉起后，完全磁盘访问是否算在 BaoCut.app（§9.7）。
- SSH 会话里钥匙串是否报 `denied`（§8.1）。
- macOS 上 App 更新后，旧 Runtime 起的 Worker 读的是哪份文件（§4）。
- §5.2 的 Windows 已知文件夹与语言列表的读法，在重定向到 OneDrive 的机器上核对。

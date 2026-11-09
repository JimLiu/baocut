# CLI 独立使用与发布：不开桌面端也能用，以及独立 CLI 包

> 方案稿，2026-11-08。第一批（§12：§3、§5、§7.3、§8）与第二批（§4、§6.1、§7.1、§7.2、§7.4）已实现；第三批（§9）的打包、安装、更新、disclaim 拉起与 §9.4 的复用规则已实现，还没发布。目标：装了 BaoCut 的机器上，人和外部 Agent 在终端里直接用 `baocut` 完成 Agent 面的全部能力，不需要打开桌面窗口；同一个 Runtime Home 上无论谁先拉起 Runtime，行为都一样；再把 CLI 与 Runtime 打成独立包，与 App 同版本发布。
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
| 10 | 钥匙串先用同一签名标识的助手，实测不行再换访问组外壳（实测可行，不要外壳） | §9.6 |
| 11 | App 首次启动时自动装上终端里的 `baocut`：每个 Runtime Home 一次，那里已有东西时不动，用户移除后不再装回来 | §3.2 |

第 3 条之下可以加一句提示：桌面端退出、停下自己的 Runtime 时，如果还有 CLI 连接，退出对话框说明这些连接会断开、下一条命令会在后台重新拉起 Runtime。

## 3. 命令行入口与 PATH

### 3.1 入口

入口不变：macOS 是 `BaoCut.app/Contents/MacOS/baocut-cli`（C 启动器，解析软链接后以包内 Electron 跑 `cli.js`），Windows 是安装目录里的 `baocut.cmd`（[桌面端 README「外部 Agent 与 CLI」](../../../apps/desktop/README.md#外部-agent-与-cli)）。本节只管怎么让终端找到它。

### 3.2 安装到 PATH

- **位置**：macOS 在 `~/.local/bin/baocut` 放软链接，指向 App 的 `baocut-cli`。目录不在时建，不要 sudo。
- **已有文件**：`~/.local/bin/baocut` 是指向某个 BaoCut 入口的软链接时改指向；是别的文件或指向别处的链接时不覆盖，报 `foreign`（同 Agent 面设计 §8.2 的规则）。指向独立 CLI 包（§9）的链接 App 不改：那是用户专门装的命令行。
- **PATH 检查**：以用户的登录交互 shell 读 PATH（`$SHELL -ilc 'printenv PATH'`，只给最小环境、限时 5 秒、只取最后一个非空行，避开 shell 启动时打印的其他内容），再在这个 PATH 里找第一个 `baocut`；Windows 读注册表里系统与用户的 `Path`。查不出（没有 shell、超时）时只说查不出，让用户开新终端自己试。`~/.local/bin` 不在 PATH 上时按用户的 shell 给出要加进配置的那一行（zsh 写 `~/.zshrc`，bash 在 macOS 写 `~/.bash_profile`、Linux 写 `~/.bashrc`，fish 用 `fish_add_path`），不替用户改 shell 配置文件；终端先找到的是别的 `baocut` 时点名它。
- **状态**：`none`、`current`（指向本 App 的入口）、`stale`（指向另一份 BaoCut 入口，例如移动前的 App）、`broken`（指向的位置不在了）、`foreign`。`install` 时在 `<Runtime Home>/cli-entry.json` 记下位置与目标；App 每次启动检查这条记录，入口还指向记录里的目标（自己装的、之后没人改过）且是 `stale` 或 `broken` 时改指向自己，只改入口、不动 PATH；用户自己建的链接（哪怕指向别的 BaoCut）只在用户显式 `install` 时才改，`foreign` 永不改动。
- **首次启动**：桌面端拉起的 Runtime 第一次在某个 Home 上启动时，入口位置上什么都没有（`none`）就照 `install` 装上，Windows 同样把目录加进用户 PATH；那里已有东西（任何状态）都不动。做过就在 `<Runtime Home>/cli-entry-first-launch.json` 记下结果（`installed`、`pathFailed`、`present`、`failed`），之后不再做；用户 `remove` 过也记下（`removed`），App 不会再装回来。没有 App 入口的源码 Runtime 不做也不记。这一步不查终端的 PATH、不改 shell 配置，放在后台跑、不拖慢启动；`~/.local/bin` 不在 PATH 上时，终端里仍要用户按 Skills 页给出的那一行加进配置，Agent 按 skill 的启动页会直接看这个位置。CLI 拉起的 Runtime 不做这一步。
- **入口**：规则放在 Runtime 里，App 与 CLI 共用，Web 只看状态（写用户主目录只在桌面界面与 CLI 里做），与 `agentSkill.*` 的分工相同。协议方法 `cliEntry.status|install|remove`（命令与协议规范 §4.1），CLI 是管理桶的 `baocut cli install|status|remove`；App 在 Skills 页「在终端或其他应用的 Agent 里使用 BaoCut」卡片里加「安装命令行工具」。Runtime 经已有的 `BAOCUT_CLI_ENTRY` 知道 App 入口的位置。
- **Windows**：在 `%LOCALAPPDATA%\BaoCut\bin\` 放一个 `baocut.cmd`，转发到 App 安装目录里的 `baocut.cmd`（装了独立包时转发到它的当前版本，§9.3），再把这个目录加进用户 PATH（`HKCU\Environment` 的 `Path`，改完广播 `WM_SETTINGCHANGE`），不要管理员权限。这个目录只放这一个文件；状态与 macOS 相同，`foreign` 指那里的 `baocut.cmd` 不是 BaoCut 写的转发脚本。改过的 PATH 只对新开的终端生效，装完提示这一点。

### 3.3 Homebrew cask

- 一个 cask `baocut`，下载与 App 自动更新相同的 GitHub Releases 归档，`binary "#{appdir}/BaoCut.app/Contents/MacOS/baocut-cli", target: "baocut"` 把入口链接进 Homebrew 的 `bin`。
- 带 `auto_updates true`：App 自己更新（架构设计 §2.6），`brew upgrade` 不与它抢。
- cask 与 `~/.local/bin/baocut` 可以同时存在，两者指向同一个 App。
- cask 放在 BaoCut 自己的 tap（GitHub 上的 `homebrew-tap` 仓库），每次发布随 appcast 一起更新版本号与校验和；cask 文件的源放在本仓库，tap 仓库由维护者建。
- 实现：源文件是 `apps/desktop/releases/homebrew/baocut.rb`，由 `apps/desktop/tools/homebrew-cask.mjs` 按 `appcast-aarch64-apple-darwin.json` 生成（URL 必须与 appcast 的相同）；macOS 发布流程把它与 appcast 放进同一个 commit。复制到 tap 的 `Casks/baocut.rb` 由维护者做。

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

> 已实现（2026-11-08）：规则在 `@baocut/protocol` 的 `decideRuntimeReuse`，CLI（`apps/cli/src/runtime/connection.ts`）与桌面端（`RuntimeSupervisor`）共用；落地后的说法见架构设计 §2.2「两份安装共用一个 Home」与 §2.6。与上文的出入：
>
> - CLI 只在它会拉起的是自己这份安装时替换，`--no-start`、`BAOCUT_RUNTIME_ENTRY` 或会拉起别处装的 App 时照版本门拒绝，免得替换后起的仍是另一个版本。
> - 桌面端替换的时机是每分钟问一次 `runtime.status`；空闲的口径同 `runtime.stop`：桌面端发起时它自己的连接都不算（一个 Home 只有一个桌面端，含 Bot 后台服务），有 CLI 连着算在用。
> - 有任务的 CLI Runtime 本来就由界面连着，它的任务已在屏障里；装之前（「重启并更新」与退出即安装）桌面端请它停下并等它退出，它还有 CLI 连着而拒绝时照旧安装。
> - 已知缺口：协议版本不同、CLI 拉起、没有任务但开着对外服务（Web、MCP）的旧版 Runtime 不会空闲退出，桌面端又握不上手、停不了它，界面会一直等；要用户先 `baocut runtime stop` 或关掉服务。macOS 与 Windows 上「App 更新时有一个 CLI Runtime 在跑」未实测。

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

解析在 Runtime 入口做（`apps/runtime/src/host-environment.ts`），结果补进环境，读这些变量的地方不变；解析失败或解析出的文件夹不存在时退回现在的默认值，不阻断启动。按[开发流程 §4.1](../../development-workflow.md#41-跨平台系统集成)在 Windows 与 macOS 上实机核对：同一台机器上 Runtime 自己解析的结果与桌面端传入的一致。

开发态的桌面端还传 `BAOCUT_ALLOWED_ORIGINS`（Vite 的地址）。开发态桌面端复用的 Runtime 不接受自己的 origin 时，按 §4.2 的「版本不同」处理。

### 5.3 存活判断

CLI 照桌面端补上端点检查：发现文件里的 PID 还在、记录不早于这次开机，并且端点没有拒绝连接，才算在跑。CLI 只依赖 client 与 protocol（[架构设计 §13.1](../../architecture/architecture-design.md#131-目标目录)），不引入 `runtime-storage`：沿用 `isRecordedProcessAlive` 与 `packagedResourceEnv` 的做法，在 `connection.ts` 里写一份，测试核对与 `isDiscoveryLive` 一致。

## 6. 不靠桌面端的长期服务

CLI 拉起的 Runtime 在有在用的连接、任务或开着的对外服务（Web、MCP）时不空闲退出（`RuntimeActivity`），所以 Web 服务开着时审片链接一直能用。剩下两处缺口：只走 MCP 的宿主自己拉不起 Runtime；电脑重启后没有谁去拉起 Runtime，审片链接与 HTTP 形式的 MCP 要等下一条 CLI 命令。

### 6.1 MCP stdio

- `baocut mcp serve --stdio`：宿主把它当作 stdio 形式的 MCP 服务器拉起。它按 CLI 的规则找到或拉起 Runtime（§4 同样适用），把 stdio 上的 JSON-RPC 转发给 Runtime 的 MCP 端点；开放清单与权限与 HTTP 形式相同（Agent 面设计 §3、§6）。
- 转发期间算一条在用的 CLI 连接，Runtime 不空闲退出。Runtime 中途退出时重新找或拉起一次，正在进行的请求以错误返回，不重放。
- `baocut mcp install` 默认写 stdio 形式（命令加参数）。命令写 `~/.local/bin/baocut`（装了的话），否则写入口的完整路径；宿主不支持 stdio 时才写 HTTP 地址与令牌。

> 已实现（2026-11-08）：`apps/cli/src/admin/mcp-stdio.ts`；落地后的说法见 Agent 面设计 §6.2 与架构设计 §4.8「stdio 桥」。桥带着条目里的客户端令牌转发给 HTTP 端点，权限、审批与审计都是那个客户端的。与上文的出入：
>
> - 命令只在 `~/.local/bin/baocut` 指向这份安装时写它（独立包：入口由独立包管时，见 §9.4），否则写这份安装的入口（源码时是 `node` 加 `apps/cli/src/main.ts`）；Home 不是默认的时条目带 `BAOCUT_HOME`。四家宿主都支持 stdio，`--transport http` 留给要 HTTP 的情形。
> - 用户关掉的 MCP 服务（不随 Runtime 启动）桥不替他开；找不到或拉不起 Runtime 时桥不退出，每个请求以原因回答，下一个请求再试。
> - 实测：Claude Code 2.1.296 的 `claude mcp list` 显示已连接（令牌从 `settings.json` 的 `env` 继承）；MCP SDK 客户端只给 `PATH`、`HOME` 与条目的 `env`（同 Codex 给 stdio 服务器的最少环境）时，Runtime 不在能自己拉起、SIGKILL 掉 Runtime 后下一个请求重新拉起。Codex 0.159.0 与 Gemini CLI 读得懂写进去的条目，但没在它们的会话里实际调用（`codex mcp list` 不连接，Gemini 在未信任的目录里不启用 MCP）。Windows 上 `.cmd` 入口经 `cmd /d /c` 拉起，未实测。

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

> 已实现（2026-11-08）。与上面的出入：
> - 只读存放：本 Home 本来就用钥匙串时直接只读地用它；用文件时只认 `BAOCUT_CREDENTIAL_HELPER`。源码 CLI 拉起源码 Runtime 时，只要没设这个变量，就找装好的 App 的 `<resources>/bin/credential-helper`（只看文件在不在）指过去。
> - 抄过来的描述还有 region 与账号级端点；本 Home 没配置过的服务商连同开关、端点、名字与声明的模型一起建。`accountId` 与已有账号重名时另起一个；再链接一次只刷新描述（`created: false`）。
> - 「用钥匙串后端」按来源有没有 `store/model-credentials.json` 判断（钥匙串后端启动时迁走并删掉它），只看在不在、不读。同一个 Home、来源没有模型服务配置也报 `LINK_SOURCE_UNSUPPORTED`；给了筛选没匹配上报 `not-found`（`ACCOUNT_NOT_FOUND`）。
> - `ACCOUNT_LINKED` 不只拦密钥：名字、开关、region、端点都跟着来源，一样拒绝；只排序可以。`models.configure` 的 `credential` 落到链接账号头上同样拒绝，`credential: null` 与 `removeProvider` 只解除链接。
> - 跟着来源走：按来源 `model-services.json` 的修改时间与大小缓存，读视图时重读；账号回到来源或来源换了密钥（掩码变了）时在后台重查 `has`，变了就推 `capabilities.updated`。
> - 协议方法是 `models.linkAccounts { home, providerId?, accountId? }`，浏览器不开放；视图里链接账号带 `linked: { home }`。桌面端与 Web 界面没改：链接账号只出现在 CLI 用的隔离 Home 里，App 不打开那里。
>
> 验证：存储与 Runtime 两层单测（假助手，含移除后来源的条目还在、助手只被调 `get` 与 `has`）；源码 CLI 在临时 Home 上经假助手链接假来源；又以真实的 `~/.baocut` 为来源（只读它的 `model-services.json`，假助手里没有密钥）链接再移除，`security find-generic-password`（不带 `-w`）查到真实条目前后都在。没做：经 App 的助手真读一次钥匙串里的密钥（不碰真实密钥）；Windows 未实测。

### 7.2 隔离 Home 的搭建

源码 CLI 在非默认 Home 上会自己拉起仓库里的 Runtime，`engine-host` 与 web 构建也会回退到仓库的构建产物，只设 `BAOCUT_HOME` 就够。可以加 `baocut sandbox create <目录> [--link-accounts-from <home>]`：建 Home 与项目目录，写一份 `env.sh` / `env.ps1`，按需链接账号，打印怎么用。

> 已实现（2026-11-08）：管理桶 `apps/cli/src/admin/sandbox.ts`。与上文的出入：
>
> - 只设 `BAOCUT_HOME` 不够：终端里的 `baocut` 常是 `~/.local/bin` 里 App 的那个，它在这个 Home 上拉起的是 App 的 Runtime，用钥匙串存密钥。所以除了 `<目录>/projects`，还写包装脚本 `bin/baocut`（Windows `bin\baocut.cmd`），里面设好 `BAOCUT_HOME` 与 `BAOCUT_PROJECTS_DIR`，用跑 `sandbox create` 的那个 Node 跑那份仓库的 `apps/cli/src/main.ts`。`env.sh`（macOS 与 Linux）与 `env.ps1`（带 BOM，Windows PowerShell 5.1 才按 UTF-8 读）设这两个变量与 `BAOCUT_CLI`（指向包装脚本），并把 `bin` 放到 PATH 最前。用脚本不用 shell 函数：从这个 shell 启动的 Agent 是子进程，看不到函数。
> - 包装脚本钉住的是跑 `sandbox create` 的那份 checkout 与 Node；换了就再跑一次，对已有的沙盒只刷新这些文件（`refreshed: true`）。
> - 拒绝，都在建任何东西之前：默认 Home（`INVALID_ARGUMENTS`）；不是从仓库运行的 CLI，或它在这个 Home 上拉起的 Runtime 不用文件存密钥（App 自带的 CLI、设了 `BAOCUT_RUNTIME_ENTRY`），以 `SANDBOX_NEEDS_SOURCE_CLI`（退出码 1）拒绝：钥匙串不分 Home，沙盒里存或删账号会动真实的条目；目录里已有文件、又不像 BaoCut Home 或沙盒（没有 `store`、`runtime.json`、`env.sh`、`env.ps1`）时 `INVALID_ARGUMENTS`。整个名词不经入口连 Runtime（`offline: true`），`baocut sandbox` 这样的用法错误也不会在当前 Home 上拉起 Runtime。
> - `--link-accounts-from`：在沙盒上找到或拉起源码 Runtime，调 `models.linkAccounts`，输出与 `models accounts link` 相同。链接失败时沙盒留着，stderr 说明后报那个错误。
> - 下载照 §5.2 进系统的下载文件夹，不在沙盒里。没写给 cmd 用的 `env.cmd`。
>
> 验证：单测（sh 与 PowerShell 的引号、Windows 的文件内容、在真的 sh 里 `. env.sh` 再跑包装脚本，路径带空格与单引号；默认 Home、App 的 CLI、钥匙串 Runtime、`BAOCUT_RUNTIME_ENTRY`、别人的文件夹都拒绝且不留东西）。源码 CLI 在路径带空格的临时目录上 `sandbox create --link-accounts-from` 经假助手链接假来源；再在 PATH 只有 `/usr/bin:/bin` 的 shell 里 `. env.sh`，`baocut status` 与 `models accounts` 用的是沙盒、复用那个 Runtime，最后 `runtime stop`。没做：Windows 与 PowerShell 未实测，`.cmd` 里的路径有非 ASCII 字符时 cmd 按代码页读，可能不对。

### 7.3 源码 Runtime 的 Node

`resolveRuntimeLaunch` 用当前进程的 Node 直接跑 `apps/runtime/src/main.ts`。当前 Node 不带旗标时不去掉类型标注（`process.features.typescript` 为假，或它为真只是因为 CLI 自己带了 `--experimental-strip-types`）时补这个旗标；Node 版本不在仓库 `package.json` 的 `engines.node` 范围里时不拉起，以 `RUNTIME_START_FAILED` 报出要哪个版本（`checkRuntimeNode`），不留一行 `ERR_UNKNOWN_FILE_EXTENSION` 在 `cli-runtime.log` 里。

### 7.4 构建是否过期

源码 Runtime 不比对 web 构建、`preview.wasm` 与各 Worker 的版本（`web-static.ts`、`findBundledBinary`），源码比它们新时审片页只提示画不出来。规则：

- web 构建与各 Worker 记下协议版本与构建 commit。
- `baocut version` 报出它们各自的构建；源码 Runtime 发现与源码不一致时在 `version` 与 `status` 里警告，并给出重建命令。
- 审片页因为 web 构建过期画不出时，提示写明原因。

> 已实现（2026-11-08）：构建脚本在产物旁写构建戳 `baocut-build.json`（`tools/build-stamp.mjs`）：`npm run build:engine` 写在 Worker 所在目录，`npm run build:wasm` 写在两份 WASM 旁，`npm run build:web` 写在 `apps/web/dist`。比对在 `@baocut/runtime-core` 的 `build-freshness.ts`，只有从源码运行的 Runtime（入口不在 `app.asar` 里）比。与上文的出入：
>
> - 比的是源文件内容，不是 commit：构建戳除了构建 commit 与协议版本，还记下这次构建读过的每个仓库文件的内容摘要（cargo 的 dep-info、Vite 的模块列表，加上清单与锁文件）。只比 commit 的话，无关的提交、借用主 checkout 产物的 worktree 都会被误报。web 构建另比协议版本，不同就算过期；Worker 有自己的协议，只比源码。
> - 没有构建戳（旧脚本或直接 `cargo build` 编的）、产物比构建戳新的，报「比不了」（`unverified`），一样警告并给出重建命令。新脚本落地后、各自重建一次之前，每个开发者都会看到这几条。
> - 结果放在 `runtime.status` 的 `builds`（[命令与协议规范 §4.1](../../spec/command-protocol-spec.md#41-方法)），不进发现信息与 `runtime.info`：要读文件、算摘要，不该在握手时做。`baocut version` 在 `runtime.builds` 与顶层 `warnings` 里报出，`status` 同样；`status` 的 `next` 先给第一个过期的那个的重建命令。
> - 第三条（审片页的提示）没做。
>
> 验证：构建戳与比对的单测，`runtime.status` 带不带 `builds` 的 Runtime 测试；在一个临时 Vite 工程上跑插件，改源文件后报过期、改协议版本后报 `protocol`；用主 checkout 现成的 dep-info 写一份 Worker 构建戳（1034 个仓库文件，冷比对约 90 ms、之后约 5 ms）；源码 CLI 在临时 Home 上 `status` 与 `version` 报出三条 `unverified` 与重建命令。没在仓库里真跑 `build:engine`、`build:wasm` 与 `build:web`（这个 worktree 借用主 checkout 的 cargo 产物目录，也没有 WASM）。

## 8. 诊断与文案

### 8.1 `baocut doctor`

只读，不拉起 Runtime 也能回答，不用先征得同意。逐项给出 `ok` / `warn` / `fail` / `skip`（这台机器上不适用，例如没装 App 时的入口、Runtime 没在跑时的完全磁盘访问）与补救命令，信封同 `baocut status`；`next` 是第一个 `fail` 的补救，没有时取第一个 `warn` 的。退出码总是 0，结论看 `result.ok`（有 `fail` 时为 false）：

- **入口**：终端里的 `baocut` 指向哪里，与 App 是否同一版本，PATH 状态（§3.2）。
- **Runtime**：会用哪个入口拉起（`resolveRuntimeLaunch` 的结果）、哪个 Home、哪个项目目录、哪种凭据后端；正在跑的那个的版本与拉起者。
- **凭据**：后端可用吗。钥匙串经助手对一个不存在的键做一次 `has`，不读任何密钥；SSH 等没有图形会话的环境里钥匙串可能拒绝访问（`denied`），给出说明。
- **完全磁盘访问**：`runtime.access` 的结果；缺失时说明系统会算在谁头上（App 拉起时是 BaoCut.app，从终端拉起时可能是终端，见架构设计 §12.11）与系统设置里的位置。
- **构建**（开发态，不从打包的 App 拉起时才有）：用拉起 Runtime 的同一条命令跑 `--self-check --probe`（不启动 Runtime，只把各原生程序启动一次），报出它找到的问题与 §7.4 的比对结果。视频引擎、各 Worker、web、`editor.wasm`、内置模板与技能缺了或起不来是 `fail`，其余（本地语音、Electron 宿主、凭据助手等）是 `warn`；构建比源码旧或比不了是 `warn`。补救是对应的构建命令。这一项要把每个原生程序启动一次，要十几秒；从打包的 App 拉起时是 `skip`。

`status` 回答这台机器能做什么，`doctor` 回答为什么起不来、为什么读不到。

### 8.2 文案

改的是 i18n 目录里的文案与给模型的英文指导，规则见[仓库约定 §5](../../repo-conventions.md#5-文案与多语言)：

- `RUNTIME_UNAVAILABLE`（`--no-start` 时）的 `next` 写明会用哪个入口、哪个 Home、哪种凭据后端拉起。
- `RUNTIME_START_FAILED` 给出日志路径与末尾几行（已有），并建议 `baocut doctor`。`start.md` 第 5 节改成先跑 `doctor`；只有 `doctor` 指向只能在桌面端做的事时才请用户打开桌面端。
- 要授权与密钥无效的补救先给 CLI 命令（`baocut grants …`、`baocut models configure`，密钥由用户自己输入），再提桌面端的设置。实现时只改了密钥无效（`PROVIDER_AUTH_FAILED`）的指导；要授权的提示（`GRANT_REQUIRED`、`GRANT_REVOKED`）桌面界面也显示同一句，没改，CLI 命令已在错误的 `remedy.commands` 里（`baocut grants create|update`）。
- `job-tools.ts` 里完全磁盘访问的指导加上命令行下的说法：告诉用户系统设置里的位置与要打开的应用，授权后用 `baocut doctor` 复查。不让 Agent 自己去开系统设置的规定不变。

## 9. 独立 CLI 包

已定要做（§2 第 4 条）。第一版 macOS 与 Windows，与 App 同一次构建、同一个版本号同时发布。原计划排在 §4 与 §6.1 之后：不然只装独立包的用户会碰到 MCP 宿主拉不起 Runtime，与 App 版本不同时也没有确定的规则。实际先做了打包、安装与更新，它们不依赖 §4；§9.4 的复用与替换等 §4.2 合并后再接上。

### 9.1 内容

独立包是同一次构建多出的一个产物。`apps/desktop/tools/standalone-cli.mjs` 从签好、验过的 App 里取出它；`package-desktop.mjs --standalone-cli` 在 App 之后做这一步。包里不带 Electron 与桌面界面：

- **macOS**：一个 `BaoCut CLI.app`，标识 `com.baocut.cli`，`LSUIElement`，可执行文件是 Node。
  - `Contents/MacOS/` 放 `node`、启动器 `baocut-cli` 与 `baocut-disclaim`（§9.7）。启动器与 App 的是同一份 `desktop-cli-mac.c`。
  - `Contents/Resources/` 放 `app/`、第三方声明，以及 App 的资源目录：`bin/` 下的原生程序、模板、贴纸、skill、模型资源、web 与各编辑器。资源目录用 `ditto` 原样拷贝，原生程序的签名不变。
  - 包成 `.app`，是为了在系统设置的完全磁盘访问列表里以 BaoCut CLI 出现。
- **Windows**：`baocut.cmd`、`node.exe` 与 `resources\`。`resources\` 里是同样的资源，外加 `app\`。
- **`app/`**：解开的 `app.asar` 去掉 `out/renderer` 与 `out/preload`，剩 `out/main/` 的 `cli.js`、`runtime.js` 与依赖。依赖只有纯 JS 的 `ws` 与 `zod`，没有原生模块。
- **清单** `app/baocut-standalone.json`：`{ schema, product, version, build, target, variant, sourceCommit, node }`。CLI 靠它认出自己在独立包里，布局与解析在 `@baocut/protocol` 的 `standaloneLayout` 与 `parseStandaloneManifest`。
- **Node**：
  - 大版本必须与 App 里 Electron 自带的一致，并且有 `node:sqlite`。打包时比对，3.16.4 的 Electron 44.9.3 带 Node 24.22.0。
  - 默认取打包机上运行脚本的 Node，也可以用 `--node` 指定。macOS 上重签（§9.6）。
- **启动器**：设置 `packagedResourceEnv` 的环境变量与 `BAOCUT_PACKAGE_KIND=standalone`，资源照 App 的找法。
- **没有 Electron 的后果**：代码画面的离屏宿主（`CompositionHost`）起不来，报 `COMPOSITION_HOST_UNAVAILABLE`，提示装 App 或把 `BAOCUT_ELECTRON` 指向 App 的可执行文件。Runtime 自检在独立包里不要求 `electron`，离屏宿主一项记为跳过。

### 9.2 大小

BaoCut 3.16.4 安装后 748 MB，实测各部分：

| 部分 | 大小 | 独立包 |
| --- | --- | --- |
| Electron（`Frameworks`） | 252 MB | 去掉，换成 Node（本机 Node 26 可执行文件 147 MB） |
| 原生程序（`bin/`） | 309 MB：`mlx.metallib` 102、`audiocpp` 80、`export-worker` 26、`model-worker` 25、`matte` 25、`face-detect` 25、`engine-host` 15、`speech-worker` 10、`credential-helper` 0.7 | 保留 |
| web 与编辑器 | 约 112 MB：web 66、docs 18、slides 13、design 12、design-system 2.8 | 保留（`web open`、`web review` 要用） |
| `app.asar` | 54 MB | 换成 `cli.js`、`runtime.js` 与依赖 |
| 模板、skill、贴纸、模型资源 | 约 20 MB | 保留 |

2026-11-08 用这个 App 加本分支的 `out/main` 打了一个本机演练包：

- 解开 587 MB：`bin/` 309、Node 24.22.1 116、web 与编辑器 112、`app/` 28（`out/main` 21、依赖 7）、其余约 20。
- zip 207 MB（217,175,373 字节）。
- 要明显变小，得把本机模型相关的程序改成按需下载（§9.7）：`model-worker` 加 `mlx.metallib`、`audiocpp`、`matte`、`face-detect`、`speech-worker`，约 270 MB。

### 9.3 安装布局

都装在用户目录，不要管理员权限，布局照 Claude Code 的原生安装器：

- **版本目录**：`~/.local/share/baocut/versions/<版本>-build.<n>/`，Windows 是 `%LOCALAPPDATA%\BaoCut\cli\versions\<版本>-build.<n>\`。旁边的 `state.json` 记 `{ schema, current, previous, updatedAt }`。
- **入口**：
  - macOS：`~/.local/bin/baocut` 软链接指向当前版本目录里的启动器，换链接是原子的。
  - Windows：`%LOCALAPPDATA%\BaoCut\bin\baocut.cmd` 是转发脚本，固定转发到目录联接 `cli\current\baocut.cmd`，更新只换联接。cmd 边执行边读批处理文件，改写正在运行的转发脚本会让它从旧偏移处读到新内容，所以转发脚本不动。
- **`baocut cli install`**：在独立包里运行时不连 Runtime。
  - 把自己所在的包拷进版本目录：macOS 用 `ditto`，APFS 上是克隆，实测不到 1 秒。
  - 记成当前版本，再放好入口。之后下载下来的那份包就可以删了。
  - `cli status` 与 `cli remove` 也在独立包里处理。`remove` 只删入口，版本目录留着。
- **更新**：见 §9.5。上一版留着回滚；还有 Runtime 在用的旧版本不删，按发现信息的 `entry` 判断，见 §4.1；没人用的在下一次更新时删掉。独立包 Runtime 的 `entry` 是包根，装好后就是它的版本目录；在跑的是没有 `entry` 的旧版 Runtime 时，这次一个都不删。
- **共用**：与 App 共用 Home `~/.baocut` 与钥匙串条目。
- **App 怎么对待独立包的入口**：`cliEntry.status` 报 `standalone`，App 的设置页把这一行显示成已装好、由 `baocut update` 更新；App 启动时不修它，也不删它。`cliEntry.install` 与 `remove` 碰到它时拒绝，报 `CLI_ENTRY_STANDALONE`，见[命令与协议规范 §4.1](../../spec/command-protocol-spec.md#41-方法)。

### 9.4 与 App 共存

- **自定位（已实现）**：`resolveRuntimeLaunch` 现在依次找：`BAOCUT_RUNTIME_ENTRY`、自身所在的独立包、自身所在的 App、非默认 Home 上的仓库、标准安装位置的 App、仓库。独立包的 CLI 拉起的是包里 Node 跑的 `runtime.js`，不再落到标准位置的 App。
  - `baocut doctor` 在独立包里拿终端的 `baocut` 与独立包比，不与 App 比。
- **复用与替换（已实现）**：按 §4.2。独立包的 CLI 拉起的就是自己这一份（`LaunchSpec.own`），同一个 Home 上版本不同、空闲的 CLI Runtime 照样请它停下、换成自己的；接口版本相同时与 App 共用先起来的那个。桌面端看独立包拉起的 Runtime 与看别处拉起的 CLI Runtime 一样。
- **MCP 的 stdio 形式（已实现）**：独立包里 `mcp install` 写包的启动器；`~/.local/bin/baocut` 由独立包管（`cliEntry.status` 报 `standalone`）时写那个位置，`baocut update` 删掉旧版本目录后条目照样能用。
- 两个包同一次构建、同一个版本号一起发布。
- PATH 上的 `baocut` 由独立包管（§3.2，§9.3）。

### 9.5 更新渠道

- **更新源**：`baocut update` 读与 App 相同的更新清单 `apps/desktop/releases/appcast-<target>[-<variant>].json`。
  - 清单多一个 `cli` 条目 `{ format: 'zip', url, size, sha256 }`，由 `addStandaloneToFeed` 写入，App 的解析器当未知键忽略。
  - 归档 `BaoCut-CLI-<版本>-build.<n>-<target>[-<变体>].zip` 与它的 `.sha256` 和 App 放在同一个 GitHub release。
  - `macos-release.mjs` 发布前核对：归档的大小与摘要、公证提交号，以及清单里的 `cli` 与归档一致。
- **比较新旧**：只比 build。更新源还没有 `cli` 条目时报 `UPDATE_NOT_PUBLISHED`。
- **下载后的校验**：核对大小与 sha256。macOS 上还要过这几项：
  - 系统版本满足 `minimumSystemVersion`；
  - `codesign` 验证通过，Team ID 与自己的相同；
  - `spctl` 认可。
- **装上之后**：解开到版本目录（macOS 用 `ditto -x -k`，Windows 用系统的 `tar.exe`），记成当前版本并切换入口。
- **回滚**：`baocut update --rollback` 换回上一版。
- **并发**：同时只有一次更新，靠 `versions/.update.lock`。
- **演练**：`BAOCUT_UPDATE_APPCAST` 可以换更新源，只有这时才允许 `file://` 的清单与归档。没签名的本机演练包也只有这时能更新。
- **其他安装方式**：Homebrew formula 与 winget / Scoop 只是指向同一归档的安装方式，第一版不做。App 自己更新；Homebrew 装的 App 用 `brew upgrade`。在 App 包里运行 `baocut update` 会说明这一点。
- **架构设计 §2.6**：已改成「GitHub Releases 是唯一的归档来源」，App 与独立包都从这里取。

### 9.6 签名与钥匙串

- **签名顺序（macOS）**：先签两个启动器，再带 `entitlements.standalone-node.mac.plist`（`allow-jit`、`allow-unsigned-executable-memory`）签整个 `BaoCut CLI.app`。都用 Developer ID 与 hardened runtime。
  - `bin/` 下的原生程序保留 App 构建时的签名。
  - Node 官方包的 `get-task-allow` 与 `disable-library-validation` 不带进来。
  - 签好后公证并钉上票据，打成 zip，再解开验一遍签名、票据与 `spctl`。
  - 本机演练（`--local`）用 ad-hoc 签名，不公证。
- **Node 重签后能用**：2026-11-08 实测，用 BaoCut 的 Developer ID 与上面的权限重签 Node 24.22.1 后，`node:sqlite` 与 JIT 都正常。
- **钥匙串不需要外壳**：条目的访问控制按 designated requirement 认人。`credential-helper` 的 requirement 是「标识 `credential-helper` + Developer ID + Team ID」，不绑具体的二进制或证书。
  - 2026-11-08 实测：另编一个 `credential-helper`，sha256 与 App 里的不同，用同一身份、同一标识签名。双向 `set` / `get` / 覆盖都不弹窗，结论写回 §13。
  - 所以独立包直接用 App 里那个 `credential-helper`，不做 ChatGPT 那样的访问组外壳。外壳与数据保护钥匙串的迁移只在将来换签名身份时才要考虑。
- **Windows**：Credential Manager 不按程序区分。归档只核对 sha256，同 App。

### 9.7 只有桌面端做过的事

- **完全磁盘访问**：系统按负责进程判定授权，见架构设计 §12.11。
  - 以前从终端拉起时，负责进程是终端或 Agent 宿主，用户给 BaoCut 的授权不生效。
  - 现在照 Claude Desktop 的 `disclaimer`：App 与独立包都带一个 `baocut-disclaim` 助手（`apps/desktop/tools/disclaim-mac.c`）。CLI 经它拉起 Runtime，它设置 disclaim 属性后以 `POSIX_SPAWN_SETEXEC` 换成 Runtime，进程号不变。
  - 2026-11-08 实测，Runtime 成了自己的负责进程，tccd 日志里请求方与负责方都是包自己的标识：App 里是 `com.baocut.app`，独立包里是 `com.baocut.cli`。
  - 代价：不再沿用终端的完全磁盘访问权限。
  - `baocut doctor` 的完全磁盘访问一项点名该给 BaoCut 还是 BaoCut CLI 授权。
  - 授予之后是否生效没有实测：本机的 BaoCut 没开这项权限，不替用户去开。
- **常驻与审片链接**：靠 §6。
- **按需组件**（之后）：照 Claude Desktop 下载 Claude Code 的办法。
  - 放进 `<home>/components/<名字>/<版本>-<sha256 前 12 位>/`，校验后写 `.verified`，保留新旧两版。
  - 组件版本跟包版本走，仍是「一个版本一套二进制」（架构设计 §2.6）。
  - `findBundledBinary` 加这个查找位置。
  - 本批没做。

### 9.8 Linux

第一版不做。只有独立 CLI 才可能上服务器与 CI，但 Rust 媒体后端只支持 macOS 与 Windows，crates 里 `target_os = "linux"` 只有 `model-runtime` 的 3 处。要另立项目。`standaloneLayout` 对 Linux 返回 null，CLI 在 Linux 上不认独立包。

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

第一、二、三批改完了上表中与它们有关的部分（第三批：架构设计 §2.6 与 §12.11、命令与协议规范 §4.1 的 `cliEntry`、桌面端 README、`skills/baocut/references/start.md` 第 1 节）。还没改的：命令与协议规范里「把 CLI 拉起的 Runtime 改成常驻的方法」属于 §6.2，第一版不做，没有这个方法。

## 12. 实施顺序与验收

**第一批（小改，可先做；已实现）**：§3 PATH 与 cask，§5 三项，§7.3，§8（不含构建一项）。

- 验收：退出 App，只用 `~/.local/bin/baocut` 新建视频，视频落在 `~/BaoCut`；`download` 落在系统下载文件夹；Windows 上把下载文件夹重定向后同测。拔掉 Runtime 进程、让 PID 被复用后，下一条命令能重新拉起。Node 22 上源码 Runtime 能起。

**第二批（让 CLI 真正独立）**：§4，§6.1，§7.1，§7.2，§7.4。

- 验收：§4.2 的组合（版本同或不同、空闲或忙、拉起者）各有单测；App 更新时有一个 CLI Runtime 在跑，macOS 与 Windows 各实测一次；链接账号能读、改密钥被拒、移除只解除链接，钥匙串条目还在（用 `security find-generic-password` 只查条目在不在，不读密钥）；Claude Code 与 Codex 各以 stdio 形式接上 MCP，Runtime 不在时能自己拉起。
- 状态（2026-11-08）：已实现，各节的「已实现」写了与方案的出入与验证。验收没做到的：App 更新时有 CLI Runtime 在跑，macOS 与 Windows 都没实测；链接账号经假助手读，没经 App 的助手真读一次钥匙串里的密钥；Codex 只确认读得懂写进去的条目，没在它的会话里实际调用（Claude Code 实测连上）；Windows 上的入口、链接账号与 `sandbox create` 都没实测；§7.4 审片页的提示没做。已知缺口见 §4.3 的说明（协议版本不同、开着对外服务的旧版 CLI Runtime 不会空闲退出）。

**第三批**：§9 独立包；之后再做按需组件（§9.7）。

- 验收：在没装过 App 的机器上装独立包，读到 App 存过的密钥不弹窗，完全磁盘访问的归属与 §9.7 一致，更新与回滚各走一遍。
- 2026-11-08 已做（macOS，装着 App 3.16.4 的机器）：
  - 用 App 加本分支的 `out/main` 打了两个 ad-hoc 签名的演练包（build 1、build 2）。打包时的自检与 `check-bundled-cli.mjs` 都过了。
  - 在临时的 `HOME` 与 Runtime Home 上：
    - `cli install`；`doctor`：入口指向独立包，凭据是钥匙串，完全磁盘访问算在 BaoCut CLI；
    - Runtime 由包里的 Node 拉起，`transcode` 任务跑完；
    - 经 `file://` 的更新源 `update` 到 build 2，Runtime 重启后跑的是新版本；
    - `update --rollback`，`cli remove` 后版本目录还在。
  - 没有更新源条目时报 `UPDATE_NOT_PUBLISHED`。
  - 钥匙串与完全磁盘访问的实测见 §13。
  - 与第二批合并后接上 §9.4：独立包拉起的 Runtime 按 §4.2 替换，发现信息的 `entry` 是包根（`baocut update` 据此留下在用的版本目录），MCP 的 stdio 条目写独立包管的入口。只有单测，没在演练包上重跑。
- 还没做：
  - 没装过 App 的干净机器；
  - Developer ID 签名加公证的包，要在发布流程里做；
  - 授予完全磁盘访问后是否生效；
  - Windows 上的全部（打包、`cli install` 的联接与转发脚本、`update`）；
  - 发布工作流里加 `--standalone-cli` 与 Windows 发布脚本对 `cli` 归档的处理；
  - 按需组件。

## 13. 待实测事项

下面几项是推测，实现到对应部分时实测，结果写回对应小节：

- 无窗口拉起的 Runtime 读钥匙串不弹窗：先退出 App，再运行 `/Applications/BaoCut.app/Contents/MacOS/baocut-cli models capabilities --capability synthesizeSpeech --json`，结果应有 `runtime.started: true` 且在线语音服务可用（§1.1）。
- 不同的二进制用同一签名标识，能否不弹窗读 App 存的条目（§9.6）。已实测（2026-11-08），能：
  - 另编的 `credential-helper` 与 App 里的 sha256 不同，用同一 Developer ID、同一标识 `credential-helper` 与同样的权限签名后，designated requirement 与 App 的相同。
  - 一方 `set`，另一方 `has` / `get`，双向都不弹窗；一方覆盖另一方的条目也不弹窗。测试用的键事后删掉了。
- disclaim 拉起后，完全磁盘访问是否算在 BaoCut.app（§9.7）。已实测（2026-11-08），算在进程所在的包：
  - 从有完全磁盘访问权限的终端（Claude Code 的 `claude.app`）拉起，不经 disclaim 时 Node 与 App 的可执行文件以 Node 方式运行都是 `granted`，tccd 记在终端头上。
  - 经 disclaim 拉起都变成 `missing`，tccd 记在进程自己的包头上：App 里是 `com.baocut.app`，独立包里是 `com.baocut.cli`。
  - 本机的 BaoCut 没开这项权限，授予之后是否生效没测。
  - 副作用：测的时候裸 Node（mise 的 `node`）进了完全磁盘访问的列表，开关关着，可以在系统设置里删掉。
- SSH 会话里钥匙串是否报 `denied`（§8.1）。
- macOS 上 App 更新后，旧 Runtime 起的 Worker 读的是哪份文件（§4）。
- §5.2 的 Windows 已知文件夹与语言列表的读法，在重定向到 OneDrive 的机器上核对。
- §3.2 的 Windows 部分（转发脚本、用 PowerShell 改用户 `Path` 并广播、读注册表里的 `Path`）只有单测，没在 Windows 上跑过：装、修、移除各跑一次，看新开的 cmd 与 PowerShell 能找到 `baocut`，原 `Path` 里的 `%USERPROFILE%` 这类变量没被展开。

# Actions 构建产物清理

## 目录

- [范围与保留策略](#范围与保留策略)
- [使用](#使用)
- [安全边界](#安全边界)
- [保留期补丁](#保留期补丁)
- [验证](#验证)

## 范围与保留策略

`cleanup.py` 仅处理显式 `--run` 指定的 JimLiu/baocut 自动 tag 发布运行。默认 dry-run，不使用运行删除、日志删除或 Release 修改 API。删除接口只允许 `DELETE actions/artifacts/{id}`。JSON 报告列出每个 artifact 的 ID、名称、字节、保留／删除候选原因，以及预计释放字节总和。报告不是可以跳过检查直接应用的删除清单；每次执行都重新获取状态。

默认回滚窗口为 7 天，从运行、Release 和全部 Release asset／artifact 最后更新时间中的最晚时间开始计算。`--rollback-days N` 可以延长或缩短，但最少 1 天。`--protect-run ID` 可重复，用于人工指定仍需发布、排障或重试的来源运行；该保护只约束本脚本，不会阻止 GitHub 自然过期。

保留条件包括：未发布、draft/prerelease、发布失败或取消、尚未完成、手动或未知构建流程、未知或重名产物、来源不符、已过期、回滚窗口未满、Release 下载或校验失败。不会仅凭文件名或 Release 存在就认定安全。

只有成功的 `.github/workflows/desktop-release.yml` tag push 运行，只含 Mac 和 Windows CPU/CUDA/Vulkan 四种已知且不重名的 artifact（允许部分已清理，剩余项重新完整核验），且全部检查通过，才可能成为候选。完整校验从公开 Release 流式下载 8 个安装包／ZIP、8 个 `.sha256`、4 个发布报告和 4 个 appcast，共 24 个文件；比对实际大小、SHA-256、GitHub asset digest、sidecar 文件名／哈希、报告中的版本／build／源提交／candidateRunId、安装包大小／哈希和 feed 下载目标。Windows 的 CUDA/Vulkan 体积较大，会消耗数 GB 下载流量；4 个并发下载，二进制不写磁盘。

## 使用

在仓库根目录运行。要求 Python 3.10+，Linux、macOS 或 WSL；本地互斥锁依赖 `fcntl`，未支持原生 Windows Python。无第三方 Python 依赖。令牌通过 `GH_TOKEN` 或 `GITHUB_TOKEN` 环境变量提供，不放到参数或报告中。公共仓库只读可无令牌，但容易触发 API 限速；建议使用仅此仓库的细粒度令牌，只读时授予 Actions read、Contents read，实际删除时 Actions write。不需要 Contents write。

默认预览：

```bash
python3 scripts/actions-artifact-cleanup/cleanup.py \
  --run 40205298289 --run 40422618425 \
  --report /tmp/baocut-cleanup-preview.json
```

即使仍在回滚窗口内，也进行完整下载核验：

```bash
python3 scripts/actions-artifact-cleanup/cleanup.py \
  --run 40205298289 --run 40422618425 \
  --verify-within-window \
  --report /tmp/baocut-cleanup-verified.json
```

延长回滚窗口并保护某次运行：

```bash
python3 scripts/actions-artifact-cleanup/cleanup.py \
  --run 40205298289 --run 40422618425 \
  --rollback-days 14 --protect-run 40422618425 \
  --report /tmp/baocut-cleanup-protected.json
```

实际删除需要显式三个开关，以及有权限的令牌。在执行前冻结新的 tag 发布、workflow dispatch 和重跑；排空队列，确认没有任何仍需这些产物的外部消费者或计划重试。`--maintenance-window` 是操作者对这个事实的声明，脚本不会自动冻结仓库：

```bash
python3 scripts/actions-artifact-cleanup/cleanup.py \
  --run 40205298289 --run 40422618425 \
  --delete --confirm-repo JimLiu/baocut --maintenance-window \
  --report /tmp/baocut-cleanup-delete-preflight.json
```

先检查打印的逐项原因和 JSON。只打开 `--delete` 不会执行。删除前重新做完整检查，不接受旧报告作为授权。逐项结果写到 stdout；可用终端录制或重定向保存执行审计。JSON 是删除前的报告，不会被伪装成删除成功回执。

退出码：0 表示本次预览／执行完成，2 表示全局前置检查失败、参数不安全、互斥锁被占用或执行中止。单个运行的保留原因（包括校验失败）写入报告，不将保留项计入可释放空间。API 错误不会降低保护强度。真实删除中断后，先处理报错，再重新执行相同命令；不存在的 ID 会跳过，不重试不明确的 DELETE 失败。重复运行不会影响正式 Release。预计字节是 artifact API 的 `size_in_bytes` 之和，不是账户占用、本月计费量、退款或账单下降承诺。

## 安全边界

运行、产物和 Release asset 列表均分页；拒绝重复 ID、列表变化和 `total_count` 不完整，包含 GitHub 运行列表可能发生的 1000 条截断。全局枚举任何非 completed 运行都会暂停全部清理，覆盖 queued、waiting、pending、requested 和运行中状态，不依靠不完整的状态枚举。分页或权限不足时不继续删除。

手动 Windows 发布使用 `candidate_run_id`，运行列表不提供该输入。因此任何未完成流程都会阻止清理；已完成但失败／取消的 `desktop-windows-publish.yml` 也阻止清理，直到重试完成或人工审计并调整策略。不能凭“同一分支后面有成功运行”自动解除失败消费者的依赖。自动发布失败则永久被本脚本保留，直至自然过期；该策略宁可多留。

`source-guard.json` 钉住本次审阅的全部 workflow 及发布工具的 Git blob SHA；Mac workflow 接受补丁前后两种已审阅版本。新增、修改或删除流程、修改发布工具后全局停止，须先审阅新的 artifact 消费关系，再更新该文件；不要为了让清理通过机械刷新哈希。未来手动发布、外部脚本或重试计划的依赖不可由 GitHub 列表自动证明，须用 `--protect-run` 和维护窗口表达。

每个 DELETE 前重新检查 workflow 源码、仓库是否静默、artifact ID／digest／来源、运行状态／attempt／更新时间，以及 Release 与所有 asset 的指纹。下载期间发生 Release 修改也会保留。GitHub 没有跨运行、Release、删除请求的原子锁；仍存在最后一次 GET 到 DELETE 之间的竞态，因此维护窗口不可省略。只有本地进程锁，不能阻止其他机器或 GitHub 上的写入。

本脚本通过自动发布运行与全部发布报告的 candidateRunId、sourceCommit 关联产物；不下载 Actions artifact ZIP 做解包逐字节比对。Release 下载校验也不等同重新验证 Apple 签名／公证或执行 Windows 安装、GPU 推理。超出上述已知流程或无法确认依赖时保留。删除 artifact 不可恢复；保留正式 Release 可用于分发回滚，但不能保证旧的 `gh run download` 重试在删除后成功，窗口之后需要重新构建。

## 保留期补丁

`.github/workflows/desktop-macos-build.yml` 的唯一 `upload-artifact` 增加 `retention-days: 14`；Windows 三个矩阵变体沿用现有的 14 天。无仓库历史、运行记录或日志保留设置变更，无自动清理定时任务。

14 天为失败构建排障和发布重试留出时间；本脚本另以默认 7 天窗口判断已成功发布的存量。若需要更长重试窗口，应同时增加上传 artifact 的保留期；仅延长本脚本窗口不能推迟 GitHub 自动过期。

根据 [GitHub artifact 文档](https://docs.github.com/en/actions/tutorials/store-and-share-data) 和 [仓库保留设置文档](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)，artifact 可单独设保留期，保留期变更不追溯已有对象。不要用缩短整个仓库历史来代替存量清理。已有 build.82／83 的过期时间不会被此补丁修改；对旧 tag 的重跑仍使用该 tag 中的旧工作流。

## 验证

```bash
python3 scripts/actions-artifact-cleanup/test-cleanup.py -v
git diff --check
```

离线测试通过本地字节响应调用真实下载校验代码；不会访问 GitHub 或执行真实 DELETE。覆盖 dry-run、未发布、失败发布、手动生产者、运行中／排队、失败手动消费者、完整 Release、缺失／错误 checksum、损坏二进制、来源错误、回滚窗口、显式保护、下载故障、发布中途变化、删除前重跑／Release 变化、分页／截断／重复 ID、源码变化、删除开关、重复执行与只允许 artifact 删除的接口。

实际核对结果和未执行部分见交付附带的验证记录；离线测试成功不能当成真实删除、CI 构建或安装验收成功。此工具不改变产品 UI，无多端 UI 同步事项。

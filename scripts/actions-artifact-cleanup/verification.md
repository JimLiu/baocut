# 本次验证记录

所有运行／过期时间均为 UTC。代码基线：`8094551564d8c2d0b3ec7967731224ae98d6cb7c`。

## 实际读取与执行

通过 GitHub 连接和只读 REST 请求重新读取两次运行、全部 artifact、两个 Release 及工作流，未根据提醒邮件推断 CI 阻断，也未重读 Gmail。

| 项目 | build.82 | build.83 |
| --- | --- | --- |
| 运行 ID | 40205298289 | 40422618425 |
| 发布运行 | completed / success | completed / success |
| 未过期 artifact 数 | 4 | 4 |
| artifact 总字节 | 3,262,407,801 | 3,271,799,576 |
| Mac 过期 | 2027-01-23 15:05:36 | 2027-01-24 23:51:48 |
| Windows 过期日 | 2026-11-08 | 2026-11-10 |
| 默认 7 天窗口至少保留至 | 2026-11-01 16:25:16 | 2026-11-03 01:37:43 |

合计 6,534,207,377 字节（约 6.53 GB / 6.09 GiB），只是这两次运行的 artifact 体积。默认 dry-run 实际输出 8 项 KEEP，预计释放 0 字节。窗口到期仅代表可以再次评估，届时仍须重新核验 Release、消费者和源码。

仓库的 6 次手动 Windows 发布均为 completed / success。当前 `desktop-release.yml` 中 Mac 和 Windows 发布步骤会从本次运行下载产物；`desktop-windows-publish.yml` 则通过输入 candidate_run_id 下载旧产物。脚本据此保留来源不明和仍可能重试的候选。

完整只读下载核验完成于 `2026-10-28T05:10:14Z`：两个 Release 合计 48 个文件全部通过，包括 16 个安装包／ZIP 的实际流式大小与 SHA-256、16 个校验文件、8 个发布报告及 8 个 appcast。下载字节哈希与 GitHub asset digest 一致，sidecar 与报告一致，报告源提交及 candidateRunId 对应原始运行，appcast 指向各自 Release。下载后 Release 和 asset 指纹未变化。这是文件完整性和来源关联核验，不是安装运行测试。

| artifact ID | 平台／变体 | 字节 | 本次决策 |
| --- | --- | ---: | --- |
| 12606305274 | build.82 Windows CUDA | 1,647,657,361 | KEEP：已核验，7 天回滚窗口未满 |
| 12604876910 | build.82 Windows Vulkan | 551,633,252 | KEEP：已核验，7 天回滚窗口未满 |
| 12604297604 | build.82 Mac arm64 | 573,162,973 | KEEP：已核验，7 天回滚窗口未满 |
| 12604265747 | build.82 Windows CPU | 489,954,215 | KEEP：已核验，7 天回滚窗口未满 |
| 12702547594 | build.83 Windows CUDA | 1,650,036,995 | KEEP：已核验，7 天回滚窗口未满 |
| 12700400926 | build.83 Mac arm64 | 575,425,197 | KEEP：已核验，7 天回滚窗口未满 |
| 12699845162 | build.83 Windows CPU | 492,331,538 | KEEP：已核验，7 天回滚窗口未满 |
| 12699581202 | build.83 Windows Vulkan | 554,005,846 | KEEP：已核验，7 天回滚窗口未满 |

已运行 33 项离线测试，全部通过；已执行 Python 编译检查、diff 空白检查。用 YAML 解析器检查两个上传工作流，Mac 和 Windows 的 upload-artifact 保留期均为 14 天。未执行整仓库产品构建，因为没有产品代码变化。

## 未执行

- 未执行任何真实 DELETE，未修改或删除 GitHub Release、运行、日志、检查或提交状态。
- 补丁尚未推送到 GitHub，未在 GitHub Actions 上实际运行修改后的 YAML。
- 未解包 Actions artifact ZIP 与 Release 文件逐字节对照；关联依据是自动运行和全部发布报告的来源信息。
- 未重新执行安装、签名／公证、应用启动、UI、导出、GPU 推理验收。
- 未获取账户总存储或月度计费量，未验证账单或配额释放速度。

## 参考

- [build.82 运行](https://github.com/JimLiu/baocut/actions/runs/40205298289)
- [build.83 运行](https://github.com/JimLiu/baocut/actions/runs/40422618425)
- [build.82 Release](https://github.com/JimLiu/baocut/releases/tag/baocut-v3.11.0-build.82)
- [build.83 Release](https://github.com/JimLiu/baocut/releases/tag/baocut-v3.12.0-build.83)
- [GitHub artifact 保留期](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [GitHub 仓库保留设置](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)

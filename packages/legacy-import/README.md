# legacy-import

v1 / v2 项目到 `baocut.video` 的转换核心，供 Runtime 启动升级和归档的手动导入脚本共用。启动检测、设置与凭据的所有权在 `runtime-core`，见[架构设计 §2.7](../../docs/architecture/architecture-design.md#27-历史版本的启动迁移)。

Windows 历史版本只有 v2；目录检测与项目转换不会进入 v1 适配器。Windows 盘符和 UNC 路径按本机路径语义处理，设置与凭据迁移见上述架构章节。

## 入口

- `planBcutProject`：v2 项目到导入计划；相对素材路径以旧项目为基准。
- `v1-project.ts`：v1 的 `doc.json`、索引元数据和 PCM 音频适配；参考 baocut-app 的 `upgrade.rs`、`legacy_edit_migration.rs`，不原位升级。
- `EngineHost` / `writeVideo`：只经引擎协议写入，固定事务 ID 支持断点重跑。
- `worker.ts`：单项目导入进程，随桌面构建为 `legacy-import-worker.js`。以低于正常的优先级串行执行，首次项目清单由 Runtime 缓存，完整完成后不再扫描。父进程通过 IPC 取消；父进程消失也收尾引擎。新导入视频集中在默认项目目录的 `Imported/` 下，每个视频有独立目录与报告；已有检查点保留原布局。报告留在对应视频目录中，失败与素材缺失使进程返回非零。

完整 v2 映射、已知转换限制和手动命令见[导入器说明](../../scripts/legacy-import/README.md)。原有报告词汇保留以兼容历史报告。不能映射的旧字段保留在原始目录，导入报告记录相关省略项。

## 验证

```bash
npm run typecheck
npm test -- packages/legacy-import/src/v1-project.test.ts packages/runtime-core/src/legacy-upgrade.test.ts packages/runtime-core/src/legacy-upgrade-v1-keys.test.ts
BAOCUT_ENGINE_HOST=target/debug/engine-host node --test scripts/legacy-import/legacy-import.test.ts
```

原生集成测试使用临时合成素材，不读真实历史数据或系统钥匙串。缺少 ffmpeg 或引擎时对应原生项目测试跳过；v1 字幕分句使用 `npm run build:wasm` 生成的编辑语义。

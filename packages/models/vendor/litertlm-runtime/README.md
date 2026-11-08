# LiteRT-LM C 库（Windows x64）

本机语义检索的 EmbeddingGemma 2 模型包经 LiteRT-LM 的 C API 编码（[检索规格 §4.3](../../../../docs/design/embedding/embedding-retrieval-spec-v0.1.md#43-平台发布矩阵)）。上游只为 macOS 发布 C 库，Windows x64 的这份由 BaoCut 从上游源码构建，随 Windows 安装包分发（不下载）：

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `litertlm-runtime-0.18.0-win32-x64.zip` | 8216413 | `1ad5268a52946467f1a8e419a7af801d666a8ac166c23753e2e296fe4c9b8aa3` |
| 其中的 `litert-lm.dll` | 20400640 | `2e0a9f9cbf939f215f409777d11463a2d165825b233a7924441ce88a40656a6c` |

压缩包根目录是 `litert-lm.dll` 与上游 `LICENSE`（Apache-2.0）；DLL 静态链接的第三方组件与它们的许可原文在 [`packages/models/licenses/litert-lm.txt`](../../licenses/litert-lm.txt)。登记（大小、sha256、库名）在 [`embedding-bundles.ts`](../../src/embedding-bundles.ts) 的 `LITERTLM_RUNTIME_RELEASE.bundled`；打包脚本与 `npm run build:litertlm-runtime`（[`tools/fetch-litertlm-runtime.ts`](../../../../tools/fetch-litertlm-runtime.ts)）按登记核对后解开，`embedding-bundles.test.ts` 核对这份文件与登记一致。

## 来源

- 上游：[google-ai-edge/LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM) 标签 `v0.18.0`（提交 `b2f686e2ed4718fb84ec398a61dd59ca0f0aff27`），源码未改。
- 目标：`//c:litert-lm`（`c/BUILD` 里的 `cc_binary`，`linkshared = 1`），导出 Worker 用到的全部 `litert_lm_*` 函数（`crates/model-runtime/src/embed/litert.rs`）。
- 构建：2026-11-08，Windows 11 x64（i7-12700F），Bazel 7.6.1（`.bazelversion`，经 bazelisk 1.30.0），Visual Studio 2022 Build Tools（MSVC 14.44），沿用上游 `.bazelrc` 的 `windows` 配置（与上游 ML-CI-Win 相同：`-c opt`、`/arch:AVX2`、`--config=monolithic`）。只多给一个上游提供的开关 `--define=LITERT_LM_FST_CONSTRAINTS_DISABLED=1`：关掉 Gemma 对话的 FST 约束解码，DLL 就不链接上游 `prebuilt/` 里的预编译 `libGemmaModelConstraintProvider.dll`（嵌入用不到它）。
- 依赖：只有 Windows 系统 DLL 与 Microsoft Visual C++ v14 运行库（`MSVCP140.dll`、`VCRUNTIME140.dll`、`VCRUNTIME140_1.dll`、`VCRUNTIME140_THREADS.dll`），与 BaoCut 的 Windows 版对 VC++ 运行库的要求相同，包里不带。CPU 要 AVX2，与 Windows 版 Worker 的基线一致。只用 CPU（不带 GPU 委托）。

## 重建

在开了「开发者模式」（Bazel 与 `rules_rust` 要建符号链接）的 Windows x64 上，装好 VS 2022 Build Tools（C++ 工作负载）、Git for Windows 与 Python 3，在仓库外的短路径下：

```bat
git clone --depth 1 --branch v0.18.0 https://github.com/google-ai-edge/LiteRT-LM src
cd src
call "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set "BAZEL_VC=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC"
set "BAZEL_SH=%ProgramFiles%\Git\usr\bin\bash.exe"
rem 仓库规则的补丁命令要 sed：Git 的 usr\bin 放在 PATH 最后，免得它的 link.exe 盖过 MSVC 的。
set "PATH=%PATH%;%ProgramFiles%\Git\usr\bin"
bazelisk --output_user_root=D:/lb build --deleted_packages=swift --build_tag_filters=-nowindows --define=LITERT_LM_FST_CONSTRAINTS_DISABLED=1 -- //c:litert-lm
```

产物是 `bazel-bin/c/litert-lm.dll`（首次约 11 分钟，20 线程）。把它与上游 `LICENSE` 放进一个根目录只有这两个文件、deflate 压缩、不带 ZIP64 的 zip（[`tool-archive.ts`](../../src/tool-archive.ts) 只认这些）；第三方许可按 `bazel cquery --notool_deps --noimplicit_deps "deps(//c:litert-lm)"` 列出的外部仓库，从 Bazel 的 `external/` 收集它们的许可文件。换了构建就更新登记的大小与 sha256，并在 Windows 上跑参考向量回归（`tools/embedding-eval/reference-vectors.ts`）：`win32-x64/cpu` 的任何一条余弦低于 0.9999 时按检索规格 §5.3 处理。

## 2026-11-08 的验证

- `dumpbin /EXPORTS`：Worker 解析的 31 个符号都在；`dumpbin /DEPENDENTS`：只有系统 DLL 与上面的 VC++ 运行库。
- BaoCut 的 `ModelInstaller` 在 win32 上安装两个模型包：库组件已装好（`keep`），只下载权重，`verify` 通过。
- Model Worker（`backend-litert`）在 CPU 上编码：文字 512 维，与 `darwin-arm64/cpu` 的参考逐条余弦 0.99948–1.0，参考帧 0.99476；参考向量写入 `win32-x64/cpu`，复跑一致。
- 产品级检索评测（`tools/embedding-eval/search-eval.ts`，文字集）：`text/semantic` 与 `text/hybrid` 的 R@1 0.815、R@5 1、MRR 0.901，与 2026-10-13 的 macOS 基线相同。

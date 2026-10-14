# embedding-eval：EmbeddingGemma 2 的 G0 上游适配评测

本目录是[语义检索规范 v0.1](../../docs/design/embedding/embedding-retrieval-spec-v0.1.md) §18.3「G0 上游适配门槛」的可复现脚本与夹具。它只属于开发评测：最终用户不安装 Python，产品后端是 Rust Model Worker 里的 LiteRT-LM（规范 §4.1）。

脚本比较两条路线在同一批输入上的结果：

- **参考后端**：`google/embeddinggemma-2` 原始检查点，SentenceTransformers 只加载文字编码器，FP32 与 BF16（不得用 FP16，模型卡 §Numerical Precision）。
- **量化后端**：`litert-community/embeddinggemma-2-text-270m-litert-lm` 的 CPU/GPU 通用包，经 `litert-lm-api` 轮子（Python ctypes）与 `CLiteRTLM_mac.xcframework`（C API）两种方式调用。

结论与数值见 [`reports/`](reports/)。所有阈值都是**未校准的建议起点**，夹具很小，不能替代 §18.1 的标注集校准。

## 目录

| 路径 | 内容 |
| --- | --- |
| `pyproject.toml`、`uv.lock` | 钉住版本的 Python 依赖 |
| `profiles.py` | 所有送入模型的字符串都在这里拼：检索前缀配对（`promptPairId` 候选；锁定的 `modelcard-v1` 在 Runtime 里叫 `model-card-v1`）、对称 profile、夹具读取 |
| `embed-reference.py` | 参考后端编码全部输入，并做确定性、截断、空白敏感性、延迟检查 |
| `embed-litert.py` | LiteRT-LM（轮子）编码，CPU 或 GPU；附带引擎创建耗时、缓存文件、`output_size`、单条与批量、长输入、RSS |
| `check-c-api.py`、`c-smoke/embedding-smoke.c` | 用 xcframework 的 C API 编码同一批输入，与轮子结果逐向量比较；同时比较 FP32 与默认激活精度 |
| `score.py` | 只读缓存，算检索、跨后端、向量一致、对称对与术语误听的指标，输出指标 JSON 与阈值建议 |
| `sample-frames.py` | 多模态 G0：从本机视频按时间均匀取帧（ffmpeg 只读源文件，长边 512 的 JPEG），写帧与 `manifest.json` 到仓库外的 `frames-eval/` |
| `embed-frames.py` | 多模态 G0：740m 包的视觉编码器编码每一帧、文字编码器编码查询（三套前缀）；CPU、GPU 默认激活、GPU FP32 激活，可选每图视觉 token 数 |
| `score-frames.py` | 多模态 G0：全库与单部视频两种范围的 R@1/R@5/MRR，按查询类型与画面类别分开；无答案查询的最高分；各次运行之间的余弦 |
| `chapter-boundaries-eval.ts` | 章节边界候选的校准（Node，不用 Python）：`export` 只读打开一个 BaoCut 主目录的语义索引，按 `--truth`（`{ "<videoId>": [秒, …] }`，作者章节）导出句群的时间与向量（不带文字）；`score` 在 k、窗口、最短章节长度的网格上算 ±15 秒内的精确率、召回率与 F1。测试在 `tools/chapter-boundaries-eval.test.ts` |
| `search-eval.ts` | 产品级检索评测（Node）：走真的 `space.searchV2`（内容索引、语义库、增量构建、融合、去重、弱命中），不只测模型。文字用 `fixtures/` 的句群（每个句群一部合成视频）与标注查询；`--frames <frames-eval 目录>` 再加多模态 G0 的标注帧（每部视频的帧排成一个合成素材）。按路线（文字 `hybrid` / `semantic` / `lexical`、画面、文字加画面）与查询类别出 R@1/R@5/R@10/MRR 与弱命中的两面（`strongPerQuery`、`relevantWeak`、`noAnswerStrong`）。用本机装好的模型包与 Model Worker（`--models`、`--tools` 只读，不安装、不自检）。改排序、融合或弱命中阈值时报改前改后的数字。测试在 `tools/search-eval.test.ts` |
| `reference-vectors.ts` | 参考向量回归（Node）：用本机装好的每个嵌入模型包把 `fixtures/` 里固定的几句文字与合成帧 `reference-frame.jpg` 编码，与 `fixtures/reference-vectors.json`（按平台 / 设备 / 模型包存）比，余弦低于 0.9999 就报不一致。`encoderProfileId` 只带向量兼容标签 `EMBEDDING_VECTOR_COMPAT`、不带 LiteRT-LM 版本：升级引擎后靠它决定标签要不要加一；`--write` 重新生成参考。测试在 `tools/embedding-reference.test.ts` |
| `fixtures/` | 手写的合成夹具，无用户媒体（`frame-labels.example.json` 只是多模态标注的格式示例，真实标注在仓库外）：`corpus.json`（57 个句群）、`queries.json`（34 条标注查询）、`symmetric-pairs.json`（54 对）、`glossary.json`（36 对） |
| `reports/` | 评测报告、指标 JSON 与阈值建议 JSON |

## 外部文件放在哪里

权重、虚拟环境、uv 缓存、LiteRT 编译缓存和向量缓存都不得放进仓库。默认根目录是 `/Volumes/ExtremeSSD/Models/embeddinggemma-2`，可用环境变量 `BAOCUT_EMBED_EVAL_ROOT` 改：

```text
$BAOCUT_EMBED_EVAL_ROOT/
  venv/                         uv 项目环境（UV_PROJECT_ENVIRONMENT）
  uv-cache/                     UV_CACHE_DIR
  hf-home/                      HF_HOME（离线运行时不写入）
  weights/google-embeddinggemma-2/      参考检查点
  weights/litert-text-270m/embeddinggemma-2-text-270m.litertlm
  litert-lm-0.18.0/CLiteRTLM_mac.xcframework/   C API（头文件 + dylib）
  litert-cache/  litert-cache-c/   LiteRT 引擎缓存（必须预先存在）
  eval-cache/                   各后端的向量 .npz 与运行清单 .json
  weights/litert-740m/embeddinggemma-2-740m.litertlm   多模态 G0 用的完整包
  chapters-eval/                章节边界校准的数据集与结果（向量取自用户自己的视频，不进仓库）
  search-eval/                  产品级检索评测的工作目录：临时内容索引与语义库（向量按内容寻址，重跑不重编）、LiteRT 缓存、每条查询的明细
  frames-eval/                  多模态 G0：videos.tsv、frames/、manifest.json、labels.json、runs/（取自用户自己的视频库，不进仓库）
  build/                        C 冒烟程序与输入文件
```

## 钉住的版本

| 项目 | 版本 / 校验 |
| --- | --- |
| Python | 3.12（Homebrew 3.12.4） |
| torch / torchvision | 2.14.1 / 0.29.1 |
| transformers | 5.19.0（模型配置写的是 5.18.0.dev0；5.19.0 已能加载 `EmbeddingGemma2Model`） |
| sentence-transformers | 6.1.0（模型卡要求 ≥ 6.1.0） |
| litert-lm-api | 0.18.0，`litert_lm_api-0.18.0-py3-none-macosx_12_0_arm64.whl` sha256 `9fd0c55835e469a035c1b75cde4797b26292963c2c36d9fcdfceb965ffa08a37`；包内 `liblitert-lm.dylib` sha256 `cbec999a8156f10d277484ad3c6b6d9ac012375c4a03019aa1b0eab68ccaa4e9` |
| CLiteRTLM_mac.xcframework | LiteRT-LM 0.18.0；zip sha256 `5f6ee68d95eeccb084c6e66d5ee47255e3020fa0fb29696dd0301ae26d6cfb4f`，`libCLiteRTLM_mac.dylib`（arm64 + x86_64）sha256 `9526db9ee35e7eb4a5a58ac1e53330032f22a13890bd4ee01818fb380a57a362` |
| `google/embeddinggemma-2` | commit `914f7f89142e33e77833254d9c9b90c3cef7303b`；`model.safetensors` sha256 `197a32965d4b1105faf060417baa899e193fb73cd401f42ec9295234d5553d79`，`tokenizer.json` `4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4`，`tokenizer.model` `e594c8a90eb08d8bda498ff4747977dc827ae0c3c56b5c0d41a605a22d02ef03` |
| `litert-community/embeddinggemma-2-740m-litert-lm` | commit `24d962e906c7d332c6428e71c9676855024569e2`；`embeddinggemma-2-740m.litertlm`（484,622,336 字节）sha256 `e7a8a2204b91e0f96e92960e84a09a89212e1633dcb7575a9bf3378b4df77f4c` |
| `litert-community/embeddinggemma-2-text-270m-litert-lm` | commit `9be6e8b90982095dc05c2bd162e4b954ee4dbac7`；`embeddinggemma-2-text-270m.litertlm`（164,626,432 字节）sha256 `2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb` |

其余传递依赖见 `uv.lock`。

## 复现

先确认系统盘余量（`df -h /System/Volumes/Data`），重的东西都写到外置盘。

```sh
export BAOCUT_EMBED_EVAL_ROOT=/Volumes/ExtremeSSD/Models/embeddinggemma-2
export UV_CACHE_DIR=$BAOCUT_EMBED_EVAL_ROOT/uv-cache
export UV_PROJECT_ENVIRONMENT=$BAOCUT_EMBED_EVAL_ROOT/venv
export HF_HOME=$BAOCUT_EMBED_EVAL_ROOT/hf-home HF_HUB_OFFLINE=1
export TRANSFORMERS_VERBOSITY=error TOKENIZERS_PARALLELISM=false

# 1. 依赖（uv.lock 已钉住）
cd tools/embedding-eval && uv sync --frozen --python 3.12

# 2. 权重：按上表的 commit 下载，然后核对 sha256
R=$BAOCUT_EMBED_EVAL_ROOT/weights
B=https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b
for f in 1_Pooling/config.json 2_Normalize/config.json config.json config_sentence_transformers.json \
  modules.json preprocessor_config.json processor_config.json sentence_bert_config.json \
  tokenizer.json tokenizer.model tokenizer_config.json chat_template.jinja model.safetensors; do
  mkdir -p "$R/google-embeddinggemma-2/$(dirname $f)"
  curl -fL "$B/$f" -o "$R/google-embeddinggemma-2/$f"
done
mkdir -p $R/litert-text-270m
curl -fL https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/9be6e8b90982095dc05c2bd162e4b954ee4dbac7/embeddinggemma-2-text-270m.litertlm \
  -o $R/litert-text-270m/embeddinggemma-2-text-270m.litertlm
shasum -a 256 $R/google-embeddinggemma-2/model.safetensors $R/litert-text-270m/*.litertlm

# 3. 编码（每步写 eval-cache/<run>.npz 与 <run>.json）
PY=$UV_PROJECT_ENVIRONMENT/bin/python
$PY -I embed-reference.py --dtype fp32
$PY -I embed-reference.py --dtype bf16
$PY -I embed-litert.py --backend cpu --cold   # --cold 先删引擎缓存，量冷启动
$PY -I embed-litert.py --backend gpu --cold
$PY -I check-c-api.py                         # 需要 xcframework 与 clang

# 4. 打分
$PY -I score.py --out reports/g0-<日期>-metrics.json --thresholds-out reports/g0-thresholds-proposal.json
```

`-I` 让解释器不从当前目录加载模块；脚本自己把本目录加进 `sys.path`。

多模态 G0（[报告](reports/g0-multimodal-2026-10-13.md)）另走一条：

```sh
F=$BAOCUT_EMBED_EVAL_ROOT/frames-eval
# videos.tsv 每行：类别<TAB>帧数<TAB>标题<TAB>视频绝对路径；只读源文件
$PY -I sample-frames.py $F/videos.tsv --out $F
# 看帧写 $F/labels.json（格式见 fixtures/frame-labels.example.json）
$PY -I embed-frames.py --run cpu
$PY -I embed-frames.py --run gpu
$PY -I embed-frames.py --run gpu-fp32
$PY -I embed-frames.py --run cpu --vision-tokens 70   # 实测 140 与默认相同，280、560 建引擎失败
$PY -I score-frames.py --out reports/g0-multimodal-<日期>-metrics.json
```

每次运行用一份新的引擎缓存（约 300–370 MB），跑完删掉。

## 夹具约定

- 全部是手写的合成文本，不含用户媒体或真实文稿；键与分类值用英文标识，文本内容中英文混排。
- 送入模型前先去掉首尾空白，再拼前缀（LiteRT-LM 文档要求）；参考后端实测尾部空白会让向量明显变化，见报告。
- `queries.json` 的 `relevant` 列出所有相关句群；`no-answer` 查询语义上贴近主题但夹具里没有答案。
- 改夹具后要重跑第 3、4 步：向量缓存按格式化后的字符串查找，缺字符串会直接报错。

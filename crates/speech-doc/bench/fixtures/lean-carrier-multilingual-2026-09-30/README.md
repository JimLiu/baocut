# Lean carrier 多语言基准（2026-09-30）

这份固定数据集用于回放 `lines/1` 翻译载体、源侧引用定位和字幕切分的结果。基线来自提交 `d59f06d23`，模型为 DeepSeek V4.1 Flash（`deepseek-flash`）。仓库只保存测试文本和结果；回放脚本不会调用模型或修改 `.bcut` 项目。

## 范围

| 来源 | 抽样 | 目标语 |
| --- | ---: | --- |
| `东京旅行行程推荐-10_taRWL9Ao`（韩文） | 12 / 73 句 | 简体中文 |
| `8 个必装 Skill - 顶级 AI 生产力`（中文） | 12 / 84 句 | 英文 |
| `东京观光：15 处推荐景点`（日文） | 12 / 189 句 | 简体中文 |
| 阿拉伯文、德文、西班牙文、土耳其文、印地文、泰文合成源文 | 各 8 句 | 每种 6 句英文、2 句简体中文 |
| 英文合成源文 | 8 句 | 阿拉伯文 |

真实项目每个按句序均匀取 9 句，再补 3 个未选中的最长句。源文、词、词 ID 与时间来自当时的 `studio/data.json` 和 `transcript.json` 快照；完整媒体、全部项目语料及本机项目路径不在仓库中。合成文本由 Agent 编写，`reference_en` 是内容审查辅助，不是人工金标。日文项目当时已产生转录，本基准不依赖其历史译文。

## 文件

- [`dataset.json`](dataset.json)：92 句的来源、源文、源词、实际或缺省时间信息与合成样本的风险标签。只有真实项目的句子有 `word_times`。
- [`pages/`](pages/)：16 页实际评分的 HTML 源载体及逐句 manifest。页内句序、预算和词引用保持原样。
- [`requests.json`](requests.json)、[`fix-requests.json`](fix-requests.json)：首轮和一次定向修复的模型请求文本。修复轮通过 `retry_reason` 强调目标语言；不要把首轮和修复后成绩混作一次调用的效果。
- [`responses/`](responses/)：对应的 16 次首轮和 9 次修复的原始模型正文与耗时；文件名与页名一一对应。
- [`baseline.json`](baseline.json)：按页、按句保存首轮与修复后的评分，另有逐语言汇总、总 token 用量、构建摘要和有限形状的交叉区间探针结果。
- [`semantic-audit.json`](semantic-audit.json)：Agent 对 48 条合成源文的内容核查，46 条未发现核心事实错误、2 条明确有误；不代表母语人工盲评。
- [`property-results.json`](property-results.json)：10 种源语言 × 100 种双区间组合的交叉判定探针。
- [`comparison.svg`](comparison.svg)：逐语言译文接收与直接对齐图。

本轮首轮 **51/92** 句译文被接收、**38/92** 句直接对齐；一次修复后是 **87/92** 和 **74/92**。`baseline.json` 的 `strictFirst` 是当时用相同响应关闭新增块内重切后得到的诊断值，首轮直接对齐为 36/92；标准回放脚本只验证生产逻辑的 `first` 与 `merged`。这些是载体和规划器结果，不是翻译准确率。合成集有两条内容错误，其中一条仍被判为 `aligned`。

## 离线回放

从仓库根目录运行：

```bash
cd core && cargo build --locked -p bcut-flow-core --example lean_carrier_grade
cd ..
BCUT_BENCH_TARGET="$(cd core && cargo metadata --no-deps --format-version 1 \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
python3 scripts/bench/replay_lean_carrier_multilingual.py \
  --grader "$BCUT_BENCH_TARGET/debug/examples/lean_carrier_grade"
```

脚本逐页重算、合并修复结果，并核对全部 92 句的状态、译文、问题码和总计；成功时输出 `ok: 92 samples ...`。由于基线精确比较模型文本和规划器结果，有意更改协议或算法时，应审阅每条差异后再建立新基线。

首轮模型有不少源语言原样返回，修复轮让大多数恢复；中文→英文还有 5 句因回答格式不合法而缺译。泰文 8 句均只达到整句对应；本合成集使用 `atomize` 构造源原子，不能由此推断真实泰文项目的错误率。

# 注音内嵌数据

本目录是 `model_runtime::synthesize::readings`（TTS 合成前的多音字注音，架构设计 §6.1「读音标注」）的内嵌数据，
原样带自 v2 `bcut-tts/src/text/data/`（逐字节相同）。
`*.z` 为 zlib（deflate）压缩，经 `include_bytes!` 编进二进制、首次使用时解压；由 v2 仓库（`baocut-app`）的 `scripts/dev/gpt-sovits-text/gen_heteronyms.py` 生成，**勿手改**（生成器没有带进 v3）。
`context_heteronyms.txt` 是手工审定的清单，改它之后重跑脚本（脚本校验每个字都在多音字表里）。

## 重新生成

在 v2 仓库（`baocut-app`）里跑：

```bash
python scripts/dev/gpt-sovits-text/gen_heteronyms.py
```

venv 同那里的 `scripts/dev/gpt-sovits-text/README.md`「环境」（只用到 pypinyin）。改了数据要同步下表的 SHA-256：`cargo test -p model-runtime synthesize::readings` 会对拍。

## 文件、来源与许可

| 文件 | 原始字节 | 压缩后字节 | SHA-256（压缩后） |
| --- | ---: | ---: | --- |
| `heteronyms.txt.z` | 132,672 | 50,959 | `4f8ba881821bb736debb4e004eff9ccfb9dcde61a06f5541f1eafaf0bef133cd` |
| `homophones.txt.z` | 7,421 | 3,763 | `5703be51234a477ccbd7ea8a0e693540e35c2f38c786cd6409b4d459c3cc460b` |

| 文件 | 来源 | 许可 | 内容与格式 |
| --- | --- | --- | --- |
| `heteronyms.txt.z` | pypinyin 0.55.0 `PINYIN_DICT`（数据源 mozillazg/pinyin-data） | MIT | U+4E00–U+9FA5 里有两个及以上读音的 6,204 个字，每行 `字\t默认读音\t全部读音`；读音为 `Style.TONE3`（轻声 `5`，ü 写 `v`），默认读音即 pypinyin 单字默认 |
| `homophones.txt.z` | 同上 `PINYIN_DICT` / `PHRASES_DICT`，词频取 GPT-SoVITS 内嵌的 jieba 词典（`../../gpt_sovits/text/data/jieba_dict.txt.z`，MIT） | MIT | 804 个读音（全部 1,496 个）各一个代表字，每行 `读音\t字`：只有这一个读音、不是繁体、在任何词组里都不被读成别的音、含该字词条的 jieba 词频合计 ≥ 1,000，取词频最高者 |
| `context_heteronyms.txt` | 手工审定 | 本仓库 | 语境多音字清单，221 个字；`annotate` 只把这些字列为候选 |

上游：`mozillazg/python-pinyin`（pypinyin 0.55.0，MIT）。

# 内嵌数据

本目录的 `*.z` 均为 zlib（deflate）压缩，运行时由 `flate2::read::ZlibDecoder` 解压，经 `include_bytes!` 编进二进制。
全部由 v2 仓库（`baocut-app`）`scripts/dev/gpt-sovits-text/` 下的 `gen_jieba.py` 与 `gen_data.py` 生成，**勿手改**；`../symbols.rs` 也由 `gen_data.py` 生成。
v3 原样带来 v2 `bcut-tts/src/gpt_sovits/text/data/` 的文件（逐字节相同），生成器没有带进 v3。

## 重新生成

在 v2 仓库（`baocut-app`）里跑；上游源码、venv 与 NLTK 数据的准备见那里的 `scripts/dev/gpt-sovits-text/README.md`。

```bash
python scripts/dev/gpt-sovits-text/gen_jieba.py
GSV_UPSTREAM=… NLTK_DATA=… python scripts/dev/gpt-sovits-text/gen_data.py
```

改了数据要同步下表的 SHA-256：`cargo test -p model-runtime synthesize::gpt_sovits::text` 会对拍。

`g2p_gru.f32` 是浮点权重，几乎不可压缩，不做 zlib。

脚本会用紧凑表复刻 `lazy_pinyin`，与真实 pypinyin 对拍全部 47,111 个词组和 20,000 条随机串，不一致即失败。

## 文件、来源与许可

| 文件 | 原始字节 | 压缩后字节 | SHA-256（文件） |
| --- | ---: | ---: | --- |
| `pinyin_syllables.txt.z` | 8,872 | 3,439 | `88969d0f27540581f65e427064f59c38341f12806d19530bde427e6daa449f5b` |
| `pinyin_chars.bin.z` | 41,804 | 31,524 | `881c8694996516e5a251f5073c882e168b68391a6e0f10eefe6cb33b637b3e8a` |
| `pinyin_phrases.txt.z` | 586,933 | 275,196 | `3e5ca1aff377cd58a7e62640182c8016455341f7911b9bacfcb4da3fd4154ee9` |
| `t2s.txt.z` | 16,236 | 11,770 | `34e420558351cd4db67e89c0516fbcc18bdfc78027580bc1d259b1c0ce8747e5` |
| `opencpop_strict.txt.z` | 4,084 | 1,721 | `5d20e2f3b8885c4e87e9bf87f6e822e0a77bec3e827f98cc2bc8494fa7208dfd` |
| `cmudict.txt.z` | 3,303,389 | 861,036 | `2de4996ebfda2c43d5bcabdd65b0342c07db69443746ff1b6cdfb1fb9846b7e6` |
| `namedict.txt.z` | 468,175 | 147,160 | `c7760e7a1c5c7e114a987a39cd3a64f87b13ae2391de574a17847fecb522eb1d` |
| `homographs.txt.z` | 18,395 | 4,653 | `e6fad2bf1293e6b0cff52164a906ab14713e7569d4fbd13c96ac420cb4edb47e` |
| `en_tagger.bin.z` | 1,291,887 | 919,620 | `a5a5a6cbf8f3824a0fba7f26b838d6b0128ec16698e53f02f49695c11cf4c5ac` |
| `wordsegment.bin.z` | 4,612,500 | 2,969,358 | `aecaadd227249658a822563bd187832f75908678032ed4a9c9b25b5a1bdbff4f` |
| `g2p_gru.f32` | 3,339,560 | 3,339,560 | `9216fed77d19d94395f148c9a4fab3553dd0a90298fe833f38f2dc0d707c8369` |
| `jieba_dict.txt.z` | 5,071,852 | 1,904,746 | `3f2604590b7e430157c35cc087f8c177ed704a4ea5d0829d8641081c0edf00cd` |
| `jieba_finalseg.bin.z` | 352,416 | 193,890 | `93fd6a2a3a2bf13c9e8b67e9ad0ecd87264f38c449799fa366a6f026a668ba0c` |
| `jieba_posseg.bin.z` | 1,030,490 | 594,354 | `d6a4114523bb615d114deacd07e86d588c1b0080daab327c167c80fb2d67796d` |
| **合计** | **20,146,593** | **11,258,027** |  |

| 文件 | 来源 | 许可 | 内容与格式 |
| --- | --- | --- | --- |
| `pinyin_syllables.txt.z` | pypinyin 0.55.0（数据源 mozillazg/pinyin-data、phrase-pinyin-data） | MIT | 每行 `声母\t韵母`，即 `Style.INITIALS` / `Style.FINALS_TONE3`（strict，`neutral_tone_with_five=True`）的预计算结果；行号为音节 id |
| `pinyin_chars.bin.z` | 同上 `PINYIN_DICT` | MIT | U+4E00–U+9FA5 共 20,902 个 u16 LE，取默认（第一个）读音的音节 id，`0xFFFF` 表示无拼音 |
| `pinyin_phrases.txt.z` | 同上 `PHRASES_DICT` | MIT | 全部 47,111 个词组按码点排序（mmseg 前缀匹配需要全量词条）；只有整词读音与逐字默认读音不同的 8,756 条带 `\t音节id…` |
| `t2s.txt.z` | GPT-SoVITS `text/zh_normalization/char_convert.py`（源自 PaddleSpeech） | Apache-2.0 | `t2s_dict` 中繁≠简的 2,706 对，逐对「繁简」两个字符相连（与上游循环构表一致，后出现者覆盖） |
| `opencpop_strict.txt.z` | GPT-SoVITS `text/opencpop-strict.txt` | 随 GPT-SoVITS 仓库分发（MIT） | 每行 `拼音\t声母 韵母` |
| `cmudict.txt.z` | GPT-SoVITS `text/engdict_cache.pickle`（上游运行时实际读取的缓存；与 `cmudict.rep` 第 57 行起 + `cmudict-fast.rep` 重建结果对比：键差 0、值差 0）+ `engdict-hot.rep` 覆盖，删去 ae/ai/ar/ios/hud/os | CMUdict：BSD 风格（CMU）；GPT-SoVITS 增补：MIT | 每行 `词\t音素…`，只保留分词后可能出现的键（`[a-z]([a-z'-]*[a-z])?`），共 124,990 条 |
| `namedict.txt.z` | GPT-SoVITS `text/namedict_cache.pickle` | 随 GPT-SoVITS 仓库分发（MIT） | 同上格式，只保留不在 CMU 表中的 19,929 条（上游先查 CMU 再查姓名） |
| `homographs.txt.z` | g2p-en 2.1.0 `homographs.en`，含上游 `en_G2p` 对 read / complex 的覆盖 | Apache-2.0 | 每行 `词|读音1|读音2|词性1` |
| `en_tagger.bin.z` | NLTK `averaged_perceptron_tagger_eng`（nltk_data；模型源自 sloria/textblob-aptagger） | MIT | varint 类别表；front-coded 词表 + 每词 1 字节类别；front-coded 特征名 + 每特征 `(类别 u8, zigzag varint 千分权重)`，共 75,447 个特征、271,206 个非零权重（丢弃 0 个零权重，对得分无影响） |
| `wordsegment.bin.z` | wordsegment 1.3.1 `unigrams.txt` / `bigrams.txt`（Peter Norvig 基于 Google Web Trillion Word Corpus 的词频） | Apache-2.0 | 两张表：`varint 条数` + front-coded 键 + varint 计数；unigram 333,213 条，bigram 只留首词在 unigram 表中的 249,528 条（其余 8,909 条 `score` 永远查不到） |
| `g2p_gru.f32` | g2p-en 2.1.0 `checkpoint20.npz` | Apache-2.0 | 12 个 f32 LE 张量按固定顺序直接拼接：`enc_emb` 29×256, `enc_w_ih` 768×256, `enc_w_hh` 768×256, `enc_b_ih` 768, `enc_b_hh` 768, `dec_emb` 74×256, `dec_w_ih` 768×256, `dec_w_hh` 768×256, `dec_b_ih` 768, `dec_b_hh` 768, `fc_w` 74×256, `fc_b` 74 |
| `jieba_dict.txt.z` / `jieba_finalseg.bin.z` / `jieba_posseg.bin.z` | jieba_fast（`gen_jieba.py` 导出） | MIT | 词典、HMM 分词与词性 HMM 参数 |

上游 commit：`RVC-Boss/GPT-SoVITS@48b1a0169a28582a8984402f82cf438d3bfa6aca`（MIT）。

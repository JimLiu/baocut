---
# 来自 Manus tts-prompter skill
description: 旁白首稿的语言语速参考：按语言、地区、计数单位与速率估算预算；有时长约束且尚无当前配置样音时读。
---

# 旁白语言语速参考表

## 适用范围与校准条件

用于有时长约束、尚无当前配置样音时的**首稿预算**；没有时长约束的纯朗读不需要套表。实际模型支持哪些语言与音色仍以能力查询为准，这张表不是 BaoCut 的支持清单。

下表是首稿估算用的经验基线，未在 BaoCut 的各模型中逐一复测。

- 场景：视频画外旁白，纪录片式、自然平稳的语速。
- 校准记录：TTS 引擎默认配置、音色 `Charon`，每种语言 2 个样本；具体引擎版本与样本明细未记录。该音色只记录校准条件，不是选音色的建议。
- 提示前缀：`Read this as a documentary narrator at a natural, steady conversational pace:`。这是校准时的输入格式，BaoCut 仍将表演说明与台词分字段传入。
- `Unit`：`chars` 表示字符，`words` 表示词；`Rate` 是每秒音频包含的单位数。按每行的 Unit 计数，不把各语言统一换成英语词数。
- 其他表演风格的速率可能约偏离 ±25%，音色影响约 ±5%；这些是校准记录中的经验值，不是跨模型误差上界或时长保证。

## 怎么用

1. 按目标语言及地区查行，用 **可用旁白秒数 × Rate** 估首稿单位数；Rate 已按音频总时长计算，不重复扣除普通句间停顿。额外设计的长静音、片头片尾先从可用时长扣掉。
2. 例如 30 秒普通话旁白，`cmn-CN` 的 2.8 chars/s 给出约 84 字；30 秒美式英语旁白，`en-US` 的 2.1 words/s 给出约 63 词。它们是起稿值，不能据此承诺成品时长。
3. 混合语言按片段分别计单位，估时为各片段的 `单位数 / Rate` 之和；不能把字符与词直接相加。切换发音的停顿仍需用样音核对。
4. 查不到语言、地区或合适的计数方式时，不套英语速率；用目标模型、音色、语言与表演生成代表性样音。已有同配置的实测时优先用实测，换配置后重新校准。
5. 首稿之后按 {{skill:narration}} 的语速校准方法实测并修订预算，最终以合成音频的媒体时长与试听结果验收；固定原稿不为凑预算擅自删改。

## 完整参考表

BCP-47 Code 用于查找语言；传给模型前核对该模型接受的语言代码，不从本表推定支持情况。

| Language | BCP-47 Code | Unit | Rate |
| :--- | :--- | :--- | :--- |
| Arabic (Egypt) | ar-EG | words | 1.3 |
| Bangla (Bangladesh) | bn-BD | words | 1.8 |
| Dutch (Netherlands) | nl-NL | words | 2.1 |
| English (India) | en-IN | words | 2.2 |
| English (United States) | en-US | words | 2.1 |
| French (France) | fr-FR | words | 2.2 |
| German (Germany) | de-DE | words | 2.1 |
| Hindi (India) | hi-IN | words | 2.1 |
| Indonesian (Indonesia) | id-ID | words | 1.6 |
| Italian (Italy) | it-IT | words | 1.9 |
| Japanese (Japan) | ja-JP | chars | 4.2 |
| Korean (South Korea) | ko-KR | chars | 3.8 |
| Marathi (India) | mr-IN | words | 1.6 |
| Polish (Poland) | pl-PL | words | 1.7 |
| Portuguese (Brazil) | pt-BR | words | 1.7 |
| Romanian (Romania) | ro-RO | words | 1.6 |
| Russian (Russia) | ru-RU | words | 1.5 |
| Spanish (Spain) | es-ES | words | 1.8 |
| Tamil (India) | ta-IN | words | 1.3 |
| Telugu (India) | te-IN | words | 1.3 |
| Thai (Thailand) | th-TH | chars | 7.2 |
| Turkish (Turkey) | tr-TR | words | 1.6 |
| Ukrainian (Ukraine) | uk-UA | words | 1.5 |
| Vietnamese (Vietnam) | vi-VN | words | 2.7 |
| Afrikaans (South Africa) | af-ZA | words | 2.0 |
| Albanian (Albania) | sq-AL | words | 2.1 |
| Amharic (Ethiopia) | am-ET | words | 1.2 |
| Arabic (World) | ar-001 | words | 1.3 |
| Armenian (Armenia) | hy-AM | words | 1.5 |
| Azerbaijani (Azerbaijan) | az-AZ | words | 1.6 |
| Basque (Spain) | eu-ES | words | 1.7 |
| Belarusian (Belarus) | be-BY | words | 1.5 |
| Bulgarian (Bulgaria) | bg-BG | words | 1.8 |
| Burmese (Myanmar) | my-MM | chars | 11.2 |
| Catalan (Spain) | ca-ES | words | 2.2 |
| Cebuano (Philippines) | ceb-PH | words | 1.9 |
| Chinese, Mandarin (China) | cmn-CN | chars | 2.8 |
| Chinese, Mandarin (Taiwan) | cmn-tw | chars | 2.7 |
| Croatian (Croatia) | hr-HR | words | 1.7 |
| Czech (Czech Republic) | cs-CZ | words | 1.8 |
| Danish (Denmark) | da-DK | words | 2.1 |
| English (Australia) | en-AU | words | 2.2 |
| English (United Kingdom) | en-GB | words | 2.1 |
| Estonian (Estonia) | et-EE | words | 1.6 |
| Filipino (Philippines) | fil-PH | words | 1.7 |
| Finnish (Finland) | fi-FI | words | 1.2 |
| French (Canada) | fr-CA | words | 2.2 |
| Galician (Spain) | gl-ES | words | 1.9 |
| Georgian (Georgia) | ka-GE | words | 1.4 |
| Greek (Greece) | el-GR | words | 1.6 |
| Gujarati (India) | gu-IN | words | 1.8 |
| Haitian Creole (Haiti) | ht-HT | words | 2.6 |
| Hebrew (Israel) | he-IL | words | 1.5 |
| Hungarian (Hungary) | hu-HU | words | 1.8 |
| Icelandic (Iceland) | is-IS | words | 1.4 |
| Javanese (Java) | jv-JV | words | 1.7 |
| Kannada (India) | kn-IN | words | 1.2 |
| Konkani (India) | kok-IN | words | 1.6 |
| Lao (Laos) | lo-LA | chars | 8.2 |
| Latin (Vatican City) | la-VA | words | 1.3 |
| Latvian (Latvia) | lv-LV | words | 1.4 |
| Lithuanian (Lithuania) | lt-LT | words | 1.4 |
| Luxembourgish (Luxembourg) | lb-LU | words | 2.0 |
| Macedonian (North Macedonia) | mk-MK | words | 1.7 |
| Maithili (India) | mai-IN | words | 2.1 |
| Malagasy (Madagascar) | mg-MG | words | 1.8 |
| Malay (Malaysia) | ms-MY | words | 1.6 |
| Malayalam (India) | ml-IN | words | 1.2 |
| Mongolian (Mongolia) | mn-MN | words | 1.6 |
| Nepali (Nepal) | ne-NP | words | 1.4 |
| Norwegian, Bokmål (Norway) | nb-NO | words | 1.7 |
| Norwegian, Nynorsk (Norway) | nn-NO | words | 1.6 |
| Odia (India) | or-IN | words | 1.5 |
| Pashto (Afghanistan) | ps-AF | words | 2.1 |
| Persian (Iran) | fa-IR | words | 1.5 |
| Portuguese (Portugal) | pt-PT | words | 1.6 |
| Punjabi (India) | pa-IN | words | 2.3 |
| Serbian (Serbia) | sr-RS | words | 1.7 |
| Sindhi (India) | sd-IN | words | 2.1 |
| Sinhala (Sri Lanka) | si-LK | words | 1.6 |
| Slovak (Slovakia) | sk-SK | words | 1.7 |
| Slovenian (Slovenia) | sl-SI | words | 1.6 |
| Spanish (Latin America) | es-419 | words | 1.7 |
| Spanish (Mexico) | es-MX | words | 1.8 |
| Swahili (Kenya) | sw-KE | words | 1.8 |
| Swedish (Sweden) | sv-SE | words | 1.8 |
| Urdu (Pakistan) | ur-PK | words | 2.2 |

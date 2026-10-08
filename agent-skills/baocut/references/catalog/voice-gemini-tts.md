---
# 来自 Manus tts-prompter skill
description: Gemini TTS 的 30 个预置音色及声音特征。当前服务使用 Gemini TTS 且需要选音色时读；其他 TTS 模型不套用这些音色 ID。
---

# Gemini TTS 音色参考

## 适用模型与选择方式

本页只描述 Gemini TTS 的预置音色体系，见 [Gemini TTS 官方音色文档](https://ai.google.dev/gemini-api/docs/speech-generation#voice-options)。实际可用项取决于所选模型、版本与服务暴露的能力，先用 {{tool:models_capabilities}} 核对；这不是 BaoCut 所有 TTS 模型共用的音色清单。

按当前服务返回的可用音色与本表取交集，再按角色需要筛选。例如解说可从 Informative / Clear 筛选，亲切旁白可从 Warm / Friendly 筛选，轻快角色可从 Upbeat / Lively 筛选；声音特征和 Gender 标签用于筛选，最终以试听为准，尚未在 BaoCut 中逐一试听。不要因为语速校准使用 Charon 就固定选择它。

其他 TTS 模型使用各自的音色参考文件与可用音色 ID；相同名字不代表跨服务兼容。回到 [声音指南](voice.md) 查看合成、语言与时长的通用规则。

## 预置音色

| Voice Name | Gender | Character / Timbre（音质与释义） |
| --- | --- | --- |
| **Zephyr** | Female | Bright（明亮） |
| **Puck** | Male | Upbeat（轻快） |
| **Charon** | Male | Informative（解说感） |
| **Kore** | Female | Firm（坚定） |
| **Fenrir** | Male | Excitable（情绪昂扬） |
| **Leda** | Female | Youthful（年轻） |
| **Orus** | Male | Firm（坚定） |
| **Aoede** | Female | Breezy（轻松洒脱） |
| **Callirrhoe** | Female | Easy-going（随和） |
| **Autonoe** | Female | Bright（明亮） |
| **Enceladus** | Male | Breathy（气声） |
| **Iapetus** | Male | Clear（清晰） |
| **Umbriel** | Male | Easy-going（随和） |
| **Algieba** | Male | Smooth（圆润流畅） |
| **Despina** | Female | Smooth（圆润流畅） |
| **Erinome** | Female | Clear（清晰） |
| **Algenib** | Male | Gravelly（沙哑） |
| **Rasalgethi** | Male | Informative（解说感） |
| **Laomedeia** | Female | Upbeat（轻快） |
| **Achernar** | Female | Soft（柔和） |
| **Alnilam** | Male | Firm（坚定） |
| **Schedar** | Male | Even（平稳） |
| **Gacrux** | Female | Mature（成熟） |
| **Pulcherrima** | Female | Forward（直接鲜明） |
| **Achird** | Male | Friendly（友好） |
| **Zubenelgenubi** | Male | Casual（随性） |
| **Vindemiatrix** | Female | Gentle（温柔） |
| **Sadachbia** | Male | Lively（活泼） |
| **Sadaltager** | Male | Knowledgeable（知识感） |
| **Sulafat** | Female | Warm（温暖） |

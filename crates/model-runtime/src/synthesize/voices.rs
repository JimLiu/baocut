//! 内置音色：随包的八段参考录音，让不自带说话人表的引擎也有「默认音色」。
//!
//! 各引擎对「默认音色」的底子各不相同，这里把它们收成同一张表、同一组 id：
//!
//! | 引擎 | 模型自带什么 | 内置音色怎么落地 |
//! | --- | --- | --- |
//! | IndexTTS2 / IndexTTS 2.5 / GPT-SoVITS / VoxCPM2 / OmniVoice | 只能零样本克隆，没有说话人表 | 随包录音当参考音频（[`reference_for`]） |
//! | Qwen3-TTS Base | 能克隆；不给参考就是一把没条件的「裸声」，每次不一定一样 | 同上：默认音色 = 用内置录音算 x-vector |
//! | Qwen3-TTS CustomVoice | 模型自带 9 只说话人 | 用模型自己的，默认那只按语言挑 |
//! | Qwen3-TTS VoiceDesign | 只会按一句话描述造声，不能克隆 | 随包的一句声音描述当指令（[`style_for`]） |
//!
//! 八只命名音色（zh / en / ja / es × 男女）各带一段参考录音、一段原文和一句
//! 描述：[`VoiceSpec::Preset`] 按 id 取、[`VoiceSpec::Default`] 按语言取，取到
//! 之后走的是各引擎自己那条路（克隆 / 描述）。
//!
//! 录音随 crate 放在 `assets/voices/`，出处、许可与修改说明见同目录的 `COPYING.txt`。录音不落盘：
//! 引擎要样本时经 [`ReferenceAudio::samples`] 在内存里解码（Worker 只在 staging 里写文件）。
//! 跨语言克隆是这几只引擎都支持的：英语参考念中文没问题，听的是音色不是口音，所以八只音色
//! 在任何语言上都能选。

use super::resample::resample;
use super::types::{TtsRequest, VoiceSpec};
use super::wav::decode_wav_pcm16;
use anyhow::{Context, Result, bail, ensure};
use std::path::PathBuf;

/// 一只内置音色的元数据。随包录音（16 kHz 16-bit 单声道 PCM）由 [`wav`] 取。
#[derive(Debug)]
pub struct BuiltinVoice {
    /// `zh-female` 这样的稳定 id：`<语言>-<female|male>`，进 CLI `--speaker`、
    /// App 表单与持久化，改不得。
    pub id: &'static str,
    /// 录音本身的语言（BCP-47 主语种）。不限制这只音色能念什么。
    pub lang: &'static str,
    pub female: bool,
    pub seconds: f32,
    /// 录音念的原文。GPT-SoVITS 带参考文本时更像，所以内置音色一律把它带上。
    pub text: &'static str,
    /// 出处（语料 · 选段），随结果与「关于」页展示。
    pub credit: &'static str,
    /// 同一只音色的「说出来是什么样」：只会按描述造声的引擎（Qwen3-TTS VoiceDesign）拿它当
    /// 音色描述。用英文写，英文提示最稳。
    pub describe: &'static str,
}

/// Qwen3-TTS CustomVoice 的 9 只说话人（官方 `config.json` 的 `spk_id` 键，大小写按官方）。
/// 只用来**告诉**调用方有哪几只可选；合成时以装好的模型自带的说话人表为准。
pub const CUSTOM_VOICE_SPEAKERS: [&str; 9] = [
    "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee",
];

/// 八只内置音色，次序即 UI 次序：中、英、日、西，各女先男后。
pub const BUILTIN_VOICES: &[BuiltinVoice] = &[
    BuiltinVoice {
        id: "zh-female",
        lang: "zh",
        female: true,
        seconds: 6.72,
        text: "一般来说，卫星电话不能取代移动电话，因为只有在卫星信号畅通的室外，才能进行通话。",
        credit: "FLEURS · cmn_hans_cn · dev · 11138309825590803862",
        describe: "A warm, natural young female voice speaking Mandarin Chinese at an even, unhurried pace",
    },
    BuiltinVoice {
        id: "zh-male",
        lang: "zh",
        female: false,
        seconds: 6.16,
        text: "游猎活动也许是非洲最吸引人的旅游活动，也是许多游客行程中的亮点。",
        credit: "FLEURS · cmn_hans_cn · dev · 7878925372167965477",
        describe: "A calm, steady adult male voice speaking Mandarin Chinese, clear and even",
    },
    BuiltinVoice {
        id: "en-female",
        lang: "en",
        female: true,
        seconds: 7.32,
        text: EN_TEXT,
        credit: "CMU ARCTIC · cmu_us_slt_arctic · a0001 + a0002",
        describe: "A warm, clear adult female voice speaking American English at an even pace",
    },
    BuiltinVoice {
        id: "en-male",
        lang: "en",
        female: false,
        seconds: 6.90,
        text: EN_TEXT,
        credit: "CMU ARCTIC · cmu_us_bdl_arctic · a0001 + a0002",
        describe: "A deep, steady adult male voice speaking American English, clear and even",
    },
    BuiltinVoice {
        id: "ja-female",
        lang: "ja",
        female: true,
        seconds: 8.44,
        text: "州間の税法や関税を無効にする権限もありませんでした。",
        credit: "FLEURS · ja_jp · dev · 9633305044980004895",
        describe: "A bright, gentle young female voice speaking Japanese at an even pace",
    },
    BuiltinVoice {
        id: "ja-male",
        lang: "ja",
        female: false,
        seconds: 6.40,
        text: "宇宙にある人工衛星は通話を受信して、ほぼ瞬時にそれを反映します。",
        credit: "FLEURS · ja_jp · dev · 18146068393309246703",
        describe: "A calm, low adult male voice speaking Japanese, clear and even",
    },
    BuiltinVoice {
        id: "es-female",
        lang: "es",
        female: true,
        seconds: 6.92,
        text: "Los canales navegables internos pueden ser una buena temática para las vacaciones.",
        credit: "FLEURS · es_419 · dev · 16573424493246998243",
        describe: "A warm, clear adult female voice speaking Latin American Spanish at an even pace",
    },
    BuiltinVoice {
        id: "es-male",
        lang: "es",
        female: false,
        seconds: 7.86,
        text: "Cuando uno se comunica con alguien que está a miles de millas de distancia, se está haciendo uso de un satélite.",
        credit: "FLEURS · es_419 · dev · 14695292064114231662",
        describe: "A deep, steady adult male voice speaking Latin American Spanish, clear and even",
    },
];

/// 两段英文念的原句（CMU ARCTIC 的 a0001 + a0002）。
const EN_TEXT: &str = "Author of the danger trail, Philip Steels, etc. Not at this particular case, Tom, apologized Whittemore.";

/// 2026-09-13 到 2026-09-21 之间 App 用过的两个旧 id，持久化里可能还留着。
const ALIASES: &[(&str, &str)] = &[("ref-male", "en-male"), ("ref-female", "en-female")];

/// 没给语言、文本也看不出语言时落到这只。
const FALLBACK: &str = "zh-female";

/// 按 id 找一只内置音色；不区分大小写，认两个旧 id。
pub fn find(id: &str) -> Option<&'static BuiltinVoice> {
    let id = id.trim();
    let id = ALIASES
        .iter()
        .find(|(old, _)| old.eq_ignore_ascii_case(id))
        .map_or(id, |(_, new)| *new);
    BUILTIN_VOICES.iter().find(|voice| voice.id.eq_ignore_ascii_case(id))
}

/// 全部 id，按 [`BUILTIN_VOICES`] 的次序。错误信息与 `preset_speakers()` 都用它。
pub fn ids() -> Vec<String> {
    BUILTIN_VOICES.iter().map(|voice| voice.id.to_owned()).collect()
}

/// 这个 `--speaker` 该不该在装权重之前就被拦下。
///
/// 内置音色 id 一律放行——模型自带说话人表的引擎（Qwen3-TTS CustomVoice）会自己就近
/// 换成最像的那位并在 stderr 说一句，用户在两个变体之间切换时音色名不该成为路障。
/// 引擎没有说话人表（`presets` 为空）时也不拦：那种引擎的 `Preset` 走的是内置音色那条路。
pub fn unknown_preset(speaker: &str, presets: &[String]) -> bool {
    find(speaker).is_none() && !presets.is_empty() && !presets.iter().any(|name| name.eq_ignore_ascii_case(speaker))
}

/// 这门语言的内置音色（女声在前）。语言码按主语种比，`zh-Hans` / `zh-CN` 都算 `zh`。
pub fn for_language(lang: &str) -> Vec<&'static BuiltinVoice> {
    let main = main_language(lang);
    BUILTIN_VOICES.iter().filter(|voice| voice.lang == main).collect()
}

/// 「默认音色」取哪只：先看请求里的语言，再看文本用的字，都认不出落到中文女声。
///
/// 文本只按字形粗判（假名 → 日语、汉字 → 中文），西班牙语与英语同用拉丁字母、
/// 不猜，只认显式语言码。
pub fn default_for(language: Option<&str>, text: &str) -> &'static BuiltinVoice {
    let code = language
        .map(main_language)
        .filter(|code| BUILTIN_VOICES.iter().any(|voice| voice.lang == *code))
        .unwrap_or_else(|| script_language(text));
    BUILTIN_VOICES
        .iter()
        .find(|voice| voice.lang == code && voice.female)
        .or_else(|| BUILTIN_VOICES.iter().find(|voice| voice.lang == code))
        .unwrap_or_else(|| find(FALLBACK).expect("内置音色表里有 zh-female"))
}

/// `zh-Hans` / `zh_CN` / `ZH` → `zh`；认不出的原样小写返回。
fn main_language(lang: &str) -> &'static str {
    let head = lang.trim().split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    match head.as_str() {
        "zh" | "cmn" | "zho" | "yue" => "zh",
        "en" | "eng" => "en",
        "ja" | "jpn" => "ja",
        "es" | "spa" => "es",
        _ => "",
    }
}

/// 文本字形 → 语言：假名 → 日语，汉字 → 中文，其余英语。
fn script_language(text: &str) -> &'static str {
    let mut han = false;
    for ch in text.chars() {
        match ch {
            '\u{3040}'..='\u{309f}' | '\u{30a0}'..='\u{30ff}' => return "ja",
            '\u{4e00}'..='\u{9fff}' | '\u{3400}'..='\u{4dbf}' => han = true,
            _ => {}
        }
    }
    if han { "zh" } else { "en" }
}

/// 请求里的音色 → 哪一只内置音色。`Clone` 不走内置音色，给 `None`。
pub fn builtin_for(request: &TtsRequest, engine: &str) -> Result<Option<&'static BuiltinVoice>> {
    match &request.voice {
        VoiceSpec::Clone { .. } => Ok(None),
        VoiceSpec::Preset { speaker } => {
            let Some(voice) = find(speaker) else {
                bail!("{engine} 没有内置音色「{speaker}」；可选：{}", ids().join(", "));
            };
            Ok(Some(voice))
        }
        VoiceSpec::Default => Ok(Some(default_for(request.language.as_deref(), &request.text))),
    }
}

/// 只会按描述造声的引擎（Qwen3-TTS VoiceDesign）解析音色：内置音色给出它那句描述，调用方
/// 自己给的指令接在描述后面（两者都有就都说）。
///
/// `Clone` 在这条路上无解——描述造声接不了参考音频，交给调用方报错。
pub fn style_for(request: &TtsRequest, engine: &str) -> Result<Style> {
    let voice = builtin_for(request, engine)?;
    let described = voice.map(|voice| voice.describe);
    let asked = request.instruct.as_deref().map(str::trim).filter(|text| !text.is_empty());
    let instruct = match (described, asked) {
        (Some(described), Some(asked)) => Some(format!("{described}. {asked}")),
        (Some(described), None) => Some(described.to_owned()),
        (None, asked) => asked.map(str::to_owned),
    };
    Ok(Style {
        instruct,
        builtin: voice.map(|voice| voice.id),
    })
}

/// 一次「按描述造声」要用的风格指令。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Style {
    /// 交给引擎的整句指令；两边都空时为 `None`（引擎用自己的裸默认）。
    pub instruct: Option<String>,
    /// `Some(id)` = 描述来自这只内置音色。
    pub builtin: Option<&'static str>,
}

/// 随包录音。次序与 [`BUILTIN_VOICES`] 一致；两张表逐 id 对拍（见测试）。
const WAVS: &[(&str, &[u8])] = &[
    ("zh-female", include_bytes!("../../assets/voices/zh-female.wav")),
    ("zh-male", include_bytes!("../../assets/voices/zh-male.wav")),
    ("en-female", include_bytes!("../../assets/voices/en-female.wav")),
    ("en-male", include_bytes!("../../assets/voices/en-male.wav")),
    ("ja-female", include_bytes!("../../assets/voices/ja-female.wav")),
    ("ja-male", include_bytes!("../../assets/voices/ja-male.wav")),
    ("es-female", include_bytes!("../../assets/voices/es-female.wav")),
    ("es-male", include_bytes!("../../assets/voices/es-male.wav")),
];

/// 这只内置音色的录音字节（16 kHz 16-bit 单声道 PCM WAV）。
pub fn wav(voice: &BuiltinVoice) -> &'static [u8] {
    WAVS.iter()
        .find(|(id, _)| *id == voice.id)
        .map(|(_, bytes)| *bytes)
        .expect("每只内置音色都有随包录音")
}

/// 参考音频从哪里来：调用方给的文件，或一只内置音色的随包录音。
#[derive(Debug, Clone, PartialEq)]
pub enum ReferenceAudio {
    File(PathBuf),
    Builtin(&'static str),
}

impl ReferenceAudio {
    /// 解成 `sample_rate` 的单声道 f32。文件走 [`crate::audio::decode_mono`]；内置录音在内存里
    /// 解码，再用带限插值重采样到目标采样率。
    pub fn samples(&self, sample_rate: u32) -> Result<Vec<f32>> {
        match self {
            Self::File(path) => crate::audio::decode_mono(path, sample_rate).with_context(|| format!("解码参考音频 {}", path.display())),
            Self::Builtin(id) => {
                let voice = find(id).with_context(|| format!("没有内置音色 {id}"))?;
                let (samples, rate) = decode_wav_pcm16(wav(voice))?;
                Ok(resample(&samples, rate, sample_rate))
            }
        }
    }
}

/// 一次合成要用的参考音频与它的原文。
#[derive(Debug, Clone, PartialEq)]
pub struct Reference {
    pub audio: ReferenceAudio,
    /// 参考音频念的原文；带原文的克隆更像，不用的引擎忽略。
    pub text: Option<String>,
    /// `Some(id)` = 用的是内置音色；进度与结果要写出是哪一只。
    pub builtin: Option<&'static str>,
}

/// 只能克隆的引擎解析音色：`Clone` 用调用方给的文件，`Preset` 按 id 取内置音色，
/// `Default` 按语言取内置音色。各引擎走同一份判断，谁都不许自己再判一次「有没有默认音色」。
pub fn reference_for(request: &TtsRequest, engine: &str) -> Result<Reference> {
    if let VoiceSpec::Clone {
        reference_audio,
        reference_text,
    } = &request.voice
    {
        ensure!(reference_audio.is_file(), "{engine} 参考音频不存在：{}", reference_audio.display());
        return Ok(Reference {
            audio: ReferenceAudio::File(reference_audio.clone()),
            text: reference_text.clone().filter(|text| !text.trim().is_empty()),
            builtin: None,
        });
    }
    let Some(voice) = builtin_for(request, engine)? else {
        bail!("{engine} 没有可用的内置音色");
    };
    Ok(builtin(voice))
}

/// 一只内置音色作为参考。
pub fn builtin(voice: &'static BuiltinVoice) -> Reference {
    Reference {
        audio: ReferenceAudio::Builtin(voice.id),
        text: Some(voice.text.to_owned()),
        builtin: Some(voice.id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_cover_four_languages_both_genders() {
        let mut seen = std::collections::BTreeSet::new();
        for voice in BUILTIN_VOICES {
            assert!(seen.insert(voice.id), "重复 id {}", voice.id);
        }
        for lang in ["zh", "en", "ja", "es"] {
            let pair = for_language(lang);
            assert_eq!(pair.len(), 2, "{lang} 不是一男一女");
            assert!(pair.iter().any(|voice| voice.female), "{lang} 缺女声");
            assert!(pair.iter().any(|voice| !voice.female), "{lang} 缺男声");
        }
    }

    #[test]
    fn old_app_ids_still_resolve() {
        assert_eq!(find("ref-male").unwrap().id, "en-male");
        assert_eq!(find("ref-female").unwrap().id, "en-female");
        assert_eq!(find("ZH-Female").unwrap().id, "zh-female");
        assert!(find("女性-温柔").is_none());
    }

    #[test]
    fn default_follows_the_declared_language_then_the_script() {
        assert_eq!(default_for(Some("zh-Hans"), "hello").id, "zh-female");
        assert_eq!(default_for(Some("es-419"), "hello").id, "es-female");
        // 没给语言：看字形
        assert_eq!(default_for(None, "今天天气不错").id, "zh-female");
        assert_eq!(default_for(None, "こんにちは、今日はいい天気").id, "ja-female");
        assert_eq!(default_for(None, "good morning").id, "en-female");
        // 认不出的语言码退回按字形判，不硬塞第一只
        assert_eq!(default_for(Some("kk"), "こんにちは").id, "ja-female");
    }

    #[test]
    fn builtin_ids_walk_through_the_preset_gate() {
        let presets: Vec<String> = ["Vivian", "Serena", "Ono_anna"].iter().map(|name| (*name).to_owned()).collect();
        // 模型自己的说话人：放行，大小写不计
        assert!(!unknown_preset("vivian", &presets));
        // 内置音色 id（含旧别名）：也放行，交给引擎就近换成最像的那位
        assert!(!unknown_preset("zh-female", &presets));
        assert!(!unknown_preset("ref-female", &presets));
        // 两张表都不认的名字：这才该在装权重之前拦下
        assert!(unknown_preset("nobody", &presets));
        // 没有说话人表的引擎不拦——那条路走的是内置音色
        assert!(!unknown_preset("nobody", &[]));
    }

    #[test]
    fn describe_only_engines_get_the_voice_as_a_style_line() {
        let mut request = TtsRequest::new("今天天气不错", VoiceSpec::Default);
        let style = style_for(&request, "Qwen3-TTS VoiceDesign").unwrap();
        assert_eq!(style.builtin, Some("zh-female"));
        assert_eq!(style.instruct.as_deref(), Some(find("zh-female").unwrap().describe));

        // 自己给的指令接在音色描述后面，两句都说
        request.instruct = Some("  用兴奋的语气  ".to_owned());
        let style = style_for(&request, "Qwen3-TTS VoiceDesign").unwrap();
        let instruct = style.instruct.unwrap();
        assert!(instruct.starts_with(find("zh-female").unwrap().describe), "{instruct}");
        assert!(instruct.ends_with("用兴奋的语气"), "{instruct}");

        // 指名一只内置音色
        request.voice = VoiceSpec::Preset {
            speaker: "ja-male".to_owned(),
        };
        assert_eq!(style_for(&request, "Qwen3-TTS VoiceDesign").unwrap().builtin, Some("ja-male"));

        // 克隆走不到这条路：描述留着，内置音色为空（调用方自己报错）
        request.voice = VoiceSpec::Clone {
            reference_audio: PathBuf::from("/nope.wav"),
            reference_text: None,
        };
        let style = style_for(&request, "Qwen3-TTS VoiceDesign").unwrap();
        assert_eq!(style.builtin, None);
        assert_eq!(style.instruct.as_deref(), Some("用兴奋的语气"));
    }

    #[test]
    fn every_voice_has_its_own_description() {
        let mut seen = std::collections::BTreeSet::new();
        for voice in BUILTIN_VOICES {
            assert!(seen.insert(voice.describe), "{} 的描述与别人重了", voice.id);
            assert!(voice.describe.is_ascii(), "{} 的描述要用英文", voice.id);
            let gender = if voice.female { "female" } else { "male" };
            assert!(voice.describe.contains(gender), "{} 的描述没说清男女", voice.id);
        }
    }

    #[test]
    fn every_voice_has_its_recording_and_no_recording_is_orphaned() {
        assert_eq!(WAVS.len(), BUILTIN_VOICES.len());
        for (voice, (id, _)) in BUILTIN_VOICES.iter().zip(WAVS) {
            assert_eq!(voice.id, *id, "录音表次序与音色表不一致");
        }
    }

    #[test]
    fn every_voice_is_a_playable_16k_mono_wav() {
        for voice in BUILTIN_VOICES {
            let (samples, rate) = decode_wav_pcm16(wav(voice)).unwrap();
            assert_eq!(rate, 16_000, "{}", voice.id);
            let seconds = samples.len() as f32 / rate as f32;
            assert!(
                (seconds - voice.seconds).abs() < 0.05,
                "{} 表里写 {} 秒，实际 {seconds:.2} 秒",
                voice.id,
                voice.seconds
            );
            assert!(samples.iter().any(|s| s.abs() > 0.1), "{} 是静音", voice.id);
            assert!(!voice.text.trim().is_empty(), "{} 没有参考文本", voice.id);
        }
    }

    #[test]
    fn preset_and_default_resolve_to_a_builtin_recording() {
        let mut request = TtsRequest::new("你好", VoiceSpec::Default);
        let reference = reference_for(&request, "IndexTTS2").unwrap();
        assert_eq!(reference.audio, ReferenceAudio::Builtin("zh-female"));
        assert_eq!(reference.builtin, Some("zh-female"));
        assert!(reference.text.is_some());
        // 内存里解码并重采样到 24 kHz：时长不变。
        let samples = reference.audio.samples(24_000).unwrap();
        let seconds = samples.len() as f32 / 24_000.0;
        assert!((seconds - find("zh-female").unwrap().seconds).abs() < 0.05, "{seconds}");

        request.voice = VoiceSpec::Preset {
            speaker: "ja-male".to_owned(),
        };
        assert_eq!(reference_for(&request, "IndexTTS2").unwrap().builtin, Some("ja-male"));

        request.voice = VoiceSpec::Preset {
            speaker: "nobody".to_owned(),
        };
        let error = reference_for(&request, "IndexTTS2").unwrap_err().to_string();
        assert!(error.contains("没有内置音色"), "{error}");
        assert!(error.contains("zh-female"), "{error}");
    }

    #[test]
    fn a_missing_clone_reference_still_fails() {
        let request = TtsRequest::new(
            "你好",
            VoiceSpec::Clone {
                reference_audio: PathBuf::from("/nope/does-not-exist.wav"),
                reference_text: None,
            },
        );
        assert!(reference_for(&request, "GPT-SoVITS").is_err());
    }
}

//! `TextPreprocessor.get_phones_and_bert` 的文本部分：分段、逐段 `clean_text`、拼音素 id。

use super::error::PyError;
use super::langseg::{self, SegLang};
use super::symbols::symbol_id;
use super::{en, zh};

pub struct Segment {
    // 分段语种与原文只供 golden 对拍核对。
    #[cfg_attr(not(test), allow(dead_code))]
    pub lang: SegLang,
    #[cfg_attr(not(test), allow(dead_code))]
    pub text: String,
    pub norm: String,
    pub ids: Vec<u32>,
    /// 中文段每个字的音素数（BERT 逐字特征按它展开）；英文段没有。
    pub word2ph: Option<Vec<usize>>,
}

/// `mode` 为 zh 时中英混排自动分段，为 en 时整段按英文处理。
pub fn text_phones(text: &str, mode: SegLang) -> Result<Vec<Segment>, PyError> {
    phones(text, mode, false)
}

fn phones(text: &str, mode: SegLang, is_final: bool) -> Result<Vec<Segment>, PyError> {
    let text = langseg::collapse_spaces(text);
    let pairs = match mode {
        SegLang::En => vec![(SegLang::En, text.clone())],
        SegLang::Zh => langseg::zh_segments(&text)?,
    };
    if pairs.is_empty() {
        // 上游在空 bert 列表上 torch.cat
        return Err(PyError::Runtime);
    }
    let mut count = 0;
    let mut segments = Vec::with_capacity(pairs.len());
    for (lang, seg_text) in pairs {
        let (seg_phones, word2ph, norm) = match lang {
            SegLang::Zh => {
                let (seg_phones, word2ph, norm) = zh::clean(&seg_text)?;
                (seg_phones, Some(word2ph), norm)
            }
            SegLang::En => {
                let (seg_phones, norm) = en::clean_text(&seg_text)?;
                (seg_phones, None, norm)
            }
        };
        let ids = seg_phones
            .iter()
            .map(|phone| symbol_id(phone).ok_or(PyError::Key))
            .collect::<Result<Vec<_>, _>>()?;
        count += ids.len();
        segments.push(Segment {
            lang,
            text: seg_text,
            norm,
            ids,
            word2ph,
        });
    }
    // 音素太少时前面补句点重算一次
    if !is_final && count < 6 {
        return phones(&format!(".{text}"), mode, true);
    }
    Ok(segments)
}

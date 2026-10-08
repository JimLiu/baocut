//! 文本编码器的输入：文生图提示词模板与分词。纯逻辑，全平台编译。
//!
//! 分词：v2 用 HF `tokenizers` crate 读 `processor/tokenizer.json`；这里复用 OmniVoice 的纯 Rust Qwen2 BPE
//! （[`crate::synthesize::omnivoice::tokenizer::Tokenizer`]，同一份 `tokenizer.json` 格式：added token 先切出、NFC、
//! Qwen2 预切分正则、byte-level BPE，不加 BOS / EOS），不为它再引一个分词库。它的报错文案带「OmniVoice」字样，
//! 读的其实是这里的分词表。

use anyhow::Result;
use std::path::Path;

use crate::synthesize::omnivoice::tokenizer::Tokenizer;

/// 管线的系统提示；编码器输出里这一段（[`Prompter::drop_idx`] 个 token）被丢掉。
pub const SYSTEM: &str = "<|im_start|>system\nComprehend and analyze the provided prompt.<|im_end|>\n";

pub struct Prompter {
    tokenizer: Tokenizer,
    drop_idx: usize,
}

impl Prompter {
    /// `tokenizer` 是 `processor/tokenizer.json`。
    pub fn load(tokenizer: &Path) -> Result<Self> {
        let tokenizer = Tokenizer::load(tokenizer)?;
        let drop_idx = tokenizer.encode(SYSTEM).len();
        Ok(Self { tokenizer, drop_idx })
    }

    pub fn drop_idx(&self) -> usize {
        self.drop_idx
    }

    /// 文生图模板（管线的 `prompt_template_t2i`）。空提示按管线换成一个空格。
    pub fn t2i_ids(&self, prompt: &str) -> Vec<u32> {
        let prompt = if prompt.is_empty() { " " } else { prompt };
        let text = format!("{SYSTEM}<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n");
        self.tokenizer.encode(&text)
    }

    pub fn added_id(&self, token: &str) -> Option<u32> {
        self.tokenizer.added_id(token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 需要真实权重：`BAOCUT_TEST_MODELS_DIR` 下的 `mlx-community/Qwen-Image-2.1-MLX-4bit`。
    #[test]
    #[ignore = "需要 BAOCUT_TEST_MODELS_DIR 下的 mlx-community/Qwen-Image-2.1-MLX-4bit"]
    fn template_tokens_are_single_ids_and_the_system_prefix_is_dropped() {
        let root = std::env::var("BAOCUT_TEST_MODELS_DIR").expect("BAOCUT_TEST_MODELS_DIR");
        let path = Path::new(&root).join("mlx-community/Qwen-Image-2.1-MLX-4bit/processor/tokenizer.json");
        let prompter = Prompter::load(&path).unwrap();
        let start = prompter.added_id("<|im_start|>").expect("<|im_start|>");
        let end = prompter.added_id("<|im_end|>").expect("<|im_end|>");
        let ids = prompter.t2i_ids("a red apple on a wooden table");
        assert_eq!(ids[0], start);
        assert_eq!(ids.iter().filter(|&&id| id == start).count(), 3);
        assert_eq!(ids.iter().filter(|&&id| id == end).count(), 2);
        // 系统前缀的 token 正好是模板的开头：丢掉 drop_idx 个之后从 user 轮开始。
        let system = prompter.t2i_ids("x")[..prompter.drop_idx()].to_vec();
        assert_eq!(&ids[..prompter.drop_idx()], &system[..]);
        assert_eq!(ids[prompter.drop_idx()], start);
        assert_eq!(*system.last().unwrap(), Tokenizer::load(&path).unwrap().encode("\n")[0]);
        // 空提示按管线换成一个空格，不会少掉 user 轮。
        assert_eq!(prompter.t2i_ids("").len(), prompter.t2i_ids(" ").len());
    }
}

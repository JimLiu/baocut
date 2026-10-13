//! Prompt-specific embedding rows and compact audio logits. Original token IDs
//! remain in prompts; sampling keeps its original candidate order and precision.
use super::{CODEBOOK_SIZE, CODEBOOKS, config::Config};
use anyhow::{Context, Result, ensure};
use std::collections::HashMap;

pub(super) const RESIDUAL_SIZE: usize = 1024;
pub(super) const COMPACT_EOS: i32 = CODEBOOK_SIZE as i32;

pub(super) struct Vocabulary {
    word_rows: Vec<i32>,
    word_ids: HashMap<i32, i32>,
    output_rows: Vec<i32>,
    codebook_rows: Vec<i32>,
    residual_rows: Vec<i32>,
}
impl Vocabulary {
    pub fn new(c: &Config, prompt: &[i32]) -> Result<Self> {
        let mut word_rows: Vec<_> = (c.semantic_start_token_id..=c.semantic_end_token_id).collect();
        word_rows.push(c.eos_token_id);
        let output_rows = word_rows.clone();
        let mut word_ids: HashMap<_, _> = word_rows.iter().enumerate().map(|(i, &id)| (id, i as i32)).collect();
        for &id in prompt {
            ensure!(
                id >= 0 && (id as usize) < c.text_config.vocab_size,
                "Fish prompt token outside vocabulary"
            );
            word_ids.entry(id).or_insert_with(|| {
                let index = word_rows.len() as i32;
                word_rows.push(id);
                index
            });
        }
        let codebook_rows = (0..CODEBOOKS)
            .flat_map(|i| {
                let count = if i == 0 { CODEBOOK_SIZE } else { RESIDUAL_SIZE };
                (0..count).map(move |id| (i * CODEBOOK_SIZE + id) as i32)
            })
            .collect();
        Ok(Self {
            word_rows,
            word_ids,
            output_rows,
            codebook_rows,
            residual_rows: (0..RESIDUAL_SIZE as i32).collect(),
        })
    }
    pub fn word(&self, id: i32) -> Result<i32> {
        self.word_ids.get(&id).copied().context("Fish token missing from prompt vocabulary")
    }
    pub fn codebook(book: usize, id: i32) -> Result<i32> {
        let count = if book == 0 { CODEBOOK_SIZE } else { RESIDUAL_SIZE };
        ensure!(
            book < CODEBOOKS && id >= 0 && (id as usize) < count,
            "Fish codebook token out of bounds"
        );
        Ok(if book == 0 {
            id
        } else {
            (CODEBOOK_SIZE + (book - 1) * RESIDUAL_SIZE) as i32 + id
        })
    }
    pub fn rows(&self, key: &str) -> Option<Vec<i32>> {
        let key = key.strip_prefix("model.").unwrap_or(key);
        let (prefix, suffix) = key.rsplit_once('.')?;
        if !matches!(suffix, "weight" | "scales" | "biases" | "bias") {
            return None;
        }
        Some(
            match prefix {
                "embeddings" | "text_model.model.embeddings" => &self.word_rows,
                "output" | "text_model.model.output" => &self.output_rows,
                "codebook_embeddings" | "audio_decoder.codebook_embeddings" => &self.codebook_rows,
                "fast_output" | "audio_decoder.output" => &self.residual_rows,
                _ => return None,
            }
            .clone(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Config {
        serde_json::from_str(include_str!("../../../tests/fixtures/fish-s2-pro-config.json")).unwrap()
    }
    #[test]
    fn retains_prompt_semantics_eos_and_valid_codebooks_in_original_order() {
        let c = config();
        let v = Vocabulary::new(&c, &[20, 15, 20, c.eos_token_id, c.semantic_start_token_id]).unwrap();
        assert_eq!(v.word_rows.len(), CODEBOOK_SIZE + 3);
        assert_eq!(v.word(c.semantic_start_token_id).unwrap(), 0);
        assert_eq!(v.word(c.semantic_end_token_id).unwrap(), 4095);
        assert_eq!(v.word(c.eos_token_id).unwrap(), COMPACT_EOS);
        assert_eq!(v.word(20).unwrap(), 4097);
        assert_eq!(v.word(15).unwrap(), 4098);
        assert!(v.word(25).is_err());
        assert!(Vocabulary::new(&c, &[-1]).is_err());
        assert!(Vocabulary::new(&c, &[c.text_config.vocab_size as i32]).is_err());
        assert_eq!(v.codebook_rows.len(), 13312);
        for book in 0..CODEBOOKS {
            for id in 0..if book == 0 { CODEBOOK_SIZE } else { RESIDUAL_SIZE } {
                let compact = Vocabulary::codebook(book, id as i32).unwrap();
                assert_eq!(v.codebook_rows[compact as usize], (book * CODEBOOK_SIZE + id) as i32);
            }
        }
        assert!(Vocabulary::codebook(1, 1024).is_err());
        assert!(Vocabulary::codebook(10, 0).is_err());
        assert!(Vocabulary::codebook(0, -1).is_err());
        for prefix in [
            "embeddings",
            "model.embeddings",
            "text_model.model.embeddings",
            "model.text_model.model.embeddings",
        ] {
            for suffix in ["weight", "scales", "biases", "bias"] {
                assert_eq!(v.rows(&format!("{prefix}.{suffix}")).unwrap(), v.word_rows);
            }
        }
        assert_eq!(v.rows("model.fast_output.weight").unwrap().len(), 1024);
        assert_eq!(v.rows("model.audio_decoder.output.scales").unwrap().len(), 1024);
        assert_eq!(v.rows("text_model.model.output.weight").unwrap().len(), 4097);
        assert!(v.rows("model.fast_embeddings.weight").is_none());
        assert!(v.rows("audio_decoder.embeddings.weight").is_none());
        assert!(v.rows("layers.0.attention.wqkv.weight").is_none());
    }
}

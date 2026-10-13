//! Adapted from soniqo/speech-swift Sources/FishAudioTTS (Apache-2.0).
//! Copyright 2025 Ivan Digital; Rust/MLX/Candle changes. License and scope: mod.rs.
use crate::synthesize::qwen3_tts::sampling::Rng;
use crate::synthesize::types::SamplingOptions;
use anyhow::{Result, ensure};
#[derive(Clone, Debug)]
pub struct Sampling {
    pub temperature: f32,
    pub top_k: usize,
    pub top_p: f32,
    pub max_tokens: usize,
}
impl Sampling {
    pub fn new(options: &SamplingOptions) -> Result<Self> {
        let s = Self {
            temperature: options.temperature.unwrap_or(0.7),
            top_k: options.top_k.unwrap_or(30),
            top_p: options.top_p.unwrap_or(0.7),
            max_tokens: options.max_tokens.unwrap_or(1024),
        };
        ensure!(
            s.temperature.is_finite() && s.temperature >= 0.0 && s.top_p.is_finite() && s.top_p > 0.0 && s.top_p <= 1.0 && s.max_tokens > 0,
            "invalid Fish sampling options"
        );
        Ok(s)
    }
    pub fn sample(&self, logits: &[f32], allowed: impl Iterator<Item = i32>, rng: &mut Rng) -> Result<i32> {
        let mut candidates: Vec<(i32, f32)> = allowed
            .map(|id| (id, logits.get(id as usize).copied().unwrap_or(f32::NAN)))
            .collect();
        ensure!(
            !candidates.is_empty()
                && candidates.iter().all(|(_, v)| !v.is_nan() && *v != f32::INFINITY)
                && candidates.iter().any(|(_, v)| v.is_finite()),
            "invalid Fish sampling logits"
        );
        candidates.sort_by(|a, b| b.1.total_cmp(&a.1));
        if self.temperature == 0.0 {
            return Ok(candidates[0].0);
        }
        if self.top_k > 0 {
            candidates.truncate(self.top_k);
        }
        let max = candidates[0].1;
        let mut probs: Vec<f64> = candidates
            .iter()
            .map(|(_, v)| ((*v - max) as f64 / self.temperature as f64).exp())
            .collect();
        let total: f64 = probs.iter().sum();
        let mut cumulative = 0.0;
        let mut count = probs.len();
        for (i, p) in probs.iter().enumerate() {
            cumulative += p / total;
            if cumulative >= self.top_p as f64 {
                count = i + 1;
                break;
            }
        }
        probs.truncate(count);
        candidates.truncate(count);
        let mut target = rng.next_f64() * probs.iter().sum::<f64>();
        for ((id, _), p) in candidates.iter().zip(&probs) {
            target -= p;
            if target < 0.0 {
                return Ok(*id);
            }
        }
        Ok(candidates.last().unwrap().0)
    }
    pub fn semantic(&self, logits: &[f32], range: std::ops::RangeInclusive<i32>, eos: i32, previous: &[i32], rng: &mut Rng) -> Result<i32> {
        let id = self.sample(logits, range.clone().chain(std::iter::once(eos)), rng)?;
        if range.contains(&id) && previous.iter().rev().take(10).any(|&v| v == id) && self.temperature > 0.0 {
            Self {
                temperature: 1.0,
                top_p: 0.9,
                ..self.clone()
            }
            .sample(logits, range.chain(std::iter::once(eos)), rng)
        } else {
            Ok(id)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seeded_sampling_respects_allowed_ids_and_filters() {
        let s = Sampling::new(&SamplingOptions::default()).unwrap();
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..40 {
            let x = s.sample(&[900.0, 1.0, 2.0, 3.0], 1..=3, &mut a).unwrap();
            assert_eq!(x, s.sample(&[900.0, 1.0, 2.0, 3.0], 1..=3, &mut b).unwrap());
            assert!((1..=3).contains(&x));
        }
    }
    #[test]
    fn compact_logits_preserve_seeded_sampling_repetition_and_eos() {
        let s = Sampling::new(&SamplingOptions::default()).unwrap();
        // Equal scores exercise stable tie ordering and the EOS candidate.
        let full = [99., 99., 99., 0.3, 0.3, 0.4, 0.3, 99., 0.4];
        let compact = [0.3, 0.3, 0.4, 0.3, 0.4];
        for temperature in [0., 0.7] {
            let s = Sampling { temperature, ..s.clone() };
            let (mut a, mut b) = (Rng::new(42), Rng::new(42));
            let (mut original, mut mapped) = (Vec::new(), Vec::new());
            for _ in 0..200 {
                let id = s.semantic(&full, 3..=6, 8, &original, &mut a).unwrap();
                let index = s.semantic(&compact, 0..=3, 4, &mapped, &mut b).unwrap();
                assert_eq!(id, if index == 4 { 8 } else { index + 3 });
                original.push(id);
                mapped.push(index);
            }
        }
    }
    #[test]
    fn greedy_and_nonfinite_logits() {
        let s = Sampling {
            temperature: 0.0,
            top_k: 30,
            top_p: 0.7,
            max_tokens: 20,
        };
        assert_eq!(s.sample(&[3.0, 2.0], 0..=1, &mut Rng::new(1)).unwrap(), 0);
        assert!(s.sample(&[f32::NAN], 0..=0, &mut Rng::new(1)).is_err());
        assert!(s.sample(&[f32::NEG_INFINITY], 0..=0, &mut Rng::new(1)).is_err());
    }
}

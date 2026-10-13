//! Adapted from soniqo/speech-swift Sources/FishAudioTTS (Apache-2.0).
//! Copyright 2025 Ivan Digital; Rust/MLX/Candle changes. License and scope: mod.rs.
//! Fish chat prompt: eleven parallel rows (text plus ten codebooks).
use super::{CODEBOOK_SIZE, CODEBOOKS};
use anyhow::{Result, ensure};
pub fn build(
    text: &str,
    reference_text: &str,
    codes: &[Vec<i32>],
    semantic_start: i32,
    encode: impl Fn(&str) -> Result<Vec<u32>>,
) -> Result<Vec<Vec<i32>>> {
    ensure!(codes.len() == CODEBOOKS && !codes[0].is_empty(), "invalid Fish reference codebooks");
    let frames = codes[0].len();
    ensure!(
        codes.iter().enumerate().all(|(i, row)| row.len() == frames
            && row
                .iter()
                .all(|&v| v >= 0 && (v as usize) < if i == 0 { CODEBOOK_SIZE } else { 1024 })),
        "invalid Fish reference codes"
    );
    let mut rows = vec![Vec::new(); CODEBOOKS + 1];
    let append = |rows: &mut Vec<Vec<i32>>, text: &str| -> Result<()> {
        for id in encode(text)? {
            rows[0].push(id as i32);
            for row in &mut rows[1..] {
                row.push(0);
            }
        }
        Ok(())
    };
    append(
        &mut rows,
        "<|im_start|>system\nconvert the provided text to speech reference to the following:\n\nText:\n",
    )?;
    let tagged = if reference_text.contains("<|speaker:") {
        reference_text.to_owned()
    } else {
        format!("<|speaker:0|>{reference_text}")
    };
    append(&mut rows, &tagged)?;
    append(&mut rows, "\n\nSpeech:\n")?;
    for frame in 0..frames {
        rows[0].push(semantic_start + codes[0][frame]);
        for (i, c) in codes.iter().enumerate() {
            rows[i + 1].push(c[frame]);
        }
    }
    append(&mut rows, "<|im_end|>\n")?;
    append(&mut rows, &format!("<|im_start|>user\n{text}<|im_end|>\n"))?;
    append(&mut rows, "<|im_start|>assistant\n<|voice|>")?;
    Ok(rows)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reference_codes_and_inline_controls_are_preserved() {
        let codes = vec![vec![3, 4]; CODEBOOKS];
        let rows = build("[whisper]你好。", "参考。", &codes, 1000, |s| {
            Ok(s.bytes().map(u32::from).collect())
        })
        .unwrap();
        assert!(rows.iter().all(|row| row.len() == rows[0].len()));
        let pos = rows[0].iter().position(|&v| v == 1003).unwrap();
        assert_eq!(rows[0][pos + 1], 1004);
        for row in &rows[1..] {
            assert_eq!(&row[pos..pos + 2], &[3, 4]);
            assert!(row[..pos].iter().all(|&v| v == 0));
        }
        let text: String = rows[0].iter().filter(|&&v| v < 256).map(|&v| v as u8 as char).collect();
        assert!(text.ends_with("<|im_start|>assistant\n<|voice|>"));
        assert!(text.contains("[whisper]"));
    }
    #[test]
    fn invalid_reference_shape_and_residual_ids_fail() {
        assert!(build("x", "r", &[], 1000, |_| Ok(vec![])).is_err());
        let mut codes = vec![vec![0]; CODEBOOKS];
        codes[2][0] = 1024;
        assert!(build("x", "r", &codes, 1000, |_| Ok(vec![])).is_err());
    }
}

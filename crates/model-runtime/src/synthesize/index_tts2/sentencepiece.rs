//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/AudioCommon/SentencePieceModel.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 极简 SentencePiece `.model`（`sentencepiece_model.proto`）读取器。
//!
//! 对照 speech-swift `AudioCommon/SentencePieceModel.swift` 移植：只解析
//! `ModelProto.pieces`（字段 1）里每个 `SentencePiece` 的 `piece`（字段 1，
//! 字符串）、`score`（字段 2，fixed32）与 `type`（字段 3，varint），不依赖
//! protobuf 运行时；编码 / 解码逻辑由 `tokenizer` 模块在其上构建。

use anyhow::{Context, Result, bail};
use std::path::Path;

/// `sentencepiece_model.proto` 里的 piece 类型常量。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PieceType {
    Normal = 1,
    Unknown = 2,
    Control = 3,
    UserDefined = 4,
    Unused = 5,
    Byte = 6,
}

impl PieceType {
    pub fn from_raw(raw: i32) -> Option<Self> {
        Some(match raw {
            1 => Self::Normal,
            2 => Self::Unknown,
            3 => Self::Control,
            4 => Self::UserDefined,
            5 => Self::Unused,
            6 => Self::Byte,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    pub text: String,
    pub score: f32,
    pub kind: i32,
}

impl Piece {
    pub fn piece_type(&self) -> Option<PieceType> {
        PieceType::from_raw(self.kind)
    }

    /// control / unknown / unused / byte 四类都不参与 Unigram 格子。
    pub fn is_control_or_unknown(&self) -> bool {
        matches!(
            self.piece_type(),
            Some(PieceType::Control | PieceType::Unknown | PieceType::Unused | PieceType::Byte)
        )
    }
}

#[derive(Debug, Clone)]
pub struct SentencePieceModel {
    pub pieces: Vec<Piece>,
}

impl SentencePieceModel {
    pub fn load(path: &Path) -> Result<Self> {
        let data = std::fs::read(path).with_context(|| format!("无法读取 SentencePiece 模型 {}", path.display()))?;
        Self::parse(&data).with_context(|| format!("解析 SentencePiece 模型 {} 失败", path.display()))
    }

    pub fn parse(data: &[u8]) -> Result<Self> {
        let mut pieces = Vec::new();
        let mut offset = 0usize;
        while offset < data.len() {
            let (field, wire, after_tag) = read_tag(data, offset);
            offset = after_tag;
            if field != 1 || wire != 2 {
                offset = skip_field(data, offset, wire);
                continue;
            }
            let (length, after_len) = read_varint(data, offset);
            offset = after_len;
            let end = (offset + length).min(data.len());

            let mut text = String::new();
            let mut score = 0f32;
            let mut kind = PieceType::Normal as i32;
            let mut sub = offset;
            while sub < end {
                let (sub_field, sub_wire, after_sub_tag) = read_tag(data, sub);
                sub = after_sub_tag;
                match (sub_field, sub_wire) {
                    (1, 2) => {
                        let (len, after) = read_varint(data, sub);
                        sub = after;
                        let stop = (sub + len).min(data.len());
                        if let Ok(s) = std::str::from_utf8(&data[sub..stop]) {
                            text = s.to_string();
                        }
                        sub = stop;
                    }
                    (2, 5) => {
                        if sub + 4 <= data.len() {
                            score = f32::from_le_bytes([data[sub], data[sub + 1], data[sub + 2], data[sub + 3]]);
                        }
                        sub += 4;
                    }
                    (3, 0) => {
                        let (value, after) = read_varint(data, sub);
                        sub = after;
                        kind = value as i32;
                    }
                    _ => sub = skip_field(data, sub, sub_wire),
                }
            }
            pieces.push(Piece { text, score, kind });
            offset = end;
        }
        if pieces.is_empty() {
            bail!("SentencePiece 模型没有任何 piece");
        }
        Ok(Self { pieces })
    }

    pub fn len(&self) -> usize {
        self.pieces.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pieces.is_empty()
    }
}

fn read_varint(data: &[u8], offset: usize) -> (usize, usize) {
    let mut result = 0usize;
    let mut shift = 0u32;
    let mut off = offset;
    while off < data.len() {
        let byte = data[off] as usize;
        off += 1;
        if shift < usize::BITS {
            result |= (byte & 0x7F) << shift;
        }
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    (result, off)
}

fn read_tag(data: &[u8], offset: usize) -> (usize, usize, usize) {
    let (tag, new_offset) = read_varint(data, offset);
    (tag >> 3, tag & 0x07, new_offset)
}

fn skip_field(data: &[u8], offset: usize, wire: usize) -> usize {
    match wire {
        0 => read_varint(data, offset).1,
        1 => offset + 8,
        2 => {
            let (length, new_offset) = read_varint(data, offset);
            new_offset + length
        }
        5 => offset + 4,
        _ => data.len(),
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    /// 手工编码一个 `ModelProto`，供 tokenizer 单测使用。
    pub fn encode_model(pieces: &[(&str, f32, i32)]) -> Vec<u8> {
        fn varint(mut value: usize, out: &mut Vec<u8>) {
            loop {
                let byte = (value & 0x7F) as u8;
                value >>= 7;
                if value == 0 {
                    out.push(byte);
                    break;
                }
                out.push(byte | 0x80);
            }
        }
        let mut out = Vec::new();
        for (text, score, kind) in pieces {
            let mut body = Vec::new();
            body.push((1 << 3) | 2);
            varint(text.len(), &mut body);
            body.extend_from_slice(text.as_bytes());
            body.push((2 << 3) | 5);
            body.extend_from_slice(&score.to_le_bytes());
            body.push((3 << 3) | 0);
            varint(*kind as usize, &mut body);
            out.push((1 << 3) | 2);
            varint(body.len(), &mut out);
            out.extend_from_slice(&body);
        }
        // 顶层再塞一个无关字段（trainer_spec，字段 2，长度定界）验证跳过逻辑。
        out.push((2 << 3) | 2);
        out.push(2);
        out.extend_from_slice(&[0x08, 0x01]);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pieces_and_skips_unknown_fields() {
        let data = test_support::encode_model(&[("<unk>", 0.0, 2), ("▁a", -1.5, 1), ("b", -2.0, 1)]);
        let model = SentencePieceModel::parse(&data).unwrap();
        assert_eq!(model.len(), 3);
        assert_eq!(model.pieces[0].piece_type(), Some(PieceType::Unknown));
        assert!(model.pieces[0].is_control_or_unknown());
        assert_eq!(model.pieces[1].text, "▁a");
        assert_eq!(model.pieces[1].score, -1.5);
        assert!(!model.pieces[1].is_control_or_unknown());
    }

    #[test]
    fn empty_model_is_an_error() {
        assert!(SentencePieceModel::parse(&[]).is_err());
    }
}

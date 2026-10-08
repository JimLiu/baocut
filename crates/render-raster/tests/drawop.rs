use motion::effect::BlendMode;
use render_raster::drawop::{
    self, BitmapData, DrawOp, FrameBuilder, FrameOps, GradientStop, PaintData, PathData, PathSeg,
};
use std::sync::Arc;

const IDENTITY: [f32; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

fn line_path(x: f32) -> PathData {
    PathData(vec![
        PathSeg {
            verb: 0,
            pts: [0.0; 6],
        },
        PathSeg {
            verb: 1,
            pts: [x, 2.0, 0.0, 0.0, 0.0, 0.0],
        },
    ])
}

#[test]
fn frame_builder_deduplicates_side_tables_in_first_seen_order() {
    let mut builder = FrameBuilder::default();
    assert_eq!(builder.string_id("image"), 0);
    assert_eq!(builder.string_id("video"), 1);
    assert_eq!(builder.string_id("image"), 0);

    assert_eq!(builder.path_id(line_path(1.0)), 0);
    assert_eq!(builder.path_id(line_path(2.0)), 1);
    assert_eq!(builder.path_id(line_path(1.0)), 0);

    let frame = builder.finish();
    assert_eq!(frame.strings, vec!["image", "video"]);
    assert_eq!(frame.paths, vec![line_path(1.0), line_path(2.0)]);
}

#[test]
fn path_from_skia_preserves_every_segment_kind() {
    let mut builder = tiny_skia::PathBuilder::new();
    builder.move_to(1.0, 2.0);
    builder.line_to(3.0, 4.0);
    builder.quad_to(5.0, 6.0, 7.0, 8.0);
    builder.cubic_to(9.0, 10.0, 11.0, 12.0, 13.0, 14.0);
    builder.close();

    let data = drawop::path_from_skia(&builder.finish().unwrap());

    assert_eq!(
        data.0.iter().map(|s| s.verb).collect::<Vec<_>>(),
        vec![0, 1, 2, 3, 4]
    );
    assert_eq!(&data.0[2].pts[..4], &[5.0, 6.0, 7.0, 8.0]);
    assert_eq!(&data.0[3].pts, &[9.0, 10.0, 11.0, 12.0, 13.0, 14.0]);
}

#[test]
fn encode_covers_every_opcode_and_has_a_stable_envelope() {
    let frame = FrameOps {
        static_prefix: None,
        strings: vec!["asset".into()],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![line_path(2.0)],
        ops: vec![
            DrawOp::Clear {
                color: [0.1, 0.2, 0.3, 1.0],
            },
            DrawOp::FillRect {
                x: 1.0,
                y: 2.0,
                w: 3.0,
                h: 4.0,
                radius: 0.5,
                color: [1.0, 0.0, 0.0, 1.0],
                tf: IDENTITY,
            },
            DrawOp::FillPath {
                path: 0,
                color: [0.0, 1.0, 0.0, 1.0],
                tf: IDENTITY,
            },
            DrawOp::StrokePath {
                path: 0,
                color: [0.0, 0.0, 1.0, 1.0],
                width: 2.0,
                tf: IDENTITY,
            },
            DrawOp::DrawMedia {
                asset: 0,
                media_ms: 1234,
                src: [0.0; 4],
                tf: IDENTITY,
            },
            DrawOp::PushLayer {
                opacity: 0.5,
                blend: BlendMode::Multiply,
            },
            DrawOp::PopLayer,
            DrawOp::ClipPath {
                path: 0,
                tf: IDENTITY,
            },
            DrawOp::PopClip,
        ],
    };

    let encoded = drawop::encode(&frame);

    assert_eq!(
        u32::from_le_bytes(encoded[0..4].try_into().unwrap()),
        0x42_43_4f_50
    );
    assert_eq!(
        u32::from_le_bytes(encoded[4..8].try_into().unwrap()),
        drawop::VERSION
    );
    assert_eq!(drawop::VERSION, 3);
    assert_eq!(drawop::fingerprint(&frame), drawop::fnv1a64(&encoded));
}

#[test]
fn encode_normalizes_negative_zero() {
    let make = |zero: f32| FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![PathData(vec![PathSeg {
            verb: 1,
            pts: [zero, zero, 0.0, 0.0, 0.0, 0.0],
        }])],
        ops: vec![DrawOp::FillRect {
            x: zero,
            y: zero,
            w: 1.0,
            h: 1.0,
            radius: zero,
            color: [zero, 0.0, 0.0, 1.0],
            tf: [1.0, zero, zero, 1.0, zero, zero],
        }],
    };

    assert_eq!(drawop::encode(&make(-0.0)), drawop::encode(&make(0.0)));
}

#[test]
fn fnv1a_matches_the_standard_test_vector() {
    assert_eq!(drawop::fnv1a64(b"hello"), 0xa430_d846_80aa_bd0b);
}

// ── v3 解码器 ────────────────────────────────────────────────────────

fn v3_frame() -> FrameOps {
    FrameOps {
        static_prefix: None,
        strings: vec!["asset".into(), "另一个".into()],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![line_path(2.0), line_path(-3.5)],
        ops: vec![
            DrawOp::Clear {
                color: [0.1, 0.2, 0.3, 1.0],
            },
            DrawOp::FillRect {
                x: 1.0,
                y: 2.0,
                w: 3.0,
                h: 4.0,
                radius: 0.5,
                color: [1.0, 0.0, 0.0, 1.0],
                tf: [1.0, 0.25, -0.25, 1.0, 3.0, 4.0],
            },
            DrawOp::ClipPath {
                path: 1,
                tf: IDENTITY,
            },
            DrawOp::FillPath {
                path: 0,
                color: [0.0, 1.0, 0.0, 1.0],
                tf: IDENTITY,
            },
            DrawOp::StrokePath {
                path: 0,
                color: [0.0, 0.0, 1.0, 1.0],
                width: 2.0,
                tf: IDENTITY,
            },
            DrawOp::PopClip,
            DrawOp::PushLayer {
                opacity: 0.25,
                blend: BlendMode::Screen,
            },
            DrawOp::DrawMedia {
                asset: 1,
                media_ms: -1,
                src: [1.0, 2.0, 3.0, 4.0],
                tf: IDENTITY,
            },
            DrawOp::PopLayer,
        ],
    }
}

#[test]
fn decode_round_trips_every_v3_opcode() {
    let frame = v3_frame();
    let (version, decoded) = drawop::decode(&drawop::encode(&frame)).unwrap();
    assert_eq!(version, 3);
    assert_eq!(decoded.strings, frame.strings);
    assert_eq!(decoded.paths, frame.paths);
    assert_eq!(decoded.ops, frame.ops);
    // 解码 → 重编码必须逐字节回到原信封（编码器是唯一真相）。
    assert_eq!(drawop::encode(&decoded), drawop::encode(&frame));
}

/// 手写一个 v2 信封：`PushLayer` 只有 opacity，没有 blend 字节。
fn v2_envelope() -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&0x42_43_4f_50u32.to_le_bytes()); // BCOP
    out.extend_from_slice(&2u32.to_le_bytes()); // VERSION 2
    out.extend_from_slice(&0u32.to_le_bytes()); // strings
    out.extend_from_slice(&0u32.to_le_bytes()); // paths
    out.extend_from_slice(&2u32.to_le_bytes()); // ops
    out.push(5); // PushLayer
    out.extend_from_slice(&0.5f32.to_le_bytes());
    out.push(6); // PopLayer
    out
}

#[test]
fn decode_reads_v2_and_treats_missing_blend_as_normal() {
    let (version, frame) = drawop::decode(&v2_envelope()).unwrap();
    assert_eq!(version, 2);
    assert_eq!(
        frame.ops,
        vec![
            DrawOp::PushLayer {
                opacity: 0.5,
                blend: BlendMode::Normal,
            },
            DrawOp::PopLayer,
        ]
    );
    // v2 里没有 ClipPath/PopClip 的 opcode，重编码得到的是等价的 v3。
    assert_eq!(
        u32::from_le_bytes(drawop::encode(&frame)[4..8].try_into().unwrap()),
        3
    );
}

#[test]
fn decode_rejects_v3_only_opcodes_inside_a_v2_envelope() {
    let mut bytes = v2_envelope();
    bytes[12..16].copy_from_slice(&0u32.to_le_bytes()); // strings
    let mut tail = Vec::new();
    tail.extend_from_slice(&0x42_43_4f_50u32.to_le_bytes());
    tail.extend_from_slice(&2u32.to_le_bytes());
    tail.extend_from_slice(&0u32.to_le_bytes());
    tail.extend_from_slice(&0u32.to_le_bytes());
    tail.extend_from_slice(&1u32.to_le_bytes());
    tail.push(8); // PopClip：v3 才有
    let error = drawop::decode(&tail).unwrap_err().to_string();
    assert!(error.contains("bcop-op-unknown"), "{error}");
}

#[test]
fn decode_rejects_bad_magic_version_blend_and_truncation() {
    let good = drawop::encode(&v3_frame());

    let mut bad_magic = good.clone();
    bad_magic[0] ^= 0xff;
    assert!(
        drawop::decode(&bad_magic)
            .unwrap_err()
            .to_string()
            .contains("bcop-magic-mismatch")
    );

    let mut bad_version = good.clone();
    bad_version[4..8].copy_from_slice(&99u32.to_le_bytes());
    assert!(
        drawop::decode(&bad_version)
            .unwrap_err()
            .to_string()
            .contains("bcop-version-unsupported")
    );

    assert!(
        drawop::decode(&good[..good.len() - 3])
            .unwrap_err()
            .to_string()
            .contains("bcop-truncated")
    );

    let mut trailing = good.clone();
    trailing.push(0);
    assert!(
        drawop::decode(&trailing)
            .unwrap_err()
            .to_string()
            .contains("bcop-trailing-bytes")
    );

    let blend_bad = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![],
        ops: vec![DrawOp::PushLayer {
            opacity: 1.0,
            blend: BlendMode::Normal,
        }],
    };
    let mut bytes = drawop::encode(&blend_bad);
    let last = bytes.len() - 1;
    bytes[last] = 99;
    assert!(
        drawop::decode(&bytes)
            .unwrap_err()
            .to_string()
            .contains("bcop-blend-unknown")
    );
}

#[test]
fn blend_mode_changes_the_fingerprint() {
    let make = |blend| FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![],
        ops: vec![
            DrawOp::PushLayer {
                opacity: 1.0,
                blend,
            },
            DrawOp::PopLayer,
        ],
    };
    assert_ne!(
        drawop::fingerprint(&make(BlendMode::Normal)),
        drawop::fingerprint(&make(BlendMode::Multiply))
    );
}

// ── v4：paint 侧表与遮罩原语（ADR-M11）─────────────────────────────

fn v4_frame() -> FrameOps {
    FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: vec![
            PaintData::Solid([1.0, 0.0, 0.0, 1.0]),
            PaintData::Linear {
                p0: [0.0, 0.0],
                p1: [10.0, 0.0],
                stops: vec![
                    GradientStop {
                        offset: 0.0,
                        color: [1.0, 0.0, 0.0, 1.0],
                    },
                    GradientStop {
                        offset: 1.0,
                        color: [0.0, 0.0, 1.0, 1.0],
                    },
                ],
            },
            PaintData::Radial {
                center: [5.0, 5.0],
                radius: 4.0,
                focus: [4.0, 5.0],
                stops: vec![GradientStop {
                    offset: 0.5,
                    color: [0.0, 1.0, 0.0, 0.5],
                }],
            },
        ],
        paths: vec![line_path(2.0)],
        ops: vec![
            DrawOp::PushLayer {
                opacity: 1.0,
                blend: BlendMode::Normal,
            },
            DrawOp::FillPathPaint {
                path: 0,
                paint: 1,
                even_odd: true,
                tf: IDENTITY,
            },
            DrawOp::StrokePathPaint {
                path: 0,
                paint: 2,
                width: 3.0,
                cap: 2,
                join: 0,
                miter: 4.0,
                tf: IDENTITY,
            },
            DrawOp::PushMatte,
            DrawOp::FillPathPaint {
                path: 0,
                paint: 0,
                even_odd: false,
                tf: IDENTITY,
            },
            DrawOp::PopMatte { mode: 2 },
            DrawOp::PopLayer,
        ],
    }
}

#[test]
fn a_frame_without_v4_primitives_still_encodes_as_v3() {
    // 这是「既有 golden 逐字节不变」的那条承诺：渲染器学会画渐变之后，
    // 一条 v4 原语都没有的帧仍然产出与从前完全相同的字节。
    let frame = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![line_path(2.0)],
        ops: vec![DrawOp::FillPath {
            path: 0,
            color: [1.0, 1.0, 1.0, 1.0],
            tf: IDENTITY,
        }],
    };
    let encoded = drawop::encode(&frame);
    assert_eq!(drawop::required_version(&frame), 3);
    assert_eq!(
        u32::from_le_bytes(encoded[4..8].try_into().unwrap()),
        3,
        "v3 帧的信封版本必须还是 3"
    );
    // v3 帧没有 paints 节：strings(0) + paths(1 条 2 段) + ops(1 条)
    let (version, back) = drawop::decode(&encoded).unwrap();
    assert_eq!(version, 3);
    assert!(back.paints.is_empty());
}

#[test]
fn v4_primitives_lift_the_envelope_and_round_trip() {
    let frame = v4_frame();
    assert_eq!(drawop::required_version(&frame), 4);
    let encoded = drawop::encode(&frame);
    assert_eq!(u32::from_le_bytes(encoded[4..8].try_into().unwrap()), 4);

    let (version, back) = drawop::decode(&encoded).unwrap();
    assert_eq!(version, 4);
    assert_eq!(back.paints, frame.paints);
    assert_eq!(back.ops, frame.ops);
    assert_eq!(drawop::encode(&back), encoded, "v4 解码后重编码逐字节相同");
}

#[test]
fn the_paint_side_table_deduplicates_like_paths_do() {
    let mut builder = FrameBuilder::default();
    let red = PaintData::Solid([1.0, 0.0, 0.0, 1.0]);
    let blue = PaintData::Solid([0.0, 0.0, 1.0, 1.0]);
    assert_eq!(builder.paint_id(red.clone()), 0);
    assert_eq!(builder.paint_id(blue), 1);
    assert_eq!(builder.paint_id(red), 0);
    assert_eq!(builder.finish().paints.len(), 2);
}

#[test]
fn a_v3_envelope_refuses_v4_opcodes() {
    let mut encoded = drawop::encode(&v4_frame());
    encoded[4..8].copy_from_slice(&3u32.to_le_bytes());
    let error = drawop::decode(&encoded).unwrap_err().to_string();
    assert!(
        error.contains("bcop-"),
        "v3 信封里出现 v4 原语必须报错，实际 {error}"
    );
}

#[test]
fn an_unknown_matte_mode_is_refused() {
    let frame = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: vec![PaintData::Solid([0.0; 4])],
        paths: vec![],
        ops: vec![DrawOp::PopMatte { mode: 9 }],
    };
    let error = drawop::decode(&drawop::encode(&frame))
        .unwrap_err()
        .to_string();
    assert!(error.contains("bcop-matte-mode-unknown"), "实际 {error}");
}

// ── v5：位图侧表与 DrawBitmap（BCF 文字的彩色字形）──────────────────

fn bitmap(width: u32, height: u32, fill: u8) -> BitmapData {
    BitmapData {
        width,
        height,
        rgba: vec![fill; (width * height * 4) as usize].into(),
    }
}

fn v5_frame() -> FrameOps {
    let mut frame = v4_frame();
    frame.bitmaps = vec![bitmap(2, 3, 0x40), bitmap(1, 1, 0xff)];
    frame.ops.push(DrawOp::DrawBitmap {
        bitmap: 1,
        opacity: 0.5,
        tf: [0.5, 0.0, 0.0, 0.5, 10.0, -4.0],
    });
    frame
}

#[test]
fn bitmaps_lift_the_envelope_to_v5_and_round_trip() {
    let frame = v5_frame();
    assert_eq!(drawop::MAX_VERSION, 5);
    assert_eq!(drawop::required_version(&frame), 5);
    let encoded = drawop::encode(&frame);
    assert_eq!(u32::from_le_bytes(encoded[4..8].try_into().unwrap()), 5);

    let (version, back) = drawop::decode(&encoded).unwrap();
    assert_eq!(version, 5);
    assert_eq!(back.paints, frame.paints, "v5 仍带 v4 的 paint 节");
    assert_eq!(back.bitmaps, frame.bitmaps);
    assert_eq!(back.ops, frame.ops);
    assert_eq!(drawop::encode(&back), encoded, "v5 解码后重编码逐字节相同");
}

#[test]
fn a_frame_without_bitmaps_keeps_its_v3_or_v4_bytes() {
    // 渲染器学会画彩色字形之后，没有彩色字形的帧不得换信封版本——
    // 既有 golden 与 `core/fixtures/motion/` 指纹靠这条。
    let v4 = v4_frame();
    assert_eq!(drawop::required_version(&v4), 4);
    assert_eq!(
        u32::from_le_bytes(drawop::encode(&v4)[4..8].try_into().unwrap()),
        4
    );
}

#[test]
fn bitmap_pixels_are_part_of_the_fingerprint() {
    let mut darker = v5_frame();
    darker.bitmaps[1] = bitmap(1, 1, 0xfe);
    assert_ne!(
        drawop::fingerprint(&v5_frame()),
        drawop::fingerprint(&darker),
        "同尺寸、不同像素的位图必须换指纹，否则静止帧缓存会复用错画面"
    );
}

#[test]
fn the_bitmap_side_table_deduplicates_by_content_not_by_pointer() {
    let mut builder = FrameBuilder::default();
    let first = bitmap(2, 2, 7);
    // 同内容、另一个 Arc：字形缓存淘汰后重光栅化就是这种情形。
    let same_content = BitmapData {
        rgba: Arc::from(first.rgba.to_vec()),
        ..first.clone()
    };
    assert!(!Arc::ptr_eq(&first.rgba, &same_content.rgba));
    assert_eq!(builder.bitmap_id(first), 0);
    assert_eq!(builder.bitmap_id(bitmap(2, 2, 8)), 1);
    assert_eq!(builder.bitmap_id(same_content), 0);
    // 字节相同、尺寸不同（2×2 与 1×4）是两张位图。
    assert_eq!(builder.bitmap_id(bitmap(1, 4, 7)), 2);
    assert_eq!(builder.finish().bitmaps.len(), 3);
}

#[test]
fn a_v4_envelope_refuses_the_bitmap_opcode() {
    let frame = FrameOps {
        paints: vec![PaintData::Solid([0.0; 4])],
        ops: vec![DrawOp::DrawBitmap {
            bitmap: 0,
            opacity: 1.0,
            tf: IDENTITY,
        }],
        ..FrameOps::default()
    };
    let mut encoded = drawop::encode(&frame);
    assert_eq!(u32::from_le_bytes(encoded[4..8].try_into().unwrap()), 5);
    // 改写成 v4：v4 信封没有位图节，也不认 13 号操作码。
    encoded[4..8].copy_from_slice(&4u32.to_le_bytes());
    let bitmaps_at = encoded.len() - (4 + 1 + 4 + 4 + 24) - 4;
    encoded.drain(bitmaps_at..bitmaps_at + 4);
    let error = drawop::decode(&encoded).unwrap_err().to_string();
    assert!(error.contains("bcop-op-unknown"), "实际 {error}");
}

#[test]
fn truncated_or_empty_bitmaps_are_refused() {
    let only = FrameOps {
        bitmaps: vec![bitmap(2, 3, 1)],
        ..FrameOps::default()
    };
    let encoded = drawop::encode(&only);
    // 末尾 4 字节是 ops 计数；再往前 10 字节落在位图像素里。
    let error = drawop::decode(&encoded[..encoded.len() - 14])
        .unwrap_err()
        .to_string();
    assert!(error.contains("bcop-truncated"), "实际 {error}");

    let empty = FrameOps {
        bitmaps: vec![BitmapData {
            width: 0,
            height: 4,
            rgba: Arc::from(Vec::new()),
        }],
        ..FrameOps::default()
    };
    let error = drawop::decode(&drawop::encode(&empty))
        .unwrap_err()
        .to_string();
    assert!(error.contains("bcop-bitmap-size-invalid"), "实际 {error}");
}

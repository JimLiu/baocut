//! `core/fixtures/animated/` 的**生成端**：程序合成的极小 GIF / APNG /
//! 动画 WebP（都是 8×8），逐帧颜色、逐帧时长、disposal 与 loop count 全部写死。
//!
//! 为什么不像 `core/fixtures/gen.sh` 那样用 ffmpeg：那条路给不了逐帧 disposal
//! 与 loop count 的精确控制，而这两项正是 §7 要求"保留"的东西。用 crate 生成
//! 还有个好处——夹具能在测试里**当场重算**，`animated_fixtures_are_up_to_date`
//! 因此是一条真门禁，而不是"跑一次脚本然后祈祷"。

use std::io::Cursor;

/// stripes.gif 的四帧颜色（RGB）
pub const STRIPE_COLOURS: [[u8; 3]; 4] = [
    [0xe0, 0x20, 0x20],
    [0x20, 0xc0, 0x20],
    [0x20, 0x40, 0xe0],
    [0xf0, 0xd0, 0x00],
];
/// stripes.gif 的四条 delay（GIF 的 10ms 单位）→ 100 / 200 / 300 / 400 ms
pub const STRIPE_DELAYS_CS: [u16; 4] = [10, 20, 30, 40];

const W: u16 = 8;
const H: u16 = 8;

/// 全部夹具（文件名 → 字节）。顺序固定，`expected.json` 的键序依赖它。
pub fn fixtures() -> Vec<(String, Vec<u8>)> {
    vec![
        (
            "stripes.gif".into(),
            stripes_gif(STRIPE_COLOURS, STRIPE_DELAYS_CS, gif::Repeat::Infinite),
        ),
        ("disposal.gif".into(), disposal_gif()),
        ("pulse.png".into(), pulse_apng()),
        ("wave.webp".into(), wave_webp()),
    ]
}

// ── GIF ─────────────────────────────────────────────────────────────

/// 四帧整幅纯色，逐帧 delay 不同，全部 `DisposalMethod::Any`。
pub fn stripes_gif(colours: [[u8; 3]; 4], delays_cs: [u16; 4], repeat: gif::Repeat) -> Vec<u8> {
    let palette: Vec<u8> = colours.iter().flatten().copied().collect();
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, W, H, &palette).expect("GIF 编码器");
        enc.set_repeat(repeat).expect("loop count");
        for (i, delay) in delays_cs.iter().enumerate() {
            let mut frame = gif::Frame {
                width: W,
                height: H,
                buffer: vec![i as u8; (W * H) as usize].into(),
                delay: *delay,
                dispose: gif::DisposalMethod::Any,
                ..Default::default()
            };
            frame.make_lzw_pre_encoded();
            enc.write_lzw_pre_encoded_frame(&frame).expect("写帧");
        }
    }
    out
}

/// disposal 语义的取证夹具，loop count 有限（2 遍）：
/// 帧 0 整幅红 `Keep` → 帧 1 中间 4×4 绿块（红底透出）`Background`
/// → 帧 2 左上 4×4 蓝块（红底已被抹掉，画布透明）。
pub fn disposal_gif() -> Vec<u8> {
    // 调色板第 3 项留作透明色（GIF 需要一个索引承载"透明"，本夹具用不到
    // 局部透明，但保留它让调色板长度是 4 的幂次，避免编码器补位差异）
    let palette: Vec<u8> = vec![
        0xe0, 0x20, 0x20, // 0 红
        0x20, 0xc0, 0x20, // 1 绿
        0x20, 0x40, 0xe0, // 2 蓝
        0x00, 0x00, 0x00, // 3 占位
    ];
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, W, H, &palette).expect("GIF 编码器");
        enc.set_repeat(gif::Repeat::Finite(2)).expect("loop count");
        let mut push = |frame: gif::Frame<'static>| {
            let mut frame = frame;
            frame.make_lzw_pre_encoded();
            enc.write_lzw_pre_encoded_frame(&frame).expect("写帧");
        };
        push(gif::Frame {
            width: W,
            height: H,
            buffer: vec![0u8; (W * H) as usize].into(),
            delay: 10,
            dispose: gif::DisposalMethod::Keep,
            ..Default::default()
        });
        push(gif::Frame {
            left: 2,
            top: 2,
            width: 4,
            height: 4,
            buffer: vec![1u8; 16].into(),
            delay: 10,
            dispose: gif::DisposalMethod::Background,
            ..Default::default()
        });
        push(gif::Frame {
            left: 0,
            top: 0,
            width: 4,
            height: 4,
            buffer: vec![2u8; 16].into(),
            delay: 10,
            dispose: gif::DisposalMethod::Keep,
            ..Default::default()
        });
    }
    out
}

// ── APNG ────────────────────────────────────────────────────────────

/// 三帧整幅纯色，分数延时（1/25、1/10、3/50 秒 → 40 / 100 / 60 ms），
/// `num_plays = 1`（有限循环）。
pub fn pulse_apng() -> Vec<u8> {
    const COLOURS: [[u8; 4]; 3] = [
        [0x00, 0xc8, 0xd0, 0xff],
        [0xd0, 0x00, 0xa0, 0xff],
        [0xf4, 0xf4, 0xf0, 0xff],
    ];
    const DELAYS: [(u16, u16); 3] = [(1, 25), (1, 10), (3, 50)];
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(Cursor::new(&mut out), W as u32, H as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_animated(COLOURS.len() as u32, 1).expect("acTL");
        let mut writer = enc.write_header().expect("PNG 头");
        for (colour, (num, den)) in COLOURS.iter().zip(DELAYS) {
            writer.set_frame_delay(num, den).expect("fcTL delay");
            writer
                .set_dispose_op(png::DisposeOp::None)
                .expect("dispose_op");
            writer.set_blend_op(png::BlendOp::Source).expect("blend_op");
            let data: Vec<u8> = colour
                .iter()
                .copied()
                .cycle()
                .take((W * H) as usize * 4)
                .collect();
            writer.write_image_data(&data).expect("写帧");
        }
        writer.finish().expect("收尾");
    }
    out
}

/// 静态 PNG（拒绝路径用）。
pub fn static_png() -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(Cursor::new(&mut out), W as u32, H as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().expect("PNG 头");
        writer
            .write_image_data(&vec![0x80u8; (W * H) as usize * 4])
            .expect("写图");
        writer.finish().expect("收尾");
    }
    out
}

// ── 动画 WebP ───────────────────────────────────────────────────────

/// 三帧整幅纯色，delay 50 / 100 / 150 ms，无限循环。
///
/// `image` 只有**静态**无损 WebP 编码器，所以这里逐帧编成独立的无损 WebP、
/// 抠出各自的 `VP8L` 子块，再按 RIFF 规范手工装配 `VP8X` + `ANIM` + `ANMF`
/// 容器。装配是几十行纯字节拼接，比引入一个 C 依赖划算得多。
pub fn wave_webp() -> Vec<u8> {
    const COLOURS: [[u8; 4]; 3] = [
        [0x20, 0x80, 0xff, 0xff],
        [0xff, 0xa0, 0x20, 0xff],
        [0x40, 0xe0, 0x80, 0xff],
    ];
    const DELAYS_MS: [u32; 3] = [50, 100, 150];

    let mut body = Vec::new();
    // VP8X：仅置 ANIMATION 位（0x02），canvas 尺寸按"减一"编码
    let mut vp8x = vec![0x02u8, 0, 0, 0];
    vp8x.extend_from_slice(&u24(W as u32 - 1));
    vp8x.extend_from_slice(&u24(H as u32 - 1));
    body.extend_from_slice(&chunk(b"VP8X", &vp8x));
    // ANIM：背景色 BGRA + loop_count（0 = 无限）
    let mut anim = vec![0u8, 0, 0, 0];
    anim.extend_from_slice(&0u16.to_le_bytes());
    body.extend_from_slice(&chunk(b"ANIM", &anim));

    for (colour, duration) in COLOURS.iter().zip(DELAYS_MS) {
        let rgba: Vec<u8> = colour
            .iter()
            .copied()
            .cycle()
            .take((W * H) as usize * 4)
            .collect();
        let mut still = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut still)
            .encode(&rgba, W as u32, H as u32, image::ExtendedColorType::Rgba8)
            .expect("无损 WebP 编码");
        // "RIFF" + size + "WEBP" 之后就是单个 VP8L 子块，整块搬进 ANMF
        let vp8l = &still[12..];
        assert_eq!(&vp8l[..4], b"VP8L", "静态 WebP 应当只有一个 VP8L 子块");

        let mut anmf = Vec::new();
        anmf.extend_from_slice(&u24(0)); // frame_x（2 像素单位）
        anmf.extend_from_slice(&u24(0)); // frame_y
        anmf.extend_from_slice(&u24(W as u32 - 1));
        anmf.extend_from_slice(&u24(H as u32 - 1));
        anmf.extend_from_slice(&u24(duration));
        anmf.push(0); // blending = alpha blend，disposal = none
        anmf.extend_from_slice(vp8l);
        body.extend_from_slice(&chunk(b"ANMF", &anmf));
    }

    let mut out = Vec::with_capacity(body.len() + 12);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((body.len() + 4) as u32).to_le_bytes());
    out.extend_from_slice(b"WEBP");
    out.extend_from_slice(&body);
    out
}

/// RIFF 子块：fourcc + 小端长度 + 载荷（奇数长度补一个 0 字节）。
fn chunk(fourcc: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 9);
    out.extend_from_slice(fourcc);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    if payload.len() % 2 == 1 {
        out.push(0);
    }
    out
}

/// WebP 的 24 位小端整数。
fn u24(v: u32) -> [u8; 3] {
    [v as u8, (v >> 8) as u8, (v >> 16) as u8]
}

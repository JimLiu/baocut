//! ISO-BMFF 音轨编辑表（`elst`）的起点：解码后要丢掉多少编码器前置帧（priming）。
//!
//! ## 为什么要自己读
//!
//! AAC 编码器会在码流最前面垫一段前置帧（ffmpeg 的 `aac` 编码器 1024 帧，
//! AVFoundation 2112 帧），MP4 / M4A / MOV 用音轨的编辑表把它们挡在呈现时间轴
//! 之外：`elst` 第一段编辑的 `media_time` 就是「呈现时间 0 对应媒体时间轴的哪一刻」。
//! ffmpeg 与各家播放器都按它丢前缀；**Symphonia 0.6 的 isomp4 解复用器读了 `elst`
//! 却不应用**（它的 `demuxer.rs` 写明 edits are not currently supported），AAC
//! 解码器也不按 packet 裁剪，于是前置帧原样混进 PCM——纯 Rust 路径解出的整条音频
//! 比 ffmpeg 晚 `media_time` 帧（44.1 kHz 下 1024 帧 ≈ 23.2 ms）。Symphonia 的
//! `ElstAtom` 字段是私有的，只能在这里另读一遍。
//!
//! ## 口径（与 ffmpeg 解到 f32le 管道时一致）
//!
//! - 只回答**前缀要丢多少**：取选中音轨第一段非空编辑的 `media_time`。
//! - 不按 `segment_duration` 裁尾：ffmpeg CLI 解码同样把尾部 padding 留着
//!   （`core/fixtures/native-export/source.mp4` 上两边都解出 48128 帧）。
//! - 前置空编辑（`media_time = -1`，呈现延迟）不补静音；多段非空编辑只取第一段
//!   的起点；`media_rate ≠ 1` 不理会。这三种在素材里罕见，属于已知边界。
//!
//! ## 代价
//!
//! 只读 box 头和 `tkhd` / `mdhd` / `elst` 三种小 box，`stbl` 与 `mdat` 一律 seek
//! 跳过——几小时的片子也只是几十次小读，每次解码前查一遍不值得缓存。

use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

/// 顶层 box 类型白名单：第一个 box 不在其中就不是 ISO-BMFF，直接不查。
/// 老式 MOV 不一定以 `ftyp` 开头，`wide` / `mdat` / `moov` 打头的都见过。
const TOP_LEVEL_TYPES: &[&[u8; 4]] = &[
    b"ftyp", b"moov", b"mdat", b"free", b"skip", b"wide", b"pnot", b"uuid", b"styp",
];

/// 需要整块读进内存解析的 box 上限：`tkhd` / `mdhd` 几十字节，`elst` 每条 12 或
/// 20 字节。超过这个大小的必是坏文件，按「没有编辑表」处理。
const MAX_SMALL_BOX: u64 = 1 << 20;

/// 音轨第一段非空编辑的起点，单位是该轨 `mdhd` 的媒体时标。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditStart {
    /// `elst` 的 `media_time`（媒体时标 tick），恒大于 0。
    pub media_time: u64,
    /// 该轨 `mdhd` 的 timescale（每秒 tick 数），恒大于 0。
    pub timescale: u32,
}

impl EditStart {
    /// 换算成 `sample_rate` 下要丢掉的解码帧数（四舍五入）。
    ///
    /// 音轨的媒体时标通常就是采样率（此时逐帧精确），但规范不要求两者相等。
    pub fn frames(&self, sample_rate: u32) -> u64 {
        let timescale = u128::from(self.timescale);
        let scaled = u128::from(self.media_time) * u128::from(sample_rate);
        u64::try_from((scaled + timescale / 2) / timescale).unwrap_or(u64::MAX)
    }
}

/// 查 `path` 里 `track_id`（`tkhd.track_ID`，也就是 Symphonia 的 `Track::id`）
/// 那条轨的编辑表起点。
///
/// 返回 `None` 的情形：不是 ISO-BMFF、读不了、找不到这条轨、没有 `elst`、
/// 第一段非空编辑从 0 开始。全部等价于「不用丢前缀」，调用方照旧解码即可。
pub fn audio_edit_start(path: &Path, track_id: u32) -> Option<EditStart> {
    let file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    edit_start_in(&mut io::BufReader::new(file), len, track_id)
        .ok()
        .flatten()
}

fn edit_start_in<R: Read + Seek>(
    reader: &mut R,
    len: u64,
    track_id: u32,
) -> io::Result<Option<EditStart>> {
    // 先认类型再认尺寸：WAV / FLAC 的前 4 字节当 box 尺寸读必然越界，
    // 那不是「坏 MP4」，只是别的容器。
    let mut magic = [0u8; 8];
    if reader.read_exact(&mut magic).is_err() {
        return Ok(None);
    }
    if !TOP_LEVEL_TYPES.contains(&&[magic[4], magic[5], magic[6], magic[7]]) {
        return Ok(None);
    }
    let mut pos = 0;
    while let Some(header) = next_box(reader, pos, len)? {
        if &header.kind == b"moov" {
            return find_in_moov(reader, &header, track_id);
        }
        pos = header.end;
    }
    Ok(None)
}

fn find_in_moov<R: Read + Seek>(
    reader: &mut R,
    moov: &BoxHeader,
    track_id: u32,
) -> io::Result<Option<EditStart>> {
    let mut pos = moov.body;
    while let Some(child) = next_box(reader, pos, moov.end)? {
        if &child.kind == b"trak" {
            let trak = read_trak(reader, &child)?;
            if trak.track_id != Some(track_id) {
                pos = child.end;
                continue;
            }
            return Ok(match (trak.media_time, trak.timescale) {
                (Some(media_time), Some(timescale)) if media_time > 0 && timescale > 0 => {
                    Some(EditStart {
                        media_time,
                        timescale,
                    })
                }
                _ => None,
            });
        }
        pos = child.end;
    }
    Ok(None)
}

#[derive(Default)]
struct Trak {
    track_id: Option<u32>,
    timescale: Option<u32>,
    media_time: Option<u64>,
}

fn read_trak<R: Read + Seek>(reader: &mut R, trak: &BoxHeader) -> io::Result<Trak> {
    let mut out = Trak::default();
    let mut pos = trak.body;
    while let Some(child) = next_box(reader, pos, trak.end)? {
        match &child.kind {
            b"tkhd" => out.track_id = read_small(reader, &child)?.and_then(|b| parse_tkhd(&b)),
            b"edts" => {
                let mut inner = child.body;
                while let Some(grandchild) = next_box(reader, inner, child.end)? {
                    if &grandchild.kind == b"elst" {
                        out.media_time =
                            read_small(reader, &grandchild)?.and_then(|b| parse_elst(&b));
                    }
                    inner = grandchild.end;
                }
            }
            b"mdia" => {
                let mut inner = child.body;
                while let Some(grandchild) = next_box(reader, inner, child.end)? {
                    if &grandchild.kind == b"mdhd" {
                        out.timescale =
                            read_small(reader, &grandchild)?.and_then(|b| parse_mdhd(&b));
                    }
                    inner = grandchild.end;
                }
            }
            _ => {}
        }
        pos = child.end;
    }
    Ok(out)
}

struct BoxHeader {
    kind: [u8; 4],
    /// 载荷起点（跳过 size/type 与可能的 64 位 largesize）。
    body: u64,
    /// 本 box 的结尾（开区间）。
    end: u64,
}

/// 读 `pos` 处的 box 头；容器剩余不足一个头时返回 `None`。尺寸越界算坏文件。
fn next_box<R: Read + Seek>(reader: &mut R, pos: u64, end: u64) -> io::Result<Option<BoxHeader>> {
    if pos.saturating_add(8) > end {
        return Ok(None);
    }
    reader.seek(SeekFrom::Start(pos))?;
    let mut head = [0u8; 8];
    reader.read_exact(&mut head)?;
    let kind = [head[4], head[5], head[6], head[7]];
    let (header_len, size) = match u32::from_be_bytes([head[0], head[1], head[2], head[3]]) {
        // 64 位 largesize（大 mdat 常见）。
        1 => {
            let mut large = [0u8; 8];
            reader.read_exact(&mut large)?;
            (16, u64::from_be_bytes(large))
        }
        // 延伸到容器结尾。
        0 => (8, end - pos),
        size => (8, u64::from(size)),
    };
    if size < header_len || pos.saturating_add(size) > end {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "box 尺寸越界"));
    }
    Ok(Some(BoxHeader {
        kind,
        body: pos + header_len,
        end: pos + size,
    }))
}

fn read_small<R: Read + Seek>(reader: &mut R, header: &BoxHeader) -> io::Result<Option<Vec<u8>>> {
    let len = header.end - header.body;
    if len > MAX_SMALL_BOX {
        return Ok(None);
    }
    reader.seek(SeekFrom::Start(header.body))?;
    let mut bytes = vec![0u8; len as usize];
    reader.read_exact(&mut bytes)?;
    Ok(Some(bytes))
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn be_u64(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(bytes.get(at..at + 8)?.try_into().ok()?))
}

/// `tkhd`（FullBox）：v0 = 创建 4 + 修改 4 + track_ID；v1 = 8 + 8 + track_ID。
fn parse_tkhd(body: &[u8]) -> Option<u32> {
    match body.first()? {
        0 => be_u32(body, 12),
        1 => be_u32(body, 20),
        _ => None,
    }
}

/// `mdhd`（FullBox）：timescale 紧跟在创建 / 修改时间之后。
fn parse_mdhd(body: &[u8]) -> Option<u32> {
    match body.first()? {
        0 => be_u32(body, 12),
        1 => be_u32(body, 20),
        _ => None,
    }
}

/// `elst`（FullBox）：第一段非空编辑的 `media_time`。`-1` 是空编辑（呈现延迟），
/// 跳过；所有编辑都是空编辑时返回 `None`。
fn parse_elst(body: &[u8]) -> Option<u64> {
    let version = *body.first()?;
    let count = be_u32(body, 4)? as usize;
    let entry_len = match version {
        0 => 12,
        1 => 20,
        _ => return None,
    };
    (0..count).find_map(|index| {
        let at = 8 + index * entry_len;
        let media_time = if version == 1 {
            be_u64(body, at + 8)? as i64
        } else {
            i64::from(be_u32(body, at + 4)? as i32)
        };
        u64::try_from(media_time).ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn bx(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    fn full(version: u8, rest: &[u8]) -> Vec<u8> {
        let mut out = vec![version, 0, 0, 0];
        out.extend_from_slice(rest);
        out
    }

    fn tkhd(track_id: u32) -> Vec<u8> {
        let mut rest = vec![0u8; 8];
        rest.extend_from_slice(&track_id.to_be_bytes());
        rest.extend_from_slice(&[0u8; 68]);
        bx(b"tkhd", &full(0, &rest))
    }

    fn mdia(timescale: u32) -> Vec<u8> {
        let mut rest = vec![0u8; 8];
        rest.extend_from_slice(&timescale.to_be_bytes());
        rest.extend_from_slice(&[0u8; 8]);
        let mut stbl_padding = bx(b"hdlr", &full(0, b"\0\0\0\0soun"));
        stbl_padding.extend(bx(b"minf", &bx(b"stbl", &[0u8; 64])));
        let mut payload = bx(b"mdhd", &full(0, &rest));
        payload.extend(stbl_padding);
        bx(b"mdia", &payload)
    }

    /// v0 编辑表：`(segment_duration, media_time)`，速率恒为 1.0。
    fn edts_v0(entries: &[(u32, i32)]) -> Vec<u8> {
        let mut rest = (entries.len() as u32).to_be_bytes().to_vec();
        for (duration, media_time) in entries {
            rest.extend_from_slice(&duration.to_be_bytes());
            rest.extend_from_slice(&media_time.to_be_bytes());
            rest.extend_from_slice(&[0, 1, 0, 0]);
        }
        bx(b"edts", &bx(b"elst", &full(0, &rest)))
    }

    fn trak(track_id: u32, timescale: u32, edts: Option<Vec<u8>>) -> Vec<u8> {
        let mut payload = tkhd(track_id);
        payload.extend(edts.unwrap_or_default());
        payload.extend(mdia(timescale));
        bx(b"trak", &payload)
    }

    fn file(traks: &[Vec<u8>]) -> Vec<u8> {
        let mut out = bx(b"ftyp", b"M4A \0\0\0\0M4A isom");
        out.extend(bx(b"mdat", &[0xAB; 32]));
        let mut moov = bx(b"mvhd", &full(0, &[0u8; 96]));
        for trak in traks {
            moov.extend_from_slice(trak);
        }
        out.extend(bx(b"moov", &moov));
        out
    }

    fn lookup(bytes: &[u8], track_id: u32) -> Option<EditStart> {
        edit_start_in(&mut Cursor::new(bytes), bytes.len() as u64, track_id).unwrap()
    }

    #[test]
    fn the_first_edit_gives_the_priming_to_drop() {
        // ffmpeg 的 aac 编码器：44.1 kHz，1024 帧前置。
        let bytes = file(&[trak(1, 44_100, Some(edts_v0(&[(264_600, 1024)])))]);
        let start = lookup(&bytes, 1).unwrap();
        assert_eq!(
            start,
            EditStart {
                media_time: 1024,
                timescale: 44_100
            }
        );
        assert_eq!(start.frames(44_100), 1024);
        // 解码器按别的采样率报帧时按比例换算：1024 × 48000 / 44100 = 1114.6。
        assert_eq!(start.frames(48_000), 1115);
    }

    #[test]
    fn the_track_is_picked_by_tkhd_id() {
        let bytes = file(&[
            trak(1, 15_360, Some(edts_v0(&[(15_360, 40)]))),
            trak(2, 48_000, Some(edts_v0(&[(48_000, 2112)]))),
        ]);
        assert_eq!(lookup(&bytes, 2).unwrap().media_time, 2112);
        assert_eq!(lookup(&bytes, 1).unwrap().media_time, 40);
        assert_eq!(lookup(&bytes, 3), None);
    }

    #[test]
    fn empty_edits_are_skipped_and_a_zero_start_means_nothing_to_drop() {
        let delayed = file(&[trak(1, 48_000, Some(edts_v0(&[(500, -1), (48_000, 1024)])))]);
        assert_eq!(lookup(&delayed, 1).unwrap().media_time, 1024);
        let zero = file(&[trak(1, 48_000, Some(edts_v0(&[(48_000, 0)])))]);
        assert_eq!(lookup(&zero, 1), None);
        let only_empty = file(&[trak(1, 48_000, Some(edts_v0(&[(500, -1)])))]);
        assert_eq!(lookup(&only_empty, 1), None);
        let none = file(&[trak(1, 48_000, None)]);
        assert_eq!(lookup(&none, 1), None);
    }

    #[test]
    fn version_one_edit_lists_and_large_boxes_are_read() {
        let mut rest = 1u32.to_be_bytes().to_vec();
        rest.extend_from_slice(&48_000u64.to_be_bytes());
        rest.extend_from_slice(&2112i64.to_be_bytes());
        rest.extend_from_slice(&[0, 1, 0, 0]);
        let edts = bx(b"edts", &bx(b"elst", &full(1, &rest)));
        let mut bytes = bx(b"ftyp", b"qt  \0\0\0\0qt  ");
        // 64 位 largesize 的 mdat 排在 moov 前面。
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(b"mdat");
        bytes.extend_from_slice(&(16u64 + 8).to_be_bytes());
        bytes.extend_from_slice(&[0u8; 8]);
        bytes.extend(bx(b"moov", &trak(7, 48_000, Some(edts))));
        assert_eq!(lookup(&bytes, 7).unwrap().media_time, 2112);
    }

    #[test]
    fn non_iso_files_and_broken_boxes_are_ignored() {
        let mut wav = b"RIFF\x24\0\0\0WAVEfmt ".to_vec();
        wav.extend_from_slice(&[0u8; 64]);
        assert_eq!(lookup(&wav, 1), None);
        let mut broken = bx(b"ftyp", b"isom");
        broken.extend_from_slice(&0xFFFF_FFF0u32.to_be_bytes());
        broken.extend_from_slice(b"moov");
        assert!(edit_start_in(&mut Cursor::new(&broken), broken.len() as u64, 1).is_err());
        assert_eq!(
            audio_edit_start(Path::new("/definitely/not/here.m4a"), 1),
            None
        );
    }

    /// 入库夹具：ffmpeg 编出的 48 kHz 单声道 AAC，音轨（id 2）`elst media_time 1024`。
    #[test]
    fn the_native_export_fixture_reports_ffmpeg_priming() {
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-export/source.mp4");
        assert_eq!(
            audio_edit_start(&fixture, 2),
            Some(EditStart {
                media_time: 1024,
                timescale: 48_000
            })
        );
    }
}

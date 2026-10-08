//! `.lottie` 压缩包（dotLottie）：一个 zip，里面是 `manifest.json`、`animations/<id>.json` 与 `images/` 下的子资源。
//!
//! 只读中央目录，不读本地头里的长度（数据描述符一律忽略）：
//!
//! - 只认「存储」（0）与「deflate」（8）两种压缩；加密、ZIP64、分卷一律拒绝；
//! - 每一项先按中央目录声明的大小设上限（单项 [`MAX_ENTRY_BYTES`]、全部 [`MAX_TOTAL_BYTES`]、至多 [`MAX_ENTRIES`] 项），
//!   解压时按声明的大小截断，解出来的长度与 CRC-32 都要对得上；
//! - 名字只认相对路径：带 `..`、绝对路径、反斜杠、盘符或 NUL 的项让整个包作废——不往文件系统写东西，但这样的包本身就不可信。
//!
//! 选哪一段动画：`manifest.json` 的 `activeAnimationId`（第 1 版）或 `initial.animation`（第 2 版），都没有时取
//! `animations` 的第一项，再没有就取按名字排在最前的动画文件。动画在 `animations/<id>.json`（第 1 版）或
//! `a/<id>.json`（第 2 版）。图片子资源按 [`Archive::resolve`] 的次序在包里找。

use anyhow::{Result, anyhow, bail};
use std::collections::BTreeMap;

/// 包里至多这么多项。
pub const MAX_ENTRIES: usize = 4096;
/// 单项解压后至多这么大。
pub const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
/// 全部项解压后加起来至多这么大。
pub const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

const EOCD_SIGNATURE: u32 = 0x0605_4b50;
const ZIP64_LOCATOR_SIGNATURE: u32 = 0x0706_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const EOCD_LEN: usize = 22;

/// 字节是不是 zip（本地头或空包的结尾记录开头）。
pub fn looks_like_zip(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06")
}

#[derive(Debug, Clone)]
struct Entry {
    method: u16,
    crc: u32,
    compressed: u64,
    size: u64,
    local_offset: u64,
}

/// 读好中央目录的 zip：按名字取解压后的字节。
#[derive(Debug)]
pub struct Archive<'a> {
    bytes: &'a [u8],
    entries: BTreeMap<String, Entry>,
}

fn u16_at(bytes: &[u8], at: usize) -> Result<u16> {
    bytes
        .get(at..at + 2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .ok_or_else(|| anyhow!("zip 截断了（偏移 {at}）"))
}

fn u32_at(bytes: &[u8], at: usize) -> Result<u32> {
    bytes
        .get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| anyhow!("zip 截断了（偏移 {at}）"))
}

/// 包里的名字规范成 `a/b/c`：去掉开头的 `./`；不安全的名字报错。
fn normalise(name: &str) -> Result<String> {
    if name.is_empty()
        || name.contains('\\')
        || name.contains('\0')
        || name.starts_with('/')
        || name.contains(':')
    {
        bail!("zip 里有不安全的名字 {name:?}");
    }
    let mut parts = Vec::new();
    for part in name.split('/') {
        match part {
            "" | "." => {}
            ".." => bail!("zip 里有不安全的名字 {name:?}"),
            other => parts.push(other),
        }
    }
    Ok(parts.join("/"))
}

impl<'a> Archive<'a> {
    /// 读结尾记录与中央目录。只校验结构与上限，不解压。
    pub fn open(bytes: &'a [u8]) -> Result<Archive<'a>> {
        if bytes.len() < EOCD_LEN {
            bail!("不是 zip：太短");
        }
        // 结尾记录在最后 22 字节到 22 + 65535（注释）之间，从后往前找。
        let last = bytes.len() - EOCD_LEN;
        let first = last.saturating_sub(u16::MAX as usize);
        let eocd = (first..=last)
            .rev()
            .find(|&at| u32_at(bytes, at).ok() == Some(EOCD_SIGNATURE))
            .ok_or_else(|| anyhow!("不是 zip：找不到中央目录的结尾记录"))?;
        if eocd >= 20 && u32_at(bytes, eocd - 20)? == ZIP64_LOCATOR_SIGNATURE {
            bail!("不支持 ZIP64 的 zip");
        }
        let (disk, cd_disk) = (u16_at(bytes, eocd + 4)?, u16_at(bytes, eocd + 6)?);
        let (on_disk, count) = (u16_at(bytes, eocd + 8)?, u16_at(bytes, eocd + 10)?);
        let (cd_size, cd_offset) = (u32_at(bytes, eocd + 12)?, u32_at(bytes, eocd + 16)?);
        if count == u16::MAX || cd_size == u32::MAX || cd_offset == u32::MAX {
            bail!("不支持 ZIP64 的 zip");
        }
        if disk != 0 || cd_disk != 0 || on_disk != count {
            bail!("不支持分卷的 zip");
        }
        if usize::from(count) > MAX_ENTRIES {
            bail!("zip 里的项太多（{count}，至多 {MAX_ENTRIES}）");
        }
        let cd_start = cd_offset as usize;
        let cd_end = cd_start
            .checked_add(cd_size as usize)
            .filter(|&end| end <= eocd)
            .ok_or_else(|| anyhow!("zip 的中央目录越界"))?;

        let mut entries = BTreeMap::new();
        let mut total = 0u64;
        let mut at = cd_start;
        for _ in 0..count {
            if at + 46 > cd_end || u32_at(bytes, at)? != CENTRAL_SIGNATURE {
                bail!("zip 的中央目录坏了（偏移 {at}）");
            }
            let flags = u16_at(bytes, at + 8)?;
            let method = u16_at(bytes, at + 10)?;
            let crc = u32_at(bytes, at + 16)?;
            let compressed = u32_at(bytes, at + 20)?;
            let size = u32_at(bytes, at + 24)?;
            let name_len = usize::from(u16_at(bytes, at + 28)?);
            let extra_len = usize::from(u16_at(bytes, at + 30)?);
            let comment_len = usize::from(u16_at(bytes, at + 32)?);
            let local_offset = u32_at(bytes, at + 42)?;
            let name_end = at + 46 + name_len;
            let next = name_end + extra_len + comment_len;
            if next > cd_end {
                bail!("zip 的中央目录坏了（偏移 {at}）");
            }
            let raw_name = std::str::from_utf8(&bytes[at + 46..name_end])
                .map_err(|_| anyhow!("zip 里有不是 UTF-8 的名字"))?;
            at = next;
            if flags & 1 != 0 {
                bail!("不支持加密的 zip（{raw_name}）");
            }
            if compressed == u32::MAX || size == u32::MAX || local_offset == u32::MAX {
                bail!("不支持 ZIP64 的 zip");
            }
            let name = normalise(raw_name)?;
            if raw_name.ends_with('/') {
                continue; // 目录
            }
            if !matches!(method, 0 | 8) {
                bail!("zip 里的 {name} 用了不支持的压缩方式 {method}（只认存储与 deflate）");
            }
            if method == 0 && compressed != size {
                bail!("zip 里的 {name} 是存储的，压缩前后的大小却不同");
            }
            if u64::from(size) > MAX_ENTRY_BYTES {
                bail!("zip 里的 {name} 解压后太大（{size} 字节，至多 {MAX_ENTRY_BYTES}）");
            }
            total += u64::from(size);
            if total > MAX_TOTAL_BYTES {
                bail!("zip 解压后加起来太大（至多 {MAX_TOTAL_BYTES} 字节）");
            }
            let entry = Entry {
                method,
                crc,
                compressed: u64::from(compressed),
                size: u64::from(size),
                local_offset: u64::from(local_offset),
            };
            if entries.insert(name.clone(), entry).is_some() {
                bail!("zip 里有重名的项 {name}");
            }
        }
        Ok(Archive { bytes, entries })
    }

    /// 包里的文件名（规范化之后，按名字排序；不含目录）。
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    /// 解出一项（名字按 [`normalise`] 的规则比较）；没有这一项是 `Ok(None)`。
    pub fn read(&self, name: &str) -> Result<Option<Vec<u8>>> {
        let Ok(name) = normalise(name) else {
            return Ok(None);
        };
        let Some(entry) = self.entries.get(&name) else {
            return Ok(None);
        };
        let at = usize::try_from(entry.local_offset).map_err(|_| anyhow!("zip 的 {name} 越界"))?;
        if u32_at(self.bytes, at)? != LOCAL_SIGNATURE {
            bail!("zip 的 {name} 本地头坏了");
        }
        let name_len = usize::from(u16_at(self.bytes, at + 26)?);
        let extra_len = usize::from(u16_at(self.bytes, at + 28)?);
        let start = at + 30 + name_len + extra_len;
        let end = start
            .checked_add(entry.compressed as usize)
            .filter(|&end| end <= self.bytes.len())
            .ok_or_else(|| anyhow!("zip 的 {name} 越界"))?;
        let data = &self.bytes[start..end];
        let out = match entry.method {
            0 => data.to_vec(),
            _ => miniz_oxide::inflate::decompress_to_vec_with_limit(data, entry.size as usize)
                .map_err(|e| anyhow!("zip 的 {name} 解压失败：{:?}", e.status))?,
        };
        if out.len() as u64 != entry.size {
            bail!("zip 的 {name} 解压后的大小与声明的不同");
        }
        if crc32(&out) != entry.crc {
            bail!("zip 的 {name} 校验和不对");
        }
        Ok(Some(out))
    }

    /// 选一段动画（见模块说明），返回它在包里的名字与 JSON 字节。
    pub fn animation(&self) -> Result<(String, Vec<u8>)> {
        let manifest = self
            .read("manifest.json")?
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
        let wanted = manifest.as_ref().and_then(|m| {
            m.get("activeAnimationId")
                .and_then(serde_json::Value::as_str)
                .or_else(|| m.get("initial")?.get("animation")?.as_str())
                .or_else(|| {
                    m.get("animations")?
                        .as_array()?
                        .first()?
                        .get("id")?
                        .as_str()
                })
                .map(str::to_owned)
        });
        if let Some(id) = wanted {
            for name in [format!("animations/{id}.json"), format!("a/{id}.json")] {
                if let Some(bytes) = self.read(&name)? {
                    return Ok((name, bytes));
                }
            }
        }
        let first = self
            .names()
            .find(|name| {
                (name.starts_with("animations/") || name.starts_with("a/"))
                    && name.ends_with(".json")
            })
            .map(str::to_owned)
            .ok_or_else(|| anyhow!("`.lottie` 包里没有动画（animations/*.json 或 a/*.json）"))?;
        let bytes = self.read(&first)?.expect("名字来自目录");
        Ok((first, bytes))
    }

    /// 图片子资源（bodymovin 的 `u` + `p`）在包里的字节：依次找这个路径本身（去掉开头的 `/`，打包工具常写
    /// `/images/`）、`images/<文件名>`、`i/<文件名>`、`<文件名>`。
    pub fn resolve(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let file_name = path.rsplit('/').next().unwrap_or(path);
        let candidates = [
            path.trim_start_matches('/').to_owned(),
            format!("images/{file_name}"),
            format!("i/{file_name}"),
            file_name.to_owned(),
        ];
        for candidate in candidates {
            if let Some(bytes) = self.read(&candidate)? {
                return Ok(Some(bytes));
            }
        }
        Ok(None)
    }
}

/// CRC-32（IEEE，zip 用的那一个）。
pub fn crc32(bytes: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        for (n, slot) in table.iter_mut().enumerate() {
            let mut c = n as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    0xEDB8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
            *slot = c;
        }
        table
    });
    !bytes.iter().fold(!0u32, |c, &b| {
        table[((c ^ u32::from(b)) & 0xff) as usize] ^ (c >> 8)
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// 手拼一个 zip：`(名字, 内容, 是否 deflate)`。
    pub(crate) fn zip(files: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, data, deflate) in files {
            let packed = if *deflate {
                miniz_oxide::deflate::compress_to_vec(data, 6)
            } else {
                data.to_vec()
            };
            let method: u16 = if *deflate { 8 } else { 0 };
            let offset = out.len() as u32;
            let crc = crc32(data);
            out.extend(LOCAL_SIGNATURE.to_le_bytes());
            out.extend(20u16.to_le_bytes());
            out.extend(0u16.to_le_bytes());
            out.extend(method.to_le_bytes());
            out.extend([0u8; 4]);
            out.extend(crc.to_le_bytes());
            out.extend((packed.len() as u32).to_le_bytes());
            out.extend((data.len() as u32).to_le_bytes());
            out.extend((name.len() as u16).to_le_bytes());
            out.extend(0u16.to_le_bytes());
            out.extend(name.as_bytes());
            out.extend(&packed);

            central.extend(CENTRAL_SIGNATURE.to_le_bytes());
            central.extend(20u16.to_le_bytes());
            central.extend(20u16.to_le_bytes());
            central.extend(0u16.to_le_bytes());
            central.extend(method.to_le_bytes());
            central.extend([0u8; 4]);
            central.extend(crc.to_le_bytes());
            central.extend((packed.len() as u32).to_le_bytes());
            central.extend((data.len() as u32).to_le_bytes());
            central.extend((name.len() as u16).to_le_bytes());
            central.extend([0u8; 12]);
            central.extend(offset.to_le_bytes());
            central.extend(name.as_bytes());
        }
        let cd_offset = out.len() as u32;
        out.extend(&central);
        out.extend(EOCD_SIGNATURE.to_le_bytes());
        out.extend([0u8; 4]);
        out.extend((files.len() as u16).to_le_bytes());
        out.extend((files.len() as u16).to_le_bytes());
        out.extend((central.len() as u32).to_le_bytes());
        out.extend(cd_offset.to_le_bytes());
        out.extend(0u16.to_le_bytes());
        out
    }

    #[test]
    fn crc32_matches_the_reference_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn stored_and_deflated_entries_read_back() {
        let big = b"lottie ".repeat(200);
        let bytes = zip(&[("a.txt", b"hello", false), ("dir/b.txt", &big, true)]);
        let archive = Archive::open(&bytes).unwrap();
        assert_eq!(archive.names().collect::<Vec<_>>(), ["a.txt", "dir/b.txt"]);
        assert_eq!(archive.read("a.txt").unwrap().unwrap(), b"hello");
        assert_eq!(archive.read("./dir/b.txt").unwrap().unwrap(), big);
        assert!(archive.read("missing").unwrap().is_none());
        assert!(archive.read("../a.txt").unwrap().is_none());
    }

    #[test]
    fn unsafe_names_and_broken_archives_are_refused() {
        for name in [
            "../evil.json",
            "/abs.json",
            "a\\b.json",
            "c:/x.json",
            "a/../../b",
        ] {
            let error = Archive::open(&zip(&[(name, b"x", false)]))
                .unwrap_err()
                .to_string();
            assert!(error.contains("不安全"), "{name}: {error}");
        }
        assert!(Archive::open(b"PK\x03\x04rest").is_err());
        // 内容被改：CRC 对不上。
        let mut bytes = zip(&[("a.txt", b"hello", false)]);
        let at = bytes.windows(5).position(|w| w == b"hello").unwrap();
        bytes[at] = b'j';
        let archive = Archive::open(&bytes).unwrap();
        assert!(
            archive
                .read("a.txt")
                .unwrap_err()
                .to_string()
                .contains("校验和")
        );
        // 中央目录声明的大小比实际小：按声明截断，大小对不上。
        let mut bytes = zip(&[("b.txt", &b"x".repeat(1000), true)]);
        let cd = bytes
            .windows(4)
            .rposition(|w| w == CENTRAL_SIGNATURE.to_le_bytes())
            .unwrap();
        bytes[cd + 24..cd + 28].copy_from_slice(&10u32.to_le_bytes());
        let archive = Archive::open(&bytes).unwrap();
        assert!(archive.read("b.txt").is_err());
    }

    #[test]
    fn the_manifest_picks_the_animation() {
        let manifest = br#"{"animations":[{"id":"second"}],"activeAnimationId":"main"}"#;
        let bytes = zip(&[
            ("manifest.json", manifest, true),
            ("animations/first.json", b"{\"a\":1}", true),
            ("animations/main.json", b"{\"a\":2}", true),
        ]);
        let archive = Archive::open(&bytes).unwrap();
        assert_eq!(
            archive.animation().unwrap(),
            ("animations/main.json".into(), b"{\"a\":2}".to_vec())
        );
        // 没有清单：按名字取第一段。
        let bytes = zip(&[
            ("animations/b.json", b"{}", false),
            ("animations/a.json", b"[]", false),
        ]);
        assert_eq!(
            Archive::open(&bytes).unwrap().animation().unwrap().0,
            "animations/a.json"
        );
        let bytes = zip(&[("images/x.png", b"", false)]);
        assert!(Archive::open(&bytes).unwrap().animation().is_err());
        // 第 2 版的布局。
        let bytes = zip(&[
            (
                "manifest.json",
                br#"{"initial":{"animation":"b"},"animations":[{"id":"a"},{"id":"b"}]}"#,
                false,
            ),
            ("a/a.json", b"1", false),
            ("a/b.json", b"2", false),
        ]);
        assert_eq!(
            Archive::open(&bytes).unwrap().animation().unwrap().0,
            "a/b.json"
        );
    }

    #[test]
    fn image_paths_resolve_inside_the_archive() {
        let bytes = zip(&[
            ("images/img_0.png", b"png", false),
            ("i/v2.png", b"two", false),
        ]);
        let archive = Archive::open(&bytes).unwrap();
        assert_eq!(
            archive.resolve("/images/img_0.png").unwrap().unwrap(),
            b"png"
        );
        assert_eq!(
            archive.resolve("images/img_0.png").unwrap().unwrap(),
            b"png"
        );
        assert_eq!(archive.resolve("img_0.png").unwrap().unwrap(), b"png");
        assert_eq!(archive.resolve("/i/v2.png").unwrap().unwrap(), b"two");
        assert!(archive.resolve("../images/nope.png").unwrap().is_none());
    }
}

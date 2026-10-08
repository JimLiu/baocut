//! 按字体族名找本机字体（架构设计 §9.1）。移植自 BaoCut v2 `bcut-render` 的系统字体库
//! （`system_font_db`、`system_font_files`、`FaceNames`）。
//!
//! 单位是 face：渲染时一段文字按「族名、字重、斜体」挑字体（与排版引擎同一套 CSS 匹配，`fontdb::Database::query`），
//! 所以这里也按这三样在本机字体里挑出那一个 face（哪个文件、文件里第几个），见 [`FontLibrary::resolve_face`]。
//! 导出（原生，直接读文件）与预览（WASM 读不到本机字体，由宿主按这里的解析把字节送过去）都只装挑出来的 face：
//! 系统的中文字体集合（`.ttc`，苹方约 75 MB、24 个 face）只取用到的那一个（[`FaceLayout`]，抽出它的表拼成一个单独的
//! 字体），两边装进去的字节相同，挑到的 face 也相同。只按用到的去找，有大小上限（[`MAX_FACE_BYTES`]）；不列、不送整个
//! 字体目录。
//!
//! 测试钩子：环境变量 [`FONT_DIRS_ENV`] 设了时只扫它列出的目录（按平台的路径列表分隔），不再扫本机字体；
//! 设成空串就是一个字体也没有。测试据此不依赖这台机器上恰好装了什么字体。

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::SystemTime;

/// 只扫这些目录、不扫本机字体的环境变量（测试用）。
pub const FONT_DIRS_ENV: &str = "BAOCUT_FONT_DIRS";

/// 一个 face 抽出来之后的上限（苹方的一个 face 约 13 MB），再大的不送。
pub const MAX_FACE_BYTES: u64 = 96 * 1024 * 1024;

/// 要找的 face：族名（或 PostScript 名）、字重（100–900）、是否斜体。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FaceQuery {
    pub family: String,
    pub weight: u16,
    pub italic: bool,
}

/// 挑出来的 face：文件、文件里第几个 face（不是集合时是 0）与文件的字节数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontFace {
    pub path: PathBuf,
    pub index: u32,
    pub file_len: u64,
}

/// 找不到的原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Missing {
    /// 本机没有这个族。
    NotFound,
    /// 有，但抽出来的 face 超过上限。
    TooLarge,
}

impl Missing {
    /// 协议里的原因码。
    pub fn code(self) -> &'static str {
        match self {
            Missing::NotFound => "not-found",
            Missing::TooLarge => "too-large",
        }
    }
}

/// 一个字体 face 的名字：族名（所有语言的写法）与 PostScript 名。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaceNames {
    pub families: Vec<String>,
    pub post_script_name: String,
}

impl FaceNames {
    /// 族名或 PostScript 名等于 `name`（族名不分大小写）。
    pub fn matches(&self, name: &str) -> bool {
        self.post_script_name == name || self.families.iter().any(|family| family.eq_ignore_ascii_case(name))
    }
}

fn face_names(face: &fontdb::FaceInfo) -> FaceNames {
    FaceNames {
        families: face.families.iter().map(|(family, _)| family.clone()).collect(),
        post_script_name: face.post_script_name.clone(),
    }
}

/// 一批字体文件的索引（只读了各文件的名字表，没有留字节）。
pub struct FontLibrary {
    db: fontdb::Database,
    /// 扫的时候各字体目录的修改时间（[`Self::changed`] 据此判断装没装过新字体）。
    watched: Vec<(PathBuf, Option<SystemTime>)>,
}

static SYSTEM: OnceLock<FontLibrary> = OnceLock::new();

/// 往上看几层目录：系统下载的字体在 `…/某个资源/AssetData/字体.ttc`，新装的资源是上两层目录里多出来的一项。
const WATCH_ANCESTORS: usize = 3;

/// 本机字体所在的根目录（与 `fontdb` 扫的那些对应；用户字体目录一开始可能是空的，也看着）。
fn system_font_roots() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut roots: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        roots.extend(
            [
                "/Library/Fonts",
                "/System/Library/Fonts",
                "/System/Library/AssetsV2",
                "/Network/Library/Fonts",
            ]
            .map(PathBuf::from),
        );
        roots.extend(home.iter().map(|home| home.join("Library/Fonts")));
    } else if cfg!(windows) {
        roots.extend(std::env::var_os("SYSTEMROOT").map(|root| PathBuf::from(root).join("Fonts")));
        roots.extend(std::env::var_os("LOCALAPPDATA").map(|root| PathBuf::from(root).join("Microsoft/Windows/Fonts")));
    } else {
        roots.extend(["/usr/share/fonts", "/usr/local/share/fonts"].map(PathBuf::from));
        roots.extend(home.iter().flat_map(|home| [home.join(".local/share/fonts"), home.join(".fonts")]));
    }
    roots
}

fn modified(dir: &Path) -> Option<SystemTime> {
    std::fs::metadata(dir).and_then(|m| m.modified()).ok()
}

impl FontLibrary {
    /// 进程内只扫一次的本机字体库（[`Self::scan`]）。
    pub fn system() -> &'static FontLibrary {
        SYSTEM.get_or_init(FontLibrary::scan)
    }

    /// 扫一遍本机字体（全机约 0.1–0.6 秒）；设了 [`FONT_DIRS_ENV`] 时只扫它列出的目录。
    pub fn scan() -> FontLibrary {
        match std::env::var_os(FONT_DIRS_ENV) {
            Some(dirs) => FontLibrary::from_dirs(&std::env::split_paths(&dirs).collect::<Vec<_>>()),
            None => {
                let mut db = fontdb::Database::new();
                db.load_system_fonts();
                FontLibrary::indexed(db, &system_font_roots())
            }
        }
    }

    /// 只装这些目录里的字体（递归；读不到的目录跳过）。
    pub fn from_dirs(dirs: &[PathBuf]) -> FontLibrary {
        let mut db = fontdb::Database::new();
        let dirs: Vec<PathBuf> = dirs.iter().filter(|dir| !dir.as_os_str().is_empty()).cloned().collect();
        for dir in &dirs {
            db.load_fonts_dir(dir);
        }
        FontLibrary::indexed(db, &dirs)
    }

    /// 记下要看的目录：字体根目录，与每个字体文件往上几层、还在某个根目录里的目录（根目录之外的家目录之类常常在变，
    /// 不看；不在任何根目录里的文件只看它所在的目录）。
    fn indexed(db: fontdb::Database, roots: &[PathBuf]) -> FontLibrary {
        let mut dirs: std::collections::BTreeSet<PathBuf> = roots.iter().cloned().collect();
        for face in db.faces() {
            if let fontdb::Source::File(path) = &face.source {
                let mut inside = path
                    .ancestors()
                    .skip(1)
                    .take(WATCH_ANCESTORS)
                    .filter(|dir| roots.iter().any(|root| dir.starts_with(root)))
                    .peekable();
                if inside.peek().is_none() {
                    dirs.extend(path.parent().map(Path::to_path_buf));
                }
                dirs.extend(inside.map(Path::to_path_buf));
            }
        }
        let watched = dirs
            .into_iter()
            .map(|dir| {
                let at = modified(&dir);
                (dir, at)
            })
            .collect();
        FontLibrary { db, watched }
    }

    /// 扫过之后字体目录有没有变（装了、删了字体）：只看各目录自己的修改时间，几百次 `stat`，不重读字体。
    pub fn changed(&self) -> bool {
        self.watched.iter().any(|(dir, at)| modified(dir) != *at)
    }

    /// 这批字体里所有的族名（每个 face 取它的第一个族名，即英文名；去重、按名字排好）。只有名字，不带文件路径：
    /// 选字列表据此标出「本机已装」的族。
    pub fn families(&self) -> Vec<String> {
        let names: std::collections::BTreeSet<String> = self
            .db
            .faces()
            .filter_map(|face| face.families.first().map(|(name, _)| name.trim().to_string()))
            .filter(|name| !name.is_empty() && !name.starts_with('.'))
            .collect();
        names.into_iter().collect()
    }

    /// 按族名、字重与斜体挑一个 face：与排版引擎同一套 CSS 匹配（`fontdb::Database::query`，族名按原样比较），所以
    /// 渲染器里只装这一个 face 时挑到的就是它。族名大小写不对时按写法对的那个族挑；都不是族名时按 PostScript 名
    /// 精确找。抽出来超过 [`MAX_FACE_BYTES`] 的不要。同一个请求每次挑到同一个 face。
    pub fn resolve_face(&self, query: &FaceQuery) -> Result<FontFace, Missing> {
        self.resolve_face_within(query, MAX_FACE_BYTES)
    }

    /// [`Self::resolve_face`]，按给定的上限。
    pub fn resolve_face_within(&self, query: &FaceQuery, max_bytes: u64) -> Result<FontFace, Missing> {
        let family = query.family.trim();
        if family.is_empty() {
            return Err(Missing::NotFound);
        }
        let by_family = |name: &str| {
            self.db.query(&fontdb::Query {
                families: &[fontdb::Family::Name(name)],
                weight: fontdb::Weight(query.weight),
                stretch: fontdb::Stretch::Normal,
                style: if query.italic {
                    fontdb::Style::Italic
                } else {
                    fontdb::Style::Normal
                },
            })
        };
        let id = by_family(family)
            .or_else(|| {
                let canonical = self
                    .db
                    .faces()
                    .flat_map(|face| face.families.iter().map(|(name, _)| name))
                    .find(|name| name.eq_ignore_ascii_case(family))?;
                by_family(canonical)
            })
            .or_else(|| {
                self.db
                    .faces()
                    .find(|face| face_names(face).post_script_name == family)
                    .map(|face| face.id)
            })
            .ok_or(Missing::NotFound)?;
        let face = self.db.face(id).ok_or(Missing::NotFound)?;
        // 本机字体按文件装入（`load_system_fonts` / `load_fonts_dir` → `Source::File`）。
        let fontdb::Source::File(path) = &face.source else {
            return Err(Missing::NotFound);
        };
        let file_len = std::fs::metadata(path)
            .ok()
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .ok_or(Missing::NotFound)?;
        let layout = std::fs::File::open(path)
            .and_then(|mut file| FaceLayout::read(&mut file, file_len, face.index))
            .map_err(|_| Missing::NotFound)?;
        if u64::from(layout.size) > max_bytes {
            return Err(Missing::TooLarge);
        }
        Ok(FontFace {
            path: path.clone(),
            index: face.index,
            file_len,
        })
    }
}

/// 一张表搬到哪里：原文件里从 `from` 起的 `len` 个字节，放到新字体的 `to`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TableCopy {
    pub from: u64,
    pub len: u32,
    pub to: u32,
}

/// 把字体文件（或字体集合里的一个 face）抽成一个单独字体的做法：新的文件头（版本与表目录，表的位置改成新的），
/// 加上每张表从原文件搬到哪里。表的内容原样搬，按 4 字节对齐依次排在表目录之后，空隙补零。读的时候查过边界：
/// 每张表都在文件里，表目录不超过 [`MAX_TABLES`] 项。预览（经读取句柄按区间取）与导出（读文件）按同一个做法拼，
/// 得到的字节相同。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaceLayout {
    pub header: Vec<u8>,
    pub tables: Vec<TableCopy>,
    /// 拼好之后的字节数。
    pub size: u32,
}

/// 一个 face 最多几张表（真实字体二三十张）。
pub const MAX_TABLES: usize = 512;

fn invalid(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, format!("字体文件不对：{message}"))
}

fn read_at<R: Read + Seek>(reader: &mut R, file_len: u64, at: u64, len: usize) -> std::io::Result<Vec<u8>> {
    if at.checked_add(len as u64).is_none_or(|end| end > file_len) {
        return Err(invalid("读到了文件末尾之外"));
    }
    reader.seek(SeekFrom::Start(at))?;
    let mut bytes = vec![0; len];
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn be32(bytes: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

fn be16(bytes: &[u8], at: usize) -> u16 {
    u16::from_be_bytes([bytes[at], bytes[at + 1]])
}

/// sfnt 的版本：TrueType（`0x00010000`、`true`）与 CFF（`OTTO`）。
fn is_sfnt(version: u32) -> bool {
    matches!(version, 0x0001_0000 | 0x7472_7565 | 0x4F54_544F)
}

impl FaceLayout {
    /// 读文件头与表目录，算出第 `index` 个 face 怎样拼（`file_len` 是文件的字节数）。不是集合的文件只有第 0 个。
    pub fn read<R: Read + Seek>(reader: &mut R, file_len: u64, index: u32) -> std::io::Result<FaceLayout> {
        let head = read_at(reader, file_len, 0, 12)?;
        let offset = if &head[0..4] == b"ttcf" {
            let count = be32(&head, 8);
            if index >= count {
                return Err(invalid("集合里没有这个 face"));
            }
            let entry = read_at(reader, file_len, 12 + u64::from(index) * 4, 4)?;
            u64::from(be32(&entry, 0))
        } else if index == 0 {
            0
        } else {
            return Err(invalid("不是字体集合，只有第 0 个 face"));
        };
        let directory = read_at(reader, file_len, offset, 12)?;
        let version = be32(&directory, 0);
        if !is_sfnt(version) {
            return Err(invalid("不认识的字体格式"));
        }
        let count = usize::from(be16(&directory, 4));
        if count == 0 || count > MAX_TABLES {
            return Err(invalid("表目录的项数不对"));
        }
        let records = read_at(reader, file_len, offset + 12, count * 16)?;
        let mut header = Vec::with_capacity(12 + count * 16);
        header.extend_from_slice(&version.to_be_bytes());
        header.extend_from_slice(&(count as u16).to_be_bytes());
        // searchRange、entrySelector、rangeShift 按 OpenType 的定义重算。
        let selector = (count as u32).ilog2();
        let range = (1u32 << selector) * 16;
        header.extend_from_slice(&(range as u16).to_be_bytes());
        header.extend_from_slice(&(selector as u16).to_be_bytes());
        header.extend_from_slice(&((count as u32 * 16 - range) as u16).to_be_bytes());
        let mut tables = Vec::with_capacity(count);
        let mut at: u64 = 12 + count as u64 * 16;
        for record in records.chunks_exact(16) {
            let from = u64::from(be32(record, 8));
            let len = be32(record, 12);
            if from.checked_add(u64::from(len)).is_none_or(|end| end > file_len) {
                return Err(invalid("表在文件之外"));
            }
            let to = u32::try_from(at).map_err(|_| invalid("抽出来的字体太大"))?;
            header.extend_from_slice(&record[0..8]);
            header.extend_from_slice(&to.to_be_bytes());
            header.extend_from_slice(&len.to_be_bytes());
            tables.push(TableCopy { from, len, to });
            at += u64::from(len).next_multiple_of(4);
        }
        let size = u32::try_from(at).map_err(|_| invalid("抽出来的字体太大"))?;
        Ok(FaceLayout { header, tables, size })
    }

    /// 按这个做法从 `reader`（原文件）拼出单独的字体。
    pub fn assemble<R: Read + Seek>(&self, reader: &mut R, file_len: u64) -> std::io::Result<Vec<u8>> {
        let mut out = vec![0u8; self.size as usize];
        out[..self.header.len()].copy_from_slice(&self.header);
        for table in &self.tables {
            let bytes = read_at(reader, file_len, table.from, table.len as usize)?;
            let to = table.to as usize;
            out[to..to + bytes.len()].copy_from_slice(&bytes);
        }
        Ok(out)
    }
}

/// 一个字体文件里的一个 face 是什么：第几个、名字、字重与是否斜体。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaceSummary {
    pub index: u32,
    pub names: FaceNames,
    pub weight: u16,
    pub italic: bool,
}

/// 检查一个字体文件（例如刚下载的）：不超过 `max_bytes`，按渲染用的同一套解析（`fontdb`）读得出 face，每个 face 的
/// 表都在文件之内（[`FaceLayout`]）。给出每个 face 的名字、字重与斜体；读不出任何 face 的是坏文件。只读名字表与表目录，
/// 不执行文件里的任何东西。
pub fn inspect_file(path: &Path, max_bytes: u64) -> std::io::Result<Vec<FaceSummary>> {
    let len = file_len(path)?;
    if len > max_bytes {
        return Err(invalid(&format!("文件有 {len} 字节，超过上限 {max_bytes}")));
    }
    let bytes = std::fs::read(path)?;
    let mut db = fontdb::Database::new();
    db.load_font_data(bytes.clone());
    let mut faces = Vec::new();
    for face in db.faces() {
        FaceLayout::read(&mut std::io::Cursor::new(&bytes), len, face.index)?;
        faces.push(FaceSummary {
            index: face.index,
            names: face_names(face),
            weight: face.weight.0,
            italic: face.style != fontdb::Style::Normal,
        });
    }
    if faces.is_empty() {
        return Err(invalid("读不出任何字体"));
    }
    faces.sort_by_key(|face| face.index);
    Ok(faces)
}

/// 从一份字体文件的字节里抽出第 `index` 个 face（[`FaceLayout`]）。
pub fn extract_face(file: &[u8], index: u32) -> std::io::Result<Vec<u8>> {
    let mut reader = std::io::Cursor::new(file);
    let layout = FaceLayout::read(&mut reader, file.len() as u64, index)?;
    layout.assemble(&mut reader, file.len() as u64)
}

/// 读出一个挑好的 face（导出直接装进渲染器）。
pub fn read_face(face: &FontFace) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(&face.path)?;
    let len = file_len(&face.path)?;
    let layout = FaceLayout::read(&mut file, len, face.index)?;
    layout.assemble(&mut file, len)
}

fn file_len(path: &Path) -> std::io::Result<u64> {
    Ok(std::fs::metadata(path)?.len())
}

//! 内嵌数据：`include_bytes!` 编进二进制，首次使用时 zlib 解压（格式见 `data/README.md`）。

use std::collections::HashMap;
use std::io::Read;
use std::sync::LazyLock;

use flate2::read::ZlibDecoder;

pub(crate) fn inflate(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    ZlibDecoder::new(bytes).read_to_end(&mut out).expect("GPT-SoVITS 内嵌数据解压失败");
    out
}

pub(crate) fn inflate_text(bytes: &[u8]) -> String {
    String::from_utf8(inflate(bytes)).expect("GPT-SoVITS 内嵌数据不是 UTF-8")
}

/// 单字表覆盖的码点区间（pypinyin 数据里有读音的 CJK 基本区）。
pub const HAN_LO: u32 = 0x4E00;
pub const HAN_HI: u32 = 0x9FA5;
/// 单字表里「没有读音」的标记。
pub const NO_PINYIN: u16 = 0xFFFF;

pub struct PinyinTables {
    /// 音节 id → (`Style.INITIALS`, `Style.FINALS_TONE3`)。
    pub syllables: Vec<(String, String)>,
    /// U+4E00..=U+9FA5 的默认读音音节 id。
    pub chars: Vec<u16>,
    /// 全部词组，按码点排序；整词读音与逐字默认读音不同时带音节 id。
    pub phrases: Vec<(String, Option<Vec<u16>>)>,
}

pub static PINYIN: LazyLock<PinyinTables> = LazyLock::new(|| {
    let syllables = inflate_text(include_bytes!("data/pinyin_syllables.txt.z"))
        .lines()
        .map(|line| {
            let (initial, final_) = line.split_once('\t').unwrap_or((line, ""));
            (initial.to_owned(), final_.to_owned())
        })
        .collect();
    let chars = inflate(include_bytes!("data/pinyin_chars.bin.z"))
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    let phrases: Vec<(String, Option<Vec<u16>>)> = inflate_text(include_bytes!("data/pinyin_phrases.txt.z"))
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| match line.split_once('\t') {
            Some((phrase, ids)) => (
                phrase.to_owned(),
                Some(ids.split(' ').map(|id| id.parse().expect("音节 id")).collect()),
            ),
            None => (line.to_owned(), None),
        })
        .collect();
    debug_assert!(phrases.windows(2).all(|pair| pair[0].0 < pair[1].0));
    PinyinTables { syllables, chars, phrases }
});

/// 繁 → 简（上游 `char_convert.t2s_dict` 中繁简不同的字）。
pub static T2S: LazyLock<HashMap<char, char>> = LazyLock::new(|| {
    let chars: Vec<char> = inflate_text(include_bytes!("data/t2s.txt.z")).chars().collect();
    chars.chunks_exact(2).map(|pair| (pair[0], pair[1])).collect()
});

/// `opencpop-strict.txt`：拼音 → (声母符号, 韵母符号)。
pub static OPENCPOP: LazyLock<HashMap<String, (String, String)>> = LazyLock::new(|| {
    inflate_text(include_bytes!("data/opencpop_strict.txt.z"))
        .lines()
        .filter_map(|line| {
            let (pinyin, symbols) = line.split_once('\t')?;
            let (initial, final_) = symbols.split_once(' ')?;
            Some((pinyin.to_owned(), (initial.to_owned(), final_.to_owned())))
        })
        .collect()
});

fn word_phones(text: &str) -> HashMap<String, Vec<String>> {
    text.lines()
        .filter_map(|line| {
            let (word, phones) = line.split_once('\t')?;
            Some((word.to_owned(), phones.split(' ').map(str::to_owned).collect()))
        })
        .collect()
}

/// CMU 词典（含上游热词覆盖）。
pub static CMUDICT: LazyLock<HashMap<String, Vec<String>>> =
    LazyLock::new(|| word_phones(&inflate_text(include_bytes!("data/cmudict.txt.z"))));

/// 上游姓名词典（只含不在 CMU 表里的词）。
pub static NAMEDICT: LazyLock<HashMap<String, Vec<String>>> =
    LazyLock::new(|| word_phones(&inflate_text(include_bytes!("data/namedict.txt.z"))));

pub struct Homograph {
    pub pron1: Vec<String>,
    pub pron2: Vec<String>,
    pub pos1: String,
}

/// g2p-en 多音词表。
pub static HOMOGRAPHS: LazyLock<HashMap<String, Homograph>> = LazyLock::new(|| {
    inflate_text(include_bytes!("data/homographs.txt.z"))
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('|');
            let word = parts.next()?;
            let split = |s: &str| s.split(' ').map(str::to_owned).collect();
            let pron1 = split(parts.next()?);
            let pron2 = split(parts.next()?);
            let pos1 = parts.next()?.to_owned();
            Some((word.to_owned(), Homograph { pron1, pron2, pos1 }))
        })
        .collect()
});

/// 顺序读 `gen_data.py` 写出的二进制表：LE 7-bit varint、front-coded 键。
struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn byte(&mut self) -> u8 {
        self.pos += 1;
        self.data[self.pos - 1]
    }

    fn varint(&mut self) -> u64 {
        let (mut n, mut shift) = (0u64, 0);
        loop {
            let b = self.byte();
            n |= u64::from(b & 0x7F) << shift;
            shift += 7;
            if b < 0x80 {
                return n;
            }
        }
    }

    fn bytes(&mut self, len: usize) -> &'a [u8] {
        self.pos += len;
        &self.data[self.pos - len..self.pos]
    }

    fn keys(&mut self, count: usize) -> SortedKeys {
        let mut keys = SortedKeys {
            arena: Vec::new(),
            ends: Vec::with_capacity(count),
        };
        let mut prev: Vec<u8> = Vec::new();
        for _ in 0..count {
            let shared = self.byte() as usize;
            let rest = self.varint() as usize;
            prev.truncate(shared);
            prev.extend_from_slice(self.bytes(rest));
            keys.arena.extend_from_slice(&prev);
            keys.ends.push(keys.arena.len() as u32);
        }
        keys
    }
}

/// 按 UTF-8 字节序排好的字符串集合（与 `str` 的 `Ord` 一致），下标即表内序号。
pub struct SortedKeys {
    arena: Vec<u8>,
    ends: Vec<u32>,
}

impl SortedKeys {
    pub fn len(&self) -> usize {
        self.ends.len()
    }

    fn raw(&self, index: usize) -> &[u8] {
        let start = if index == 0 { 0 } else { self.ends[index - 1] as usize };
        &self.arena[start..self.ends[index] as usize]
    }

    pub fn find(&self, key: &str) -> Option<usize> {
        let (mut lo, mut hi) = (0, self.len());
        while lo < hi {
            let mid = (lo + hi) / 2;
            match self.raw(mid).cmp(key.as_bytes()) {
                std::cmp::Ordering::Less => lo = mid + 1,
                std::cmp::Ordering::Greater => hi = mid,
                std::cmp::Ordering::Equal => return Some(mid),
            }
        }
        None
    }
}

/// NLTK `averaged_perceptron_tagger_eng`：类别、tagdict 与特征权重（千分整数还原成 f64）。
pub struct EnTagger {
    pub classes: Vec<String>,
    pub words: SortedKeys,
    pub word_class: Vec<u8>,
    pub feats: SortedKeys,
    /// 第 i 个特征的权重在 `pairs[feat_start[i]..feat_start[i + 1]]`。
    pub feat_start: Vec<u32>,
    pub pairs: Vec<(u8, f64)>,
}

impl EnTagger {
    pub fn tagdict(&self, word: &str) -> Option<&str> {
        self.words.find(word).map(|i| self.classes[self.word_class[i] as usize].as_str())
    }

    pub fn weights(&self, feat: &str) -> Option<&[(u8, f64)]> {
        let i = self.feats.find(feat)?;
        Some(&self.pairs[self.feat_start[i] as usize..self.feat_start[i + 1] as usize])
    }
}

pub static EN_TAGGER: LazyLock<EnTagger> = LazyLock::new(|| {
    let raw = inflate(include_bytes!("data/en_tagger.bin.z"));
    let mut cur = Cursor::new(&raw);
    let nclasses = cur.varint() as usize;
    let classes = (0..nclasses)
        .map(|_| {
            let len = cur.varint() as usize;
            String::from_utf8(cur.bytes(len).to_vec()).expect("tagger 类别")
        })
        .collect();
    let nwords = cur.varint() as usize;
    let words = cur.keys(nwords);
    let word_class = cur.bytes(nwords).to_vec();
    let nfeats = cur.varint() as usize;
    let feats = cur.keys(nfeats);
    let mut feat_start = Vec::with_capacity(nfeats + 1);
    let mut pairs = Vec::new();
    for _ in 0..nfeats {
        feat_start.push(pairs.len() as u32);
        for _ in 0..cur.varint() {
            let class = cur.byte();
            let z = cur.varint();
            let k = (z >> 1) as i64 ^ -((z & 1) as i64);
            pairs.push((class, k as f64 / 1000.0));
        }
    }
    feat_start.push(pairs.len() as u32);
    assert_eq!(cur.pos, raw.len(), "en_tagger.bin 尾部多余字节");
    EnTagger {
        classes,
        words,
        word_class,
        feats,
        feat_start,
        pairs,
    }
});

/// wordsegment 词频表（unigram + 首词在 unigram 表里的 bigram，键为 `"w1 w2"`）。
pub struct WordFreq {
    pub unigrams: SortedKeys,
    pub unigram_counts: Vec<u64>,
    pub bigrams: SortedKeys,
    pub bigram_counts: Vec<u64>,
}

impl WordFreq {
    pub fn unigram(&self, word: &str) -> Option<u64> {
        self.unigrams.find(word).map(|i| self.unigram_counts[i])
    }

    pub fn bigram(&self, key: &str) -> Option<u64> {
        self.bigrams.find(key).map(|i| self.bigram_counts[i])
    }
}

pub static WORDSEGMENT: LazyLock<WordFreq> = LazyLock::new(|| {
    let raw = inflate(include_bytes!("data/wordsegment.bin.z"));
    let mut cur = Cursor::new(&raw);
    let mut table = || {
        let n = cur.varint() as usize;
        let keys = cur.keys(n);
        let counts = (0..n).map(|_| cur.varint()).collect();
        (keys, counts)
    };
    let (unigrams, unigram_counts) = table();
    let (bigrams, bigram_counts) = table();
    assert_eq!(cur.pos, raw.len(), "wordsegment.bin 尾部多余字节");
    WordFreq {
        unigrams,
        unigram_counts,
        bigrams,
        bigram_counts,
    }
});

/// g2p-en 2.1.0 GRU 编解码器权重（行优先）。
pub struct G2pGru {
    pub enc_emb: Vec<f32>,
    pub enc_w_ih: Vec<f32>,
    pub enc_w_hh: Vec<f32>,
    pub enc_b_ih: Vec<f32>,
    pub enc_b_hh: Vec<f32>,
    pub dec_emb: Vec<f32>,
    pub dec_w_ih: Vec<f32>,
    pub dec_w_hh: Vec<f32>,
    pub dec_b_ih: Vec<f32>,
    pub dec_b_hh: Vec<f32>,
    pub fc_w: Vec<f32>,
    pub fc_b: Vec<f32>,
}

/// 隐层维度。
pub const GRU_HIDDEN: usize = 256;

pub static G2P_GRU: LazyLock<G2pGru> = LazyLock::new(|| {
    let raw: &[u8] = include_bytes!("data/g2p_gru.f32");
    let mut pos = 0;
    let mut take = |len: usize| -> Vec<f32> {
        let out = raw[pos..pos + len * 4]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        pos += len * 4;
        out
    };
    let h = GRU_HIDDEN;
    let gru = G2pGru {
        enc_emb: take(29 * h),
        enc_w_ih: take(3 * h * h),
        enc_w_hh: take(3 * h * h),
        enc_b_ih: take(3 * h),
        enc_b_hh: take(3 * h),
        dec_emb: take(74 * h),
        dec_w_ih: take(3 * h * h),
        dec_w_hh: take(3 * h * h),
        dec_b_ih: take(3 * h),
        dec_b_hh: take(3 * h),
        fc_w: take(74 * h),
        fc_b: take(74),
    };
    assert_eq!(pos, raw.len(), "g2p_gru.f32 尺寸不符");
    gru
});

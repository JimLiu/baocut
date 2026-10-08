//! 矢量素材的**填充色分组**（第 122 轮，§14.4）。
//!
//! 逐条照原型 `designs/baocut/app/model-svgfill.js`。机制是：
//!
//! * **颜色不是目录声明的，是把素材解析出来的**：遍历 [`TAGS`] 这八个标签，依次
//!   取 `fill` 属性 → `style` 里的 `fill:` 声明 → `stop-color`，抓其中的 hex。
//! * **同一个默认 hex 的节点归一组**；组数 = 素材里不同填充色的个数，与元素类型
//!   无关。
//! * **两条排除**：素材里含 `<image>`（位图套壳）→ 一张卡都不给；不同色
//!   **> [`MAX_COLORS`]** → 一张卡都不给（那是插画，逐色改没有意义）。
//! * 否则取**前 [`MAX_SWATCHES`] 组**作为默认色卡。
//!
//! ## 三条规则（原型已经拍过，这里照抄，别在别处再判一遍）
//!
//! 1. **组的次序按文档出现次序**，不按标签分批。
//! 2. **改色作用到组里的每一个节点**，不按标签过滤——否则跨标签的同色组只会换一半。
//! 3. **`style` 里只认 / 只改 `fill:` 那一条声明**（拿整个 `style` 串撞 hex、
//!    换色时覆写整个属性，会把 `fill-rule` / `stroke` 一起弄丢）。
//!
//! `#RGB` 一律补齐成 `#RRGGBB` 再比，所以 `#fff` 与 `#FFFFFF` 是同一组。
//!
//! ## 这一层为什么不解析 DOM
//!
//! 换色是**按绝对偏移原地替换**：重新序列化一遍会把注释、缩进、`xml:space` 全洗
//! 掉，而这一份文本还要拿去和素材原文对拍。所以扫描是一次确定性的标签 / 属性
//! 扫描（等价于原型那三支正则），不引入 xml crate，wasm 可编。
//!
//! ## 与文档存储的关系（D1）
//!
//! 画面上的真相是核心的 `sticker.fillOverrides`（**按源 hex 键**，
//! `bcut_timeline::schema` 的 `StickerProps`）。UI 那一侧只是把 [`fills_of`] 的
//! 次序摆成「第 N 组」几张卡；两者的翻译住在 [`fills_to_overrides`] 与
//! [`fill_list_from_overrides`]，App 与 Web 都读这一份，不各写一遍。

use std::collections::BTreeMap;

pub fn animation_duration(svg: &str) -> Result<Option<f64>, String> {
    scene_primitives::svg_animation::SvgAnimation::parse(svg)
        .map(|a| a.map(|a| a.duration()))
        .map_err(|e| e.to_string())
}
pub fn sample_animation(svg: &str, seconds: f64) -> Result<String, String> {
    scene_primitives::svg_animation::SvgAnimation::parse(svg)
        .map(|a| a.map_or_else(|| svg.to_owned(), |a| a.sample(seconds)))
        .map_err(|e| e.to_string())
}

/// 只有这八个标签的填充色进色卡。
pub const TAGS: [&str; 8] = [
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "stop",
];
/// 默认色卡最多几张。
pub const MAX_SWATCHES: usize = 5;
/// 超过这么多种不同色就一张卡都不给。
pub const MAX_COLORS: usize = 15;

/// 一组同色节点在原文里的一处承载（绝对字节偏移，左闭右开）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

/// 一组同默认色的节点。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FillGroup {
    /// 归一后的默认色（`#RRGGBB` 或 `#RRGGBBAA`，大写）。
    pub hex: String,
    /// 这一组**第一个**节点的标签（见模块头规则 2）。
    pub tag: String,
    /// 这一组有几个节点。
    pub count: usize,
    /// 换色时要原地替换的全部位置（一个节点可能有 `fill` ＋ `style` 两处）。
    pub spans: Vec<Span>,
}

/// 面板上的一张色卡（`fillsOf` 的形状）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FillCard {
    pub hex: String,
    pub tag: String,
    pub count: usize,
}

/// 内置矢量贴纸的一层（核心 `sticker/*.json` 的 `layers`）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BuiltinLayer<'a> {
    pub d: &'a str,
    pub fill: Option<&'a str>,
    pub stroke: Option<&'a str>,
    pub width: f64,
}

// ---------------------------------------------------------------------------
// 色值
// ---------------------------------------------------------------------------

/// 填充键的归一：补齐三位简写并统一大写，好让 `#fff` 与 `#FFFFFF` 认成同一组。
/// 八位（带 alpha）原样保留——覆盖表按它做键。不做校验；用户输入的色值走
/// `bcut_editor_core::color::norm_hex`（校验 + 丢 alpha），那条也建在这上面。
pub fn norm_fill_hex(hex: &str) -> String {
    let upper = hex.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    if bytes.len() == 4 {
        let mut out = String::with_capacity(7);
        out.push('#');
        for byte in &bytes[1..4] {
            out.push(*byte as char);
            out.push(*byte as char);
        }
        return out;
    }
    upper
}

/// 一个色值串里的 hex（`none` / `currentColor` / 渐变引用都读不出色）。
///
/// 三种写法依次试：8 位（带 alpha）→ 6 位 → 3 位简写。不加词边界是
/// 刻意的——四位写法（`#RGBA`）读出来的就是前三位。
pub fn hex_in(value: &str) -> Option<String> {
    let cleaned = strip_url(value);
    find_hex(&cleaned, 8)
        .or_else(|| find_hex(&cleaned, 6))
        .or_else(|| find_hex(&cleaned, 3))
}

/// `/url\([^)]*\)/g → ' '`：渐变 / 图案引用里的 `#id` 不是颜色。
fn strip_url(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(at) = rest.find("url(") {
        let tail = &rest[at + 4..];
        let Some(close) = tail.find(')') else {
            break;
        };
        out.push_str(&rest[..at]);
        out.push(' ');
        rest = &tail[close + 1..];
    }
    out.push_str(rest);
    out
}

/// 串里第一个 `#` ＋ `n` 位十六进制。
fn find_hex(value: &str, digits: usize) -> Option<String> {
    let bytes = value.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte != b'#' {
            continue;
        }
        let end = index + 1 + digits;
        if end > bytes.len() {
            continue;
        }
        if bytes[index + 1..end].iter().all(u8::is_ascii_hexdigit) {
            return Some(value[index..end].to_owned());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// 扫描（等价于原型的 TAG_RE / ATTR_RE）
// ---------------------------------------------------------------------------

struct Attr {
    name: String,
    value: String,
    /// 值（不含引号）在原文里的绝对起点。
    start: usize,
}

struct Node {
    tag: String,
    attrs: Vec<Attr>,
}

impl Node {
    fn attr(&self, name: &str) -> Option<&Attr> {
        self.attrs.iter().find(|attr| attr.name == name)
    }
}

struct Scan {
    image: bool,
    nodes: Vec<Node>,
}

fn is_name_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic()
}

fn is_name_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'.' | b'-')
}

fn is_attr_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b':')
}

fn scan(text: &str) -> Scan {
    let bytes = text.as_bytes();
    let mut nodes = Vec::new();
    let mut image = false;
    let mut at = 0usize;
    while at < bytes.len() {
        let Some(lt) = bytes[at..].iter().position(|b| *b == b'<').map(|i| i + at) else {
            break;
        };
        let name_start = lt + 1;
        if name_start >= bytes.len() || !is_name_start(bytes[name_start]) {
            at = lt + 1;
            continue;
        }
        let mut cursor = name_start;
        while cursor < bytes.len() && is_name_char(bytes[cursor]) {
            cursor += 1;
        }
        let tag = text[name_start..cursor].to_ascii_lowercase();
        // 属性区：`>` 由引号吃掉，未闭合的标签整条不算匹配（与正则同解）。
        let attrs_start = cursor;
        let mut scan_at = cursor;
        let mut closed = None;
        while scan_at < bytes.len() {
            match bytes[scan_at] {
                b'>' => {
                    closed = Some(scan_at);
                    break;
                }
                quote @ (b'"' | b'\'') => {
                    let Some(end) = bytes[scan_at + 1..]
                        .iter()
                        .position(|b| *b == quote)
                        .map(|i| i + scan_at + 1)
                    else {
                        break;
                    };
                    scan_at = end + 1;
                }
                _ => scan_at += 1,
            }
        }
        let Some(gt) = closed else {
            at = lt + 1;
            continue;
        };
        if tag == "image" {
            image = true;
            at = gt + 1;
            continue;
        }
        if TAGS.contains(&tag.as_str()) {
            nodes.push(Node {
                tag,
                attrs: scan_attrs(text, attrs_start, gt),
            });
        }
        at = gt + 1;
    }
    Scan { image, nodes }
}

/// 一段属性区里的全部 `name="value"`（值的绝对起点跟着记下来）。
fn scan_attrs(text: &str, from: usize, to: usize) -> Vec<Attr> {
    let bytes = text.as_bytes();
    let mut out: Vec<Attr> = Vec::new();
    let mut at = from;
    while at < to {
        if !is_attr_start(bytes[at]) {
            at += 1;
            continue;
        }
        let name_start = at;
        let mut cursor = at;
        while cursor < to && is_name_char(bytes[cursor]) {
            cursor += 1;
        }
        let name_end = cursor;
        while cursor < to && matches!(bytes[cursor], b' ' | b'\t' | b'\r' | b'\n') {
            cursor += 1;
        }
        if cursor >= to || bytes[cursor] != b'=' {
            at = name_start + 1;
            continue;
        }
        cursor += 1;
        while cursor < to && matches!(bytes[cursor], b' ' | b'\t' | b'\r' | b'\n') {
            cursor += 1;
        }
        if cursor >= to || !matches!(bytes[cursor], b'"' | b'\'') {
            at = name_start + 1;
            continue;
        }
        let quote = bytes[cursor];
        let value_start = cursor + 1;
        let Some(value_end) = bytes[value_start..to]
            .iter()
            .position(|b| *b == quote)
            .map(|i| i + value_start)
        else {
            at = name_start + 1;
            continue;
        };
        let name = text[name_start..name_end].to_ascii_lowercase();
        let attr = Attr {
            name,
            value: text[value_start..value_end].to_owned(),
            start: value_start,
        };
        // 同名属性后写覆盖先写（JS 的 `attrs[name] = …`）。
        if let Some(slot) = out.iter_mut().find(|old| old.name == attr.name) {
            *slot = attr;
        } else {
            out.push(attr);
        }
        at = value_end + 1;
    }
    out
}

/// 一个节点上所有**承载填充色**的位置：`fill` 属性 / `style` 的 fill 声明 /
/// `stop-color`。次序即读默认色的次序。
fn carriers(node: &Node) -> Vec<(Span, String)> {
    let mut out = Vec::new();
    if let Some(fill) = node.attr("fill") {
        if let Some(hex) = hex_in(&fill.value) {
            let end = fill.start + fill.value.len();
            out.push((
                Span {
                    start: fill.start,
                    end,
                },
                hex,
            ));
        }
    }
    if let Some(style) = node.attr("style") {
        if let Some((offset, value)) = style_fill(&style.value) {
            if let Some(hex) = hex_in(value) {
                let start = style.start + offset;
                out.push((
                    Span {
                        start,
                        end: start + value.len(),
                    },
                    hex,
                ));
            }
        }
    }
    if let Some(stop) = node.attr("stop-color") {
        if let Some(hex) = hex_in(&stop.value) {
            let end = stop.start + stop.value.len();
            out.push((
                Span {
                    start: stop.start,
                    end,
                },
                hex,
            ));
        }
    }
    out
}

/// `style` 串里第一条 `fill:` 声明的值（返回值在串内的偏移与值本身）。
///
/// 等价于原型的 `/(^|;)([ \t]*)fill[ \t]*:[ \t]*([^;]*)/i`：候选起点只有串首与
/// 每个 `;`，所以 `fill-rule:` / `fill-opacity:` 不会被误认。
fn style_fill(style: &str) -> Option<(usize, &str)> {
    let bytes = style.as_bytes();
    let mut starts = vec![0usize];
    starts.extend(
        bytes
            .iter()
            .enumerate()
            .filter(|(_, b)| **b == b';')
            .map(|(i, _)| i + 1),
    );
    for start in starts {
        let mut at = start;
        while at < bytes.len() && matches!(bytes[at], b' ' | b'\t') {
            at += 1;
        }
        if at + 4 > bytes.len() || !style[at..at + 4].eq_ignore_ascii_case("fill") {
            continue;
        }
        at += 4;
        while at < bytes.len() && matches!(bytes[at], b' ' | b'\t') {
            at += 1;
        }
        if at >= bytes.len() || bytes[at] != b':' {
            continue;
        }
        at += 1;
        while at < bytes.len() && matches!(bytes[at], b' ' | b'\t') {
            at += 1;
        }
        let end = bytes[at..]
            .iter()
            .position(|b| *b == b';')
            .map_or(bytes.len(), |i| i + at);
        return Some((at, &style[at..end]));
    }
    None
}

// ---------------------------------------------------------------------------
// 分组与色卡
// ---------------------------------------------------------------------------

/// 同色归一组，组的次序 = 第一次出现的次序。含 `<image>` 直接返回空表。
pub fn groups_of(svg: &str) -> Vec<FillGroup> {
    let scanned = scan(svg);
    if scanned.image {
        return Vec::new();
    }
    let mut groups: Vec<FillGroup> = Vec::new();
    for node in &scanned.nodes {
        let spans = carriers(node);
        let Some((_, first)) = spans.first() else {
            continue;
        };
        let hex = norm_fill_hex(first);
        let index = match groups.iter().position(|group| group.hex == hex) {
            Some(index) => index,
            None => {
                groups.push(FillGroup {
                    hex,
                    tag: node.tag.clone(),
                    count: 0,
                    spans: Vec::new(),
                });
                groups.len() - 1
            }
        };
        groups[index].count += 1;
        groups[index]
            .spans
            .extend(spans.into_iter().map(|(span, _)| span));
    }
    groups
}

/// 色卡表。含 `<image>` 或超过 [`MAX_COLORS`] 种色 → 空表；否则最多
/// [`MAX_SWATCHES`] 组。
pub fn fills_of(svg: &str) -> Vec<FillCard> {
    let groups = groups_of(svg);
    if groups.len() > MAX_COLORS {
        return Vec::new();
    }
    groups
        .into_iter()
        .take(MAX_SWATCHES)
        .map(|group| FillCard {
            hex: group.hex,
            tag: group.tag,
            count: group.count,
        })
        .collect()
}

/// 默认色卡（元素首次选中时的那一份）。
pub fn default_fills(svg: &str) -> Vec<String> {
    fills_of(svg).into_iter().map(|card| card.hex).collect()
}

/// 与默认色逐项相等 = 这张素材还没被改过色，画面上直接用原 URL。
pub fn is_default(svg: &str, fill_list: &[Option<String>]) -> bool {
    if fill_list.is_empty() {
        return true;
    }
    let want = default_fills(svg);
    want.len() == fill_list.len()
        && want.iter().zip(fill_list).all(|(hex, got)| {
            got.as_deref()
                .is_some_and(|got| norm_fill_hex(got) == hex.as_str())
        })
}

/// 按色卡换色：第 i 张卡只换第 i 组那些节点的填充色，别处一个字符都不动。
pub fn apply_fills(svg: &str, fill_list: &[Option<String>]) -> String {
    if fill_list.is_empty() {
        return svg.to_owned();
    }
    let groups = groups_of(svg);
    let take = groups.len().min(fill_list.len()).min(MAX_SWATCHES);
    let mut edits: Vec<(Span, &str)> = Vec::new();
    for (group, want) in groups.iter().zip(fill_list).take(take) {
        let Some(want) = want.as_deref() else {
            continue;
        };
        if want.is_empty() {
            continue;
        }
        edits.extend(group.spans.iter().map(|span| (*span, want)));
    }
    if edits.is_empty() {
        return svg.to_owned();
    }
    edits.sort_by_key(|(span, _)| span.start);
    let mut out = String::with_capacity(svg.len());
    let mut at = 0usize;
    for (span, want) in edits {
        if span.start < at {
            continue;
        }
        out.push_str(&svg[at..span.start]);
        out.push_str(want);
        at = span.end;
    }
    out.push_str(&svg[at..]);
    out
}

/// 按 `sticker.fillOverrides` 换色：覆盖表的键是**源 hex**，命中哪一组就换哪一组。
///
/// 这是画面侧的入口（`bcut-subtitle-render` 光栅资产贴纸前先过这一道），与面板
/// 侧的 [`apply_fills`]「按第 N 张卡」是同一套 span 编辑的两种索引方式：面板知道
/// 卡的次序，渲染链只有文档里那张表。两者必须给出同一张图，否则「预览＝导出」
/// 在换过色的贴纸上就破了——[`apply_fills`] 的卡序正是 [`groups_of`] 的组序，
/// 所以这里直接按组的默认色查表。
pub fn apply_overrides(svg: &str, overrides: &BTreeMap<String, String>) -> String {
    if overrides.is_empty() {
        return svg.to_owned();
    }
    let fill_list: Vec<Option<String>> = groups_of(svg)
        .into_iter()
        .map(|group| {
            overrides
                .iter()
                .find(|(source, _)| norm_fill_hex(source) == group.hex)
                .map(|(_, target)| norm_fill_hex(target))
        })
        .collect();
    apply_fills(svg, &fill_list)
}

// ---------------------------------------------------------------------------
// D1：色卡 ↔ `sticker.fillOverrides`
// ---------------------------------------------------------------------------

/// 面板上的几张卡 → 文档里的覆盖表（**键是源 hex**，`schema::StickerProps`）。
///
/// 只写「真的改过」的那几组：与默认色相等的一律不落键，否则文档里会堆一份与
/// 素材同值的噪声，`is_default` 那一档也就永远判不出「没改过」。
pub fn fills_to_overrides(
    fills: &[FillCard],
    edits: &[Option<String>],
) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (card, edit) in fills.iter().zip(edits) {
        let Some(edit) = edit.as_deref() else {
            continue;
        };
        let want = norm_fill_hex(edit);
        if want == card.hex {
            continue;
        }
        out.insert(card.hex.clone(), want);
    }
    out
}

/// 反向读：文档里的覆盖表 → 面板上那几张卡此刻各是什么色。
///
/// 没有覆盖的那一组读回默认色，所以这一份恒与 [`fills_of`] 等长——面板不必再
/// 判「第 N 组有没有被改过」。
pub fn fill_list_from_overrides(
    fills: &[FillCard],
    overrides: &BTreeMap<String, String>,
) -> Vec<Option<String>> {
    fills
        .iter()
        .map(|card| {
            overrides
                .iter()
                .find(|(source, _)| norm_fill_hex(source) == card.hex)
                .map(|(_, target)| norm_fill_hex(target))
                .or_else(|| Some(card.hex.clone()))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 交给渲染器的形态
// ---------------------------------------------------------------------------

/// 盒子被拉成任意宽高时，SVG 自己的 `preserveAspectRatio` 优先级高于
/// `object-fit`，图会在被拉长的盒子里留黑边。拉伸这一档因此要改素材本身：给根
/// `<svg>` 写上 `preserveAspectRatio="none"`（已有就替换）。只动根标签的属性区，
/// 内部嵌套的 `<image preserveAspectRatio>` 不碰。
pub fn stretch(svg: &str) -> String {
    let Some((start, end)) = root_svg_tag(svg) else {
        return svg.to_owned();
    };
    let tag = &svg[start..end];
    let self_close = tag.ends_with("/>");
    let attrs = &tag[4..tag.len() - if self_close { 2 } else { 1 }];
    let attrs = strip_preserve_aspect(attrs);
    let mut out = String::with_capacity(svg.len() + 32);
    out.push_str(&svg[..start]);
    out.push_str("<svg");
    out.push_str(attrs.trim_end());
    out.push_str(" preserveAspectRatio=\"none\"");
    out.push_str(if self_close { "/>" } else { ">" });
    out.push_str(&svg[end..]);
    out
}

/// `/<svg\b[^>]*>/i` 的那一段（左闭右开的字节区间）。
fn root_svg_tag(svg: &str) -> Option<(usize, usize)> {
    let bytes = svg.as_bytes();
    let mut at = 0usize;
    while at + 4 <= bytes.len() {
        let Some(lt) = bytes[at..].iter().position(|b| *b == b'<').map(|i| i + at) else {
            return None;
        };
        if lt + 4 <= bytes.len() && svg[lt..lt + 4].eq_ignore_ascii_case("<svg") {
            let after = bytes.get(lt + 4).copied();
            // `\b`：`<svg` 后面必须是非词字符（`<svgfoo` 不算）。
            if after.is_none_or(|byte| !byte.is_ascii_alphanumeric() && byte != b'_') {
                let gt = bytes[lt..]
                    .iter()
                    .position(|b| *b == b'>')
                    .map(|i| i + lt)?;
                return Some((lt, gt + 1));
            }
        }
        at = lt + 1;
    }
    None
}

/// `/\s*preserveAspectRatio\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi → ''`
fn strip_preserve_aspect(attrs: &str) -> String {
    const NAME: &str = "preserveAspectRatio";
    let bytes = attrs.as_bytes();
    let mut out = String::with_capacity(attrs.len());
    let mut at = 0usize;
    let mut kept = 0usize;
    while at < bytes.len() {
        let name_at = at
            + match attrs[at..]
                .to_ascii_lowercase()
                .find(&NAME.to_ascii_lowercase())
            {
                Some(index) => index,
                None => break,
            };
        // 名字前的空白也一起吃掉（正则的 `\s*`）。
        let mut lead = name_at;
        while lead > kept && bytes[lead - 1].is_ascii_whitespace() {
            lead -= 1;
        }
        let mut cursor = name_at + NAME.len();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            out.push_str(&attrs[kept..name_at + NAME.len()]);
            kept = name_at + NAME.len();
            at = kept;
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let value_end = match bytes.get(cursor) {
            Some(quote @ (b'"' | b'\'')) => bytes[cursor + 1..]
                .iter()
                .position(|b| b == quote)
                .map_or(bytes.len(), |i| cursor + 1 + i + 1),
            _ => {
                let mut end = cursor;
                while end < bytes.len() && !bytes[end].is_ascii_whitespace() && bytes[end] != b'>' {
                    end += 1;
                }
                end
            }
        };
        out.push_str(&attrs[kept..lead]);
        kept = value_end;
        at = value_end;
    }
    out.push_str(&attrs[kept..]);
    out
}

/// 换过色的素材交给渲染器的形态（base64 data URI）。
pub fn data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", base64(svg.as_bytes()))
}

/// 标准 base64（无换行）。这一层不引依赖，编码本身十行。
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = chunk.get(1).copied().map_or(0, u32::from);
        let b2 = chunk.get(2).copied().map_or(0, u32::from);
        let word = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(word >> 18) as usize & 63] as char);
        out.push(TABLE[(word >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(word >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[word as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 内置矢量贴纸（核心 `sticker/*.json` 的 `layers`）直译成一份 SVG 文本，色卡与
/// 换色就都是上面那几件，不用为「路径数组」再写第二份分组逻辑。
pub fn builtin_svg(layers: &[BuiltinLayer<'_>]) -> String {
    let mut body = String::new();
    for layer in layers {
        body.push_str(&format!(
            "<path d=\"{}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"{}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
            layer.d,
            layer.fill.unwrap_or("none"),
            layer.stroke.unwrap_or("none"),
            layer.width,
        ));
    }
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\" width=\"100%\" style=\"display:block\" aria-hidden=\"true\">{body}</svg>"
    )
}

/// 内置矢量贴纸画的是 `layers` 本身（不走文本替换，因为盒子高度那一档要靠
/// `preserveAspectRatio`），所以这里给出「第 i 层此刻该用哪个填充色」：层的原色
/// 在色卡表里排第几，就取色卡的第几张。分组判据仍然是上面那一份。
pub fn layer_fill(
    layers: &[BuiltinLayer<'_>],
    fill_list: &[Option<String>],
    index: usize,
) -> String {
    let own = layers.get(index).and_then(|layer| layer.fill);
    let own_hex = norm_fill_hex(own.unwrap_or(""));
    let at = fills_of(&builtin_svg(layers))
        .into_iter()
        .position(|card| card.hex == own_hex);
    at.and_then(|at| fill_list.get(at).cloned().flatten())
        .filter(|hex| !hex.is_empty())
        .or_else(|| own.map(str::to_owned))
        .unwrap_or_else(|| "none".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 拿 `n` 种互不相同的色拼一份 SVG。
    fn rainbow(n: usize) -> String {
        let mut body = String::new();
        for i in 0..n {
            body.push_str(&format!("<path fill=\"#{:02X}0000\" d=\"M0 0\"/>", i + 1));
        }
        format!("<svg>{body}</svg>")
    }

    /// 超过 15 种色 = 一张卡都不给。这不是
    /// 「截到 15」——那种素材（照片描摹、渐变网格）逐色改根本没有意义。
    #[test]
    fn too_many_colours_yield_no_swatches_at_all() {
        assert_eq!(groups_of(&rainbow(MAX_COLORS)).len(), MAX_COLORS);
        assert_eq!(fills_of(&rainbow(MAX_COLORS)).len(), MAX_SWATCHES);
        assert!(fills_of(&rainbow(MAX_COLORS + 1)).is_empty());
        assert!(default_fills(&rainbow(MAX_COLORS + 1)).is_empty());
    }

    /// 15 种以内也只摆前 5 张——卡是 5 张，组仍然是全的（换色要按组走）。
    #[test]
    fn swatches_are_capped_but_groups_are_not() {
        let svg = rainbow(9);
        assert_eq!(fills_of(&svg).len(), MAX_SWATCHES);
        assert_eq!(groups_of(&svg).len(), 9);
    }

    /// 一个节点可能有两处承载（`fill` ＋ `style`），换色要把两处一起改，否则
    /// `style` 那条会按 CSS 优先级把新色盖回去。
    #[test]
    fn one_node_can_carry_the_colour_in_two_places() {
        let svg = "<svg><path fill=\"#fff\" style=\"fill: #FFFFFF\" d=\"M0 0\"/></svg>";
        let groups = groups_of(svg);
        assert_eq!(groups.len(), 1, "两处是同一组");
        assert_eq!(groups[0].hex, "#FFFFFF");
        assert_eq!(groups[0].count, 1, "算的是节点数不是承载数");
        assert_eq!(groups[0].spans.len(), 2);
        let out = apply_fills(svg, &[Some("#FF0000".to_owned())]);
        assert_eq!(out.matches("#FF0000").count(), 2, "两处都得换");
        assert!(!out.contains("#FFFFFF") && !out.contains("#fff\""));
    }

    /// `fill-rule` / `fill-opacity` 不是填充色——正则那侧靠 `(^|;)` 锚住，这里
    /// 靠候选起点闭集，判据必须一致。
    #[test]
    fn fill_rule_and_fill_opacity_are_not_fills() {
        let svg = "<svg><path style=\"fill-rule:evenodd;fill-opacity:.5\" d=\"M0 0\"/></svg>";
        assert!(groups_of(svg).is_empty());
        let svg = "<svg><path style=\"fill-rule:evenodd;fill:#0a0\" d=\"M0 0\"/></svg>";
        assert_eq!(groups_of(svg)[0].hex, "#00AA00");
    }

    /// 渐变的 `stop-color` 也是承载：不收它，渐变贴纸的色卡会整片空掉。
    #[test]
    fn gradient_stops_are_carriers_too() {
        let svg = "<svg><stop stop-color=\"#123456\"/><stop stop-color=\"#123456\"/></svg>";
        let groups = groups_of(svg);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].tag, "stop");
        assert_eq!(groups[0].count, 2);
    }

    /// 位图贴纸（含 `<image>`）一张卡都不给：能改的是矢量填充，位图改不了。
    #[test]
    fn a_bitmap_sticker_offers_nothing() {
        let svg = "<svg><path fill=\"#fff\" d=\"M0 0\"/><image href=\"a.png\"/></svg>";
        assert!(groups_of(svg).is_empty());
        assert!(fills_of(svg).is_empty());
    }

    /// 内置矢量贴纸走 `layers` 直译，色卡与分组复用同一份判据；`layer_fill`
    /// 按「原色排第几」取色，没改过就退回层自己的原色。
    #[test]
    fn builtin_layers_reuse_the_same_grouping() {
        let layers = [
            BuiltinLayer {
                d: "M0 0",
                fill: Some("#FFCC00"),
                stroke: None,
                width: 0.0,
            },
            BuiltinLayer {
                d: "M1 1",
                fill: Some("#000000"),
                stroke: Some("#000000"),
                width: 0.04,
            },
            BuiltinLayer {
                d: "M2 2",
                fill: Some("#ffcc00"),
                stroke: None,
                width: 0.0,
            },
        ];
        let svg = builtin_svg(&layers);
        let cards = fills_of(&svg);
        assert_eq!(
            cards.iter().map(|c| c.hex.as_str()).collect::<Vec<_>>(),
            ["#FFCC00", "#000000"],
            "大小写不同的同一个色只算一组"
        );
        assert_eq!(cards[0].count, 2);

        // 没改过：各层照原色。
        let none: [Option<String>; 0] = [];
        assert_eq!(layer_fill(&layers, &none, 0), "#FFCC00");
        assert_eq!(layer_fill(&layers, &none, 1), "#000000");
        // 改第 0 张卡：同组的第 2 层跟着变，另一组不动。
        let list = [Some("#FF0000".to_owned())];
        assert_eq!(layer_fill(&layers, &list, 0), "#FF0000");
        assert_eq!(layer_fill(&layers, &list, 2), "#FF0000");
        assert_eq!(layer_fill(&layers, &list, 1), "#000000");
        // 越界的层不 panic，给 `none`。
        assert_eq!(layer_fill(&layers, &list, 9), "none");
    }

    /// 空串是「这一格没设」，不是「设成了空色」——否则 `fill_list` 里一个洞会
    /// 把层刷成透明。
    #[test]
    fn an_empty_slot_means_unset_not_transparent() {
        let layers = [BuiltinLayer {
            d: "M0 0",
            fill: Some("#FFCC00"),
            stroke: None,
            width: 0.0,
        }];
        assert_eq!(layer_fill(&layers, &[Some(String::new())], 0), "#FFCC00");
        assert_eq!(layer_fill(&layers, &[None], 0), "#FFCC00");
    }

    /// 覆盖表按**源色**键，不按索引——D1 的存储裁决；卡序变了旧文档也还认得。
    /// 与默认色相等的一律不落键，否则 `is_default` 永远判不出「没改过」。
    #[test]
    fn overrides_are_keyed_by_the_source_colour() {
        let svg = "<svg><path fill=\"#fff\" d=\"M0 0\"/><path fill=\"#000\" d=\"M1 1\"/></svg>";
        let cards = fills_of(svg);
        let list = [Some("#FFFFFF".to_owned()), Some("#ff0000".to_owned())];
        let overrides = fills_to_overrides(&cards, &list);
        assert_eq!(overrides.len(), 1, "与默认色相等的那一组不落键");
        assert_eq!(
            overrides.get("#000000").map(String::as_str),
            Some("#FF0000")
        );

        // 回程恒与色卡等长：没被覆盖的读回默认色，面板不必自己判「改过没有」。
        let back = fill_list_from_overrides(&cards, &overrides);
        assert_eq!(
            back,
            vec![Some("#FFFFFF".to_owned()), Some("#FF0000".to_owned())]
        );
        assert!(is_default(svg, &[]), "空表 = 没改过");
        assert!(!is_default(svg, &back));
    }

    /// 渲染链的入口与面板入口给出同一张图：`fillOverrides` 按源 hex 命中组，
    /// 没命中的组一个字符都不动。
    #[test]
    fn apply_overrides_matches_the_card_ordered_edit() {
        use std::collections::BTreeMap;

        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg"><path fill="#FF7944" d="M0 0"/><path fill="#ffdfd5" d="M1 1"/></svg>"##;
        let mut overrides = BTreeMap::new();
        overrides.insert("#ff7944".to_owned(), "#00C853".to_owned());

        let by_overrides = super::apply_overrides(svg, &overrides);
        assert!(
            by_overrides.contains(r##"fill="#00C853""##),
            "{by_overrides}"
        );
        assert!(
            by_overrides.contains(r##"fill="#ffdfd5""##),
            "未被覆盖的组不能动"
        );

        // 面板那一侧同一份编辑（第 1 张卡换色、第 2 张卡留默认）必须给出同一张
        // 图。两者的字节不必相同：面板路径把没改过的组也重写成归一化后的默认
        // 色，这里则一个字符都不动——组序与最终色一致就够了。
        let cards = super::fills_of(svg);
        let by_cards =
            super::apply_fills(svg, &super::fill_list_from_overrides(&cards, &overrides));
        assert_eq!(
            super::default_fills(&by_overrides),
            super::default_fills(&by_cards)
        );

        assert_eq!(super::apply_overrides(svg, &BTreeMap::new()), svg);
    }
}

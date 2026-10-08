//! filepipe 的 HTML 工具层：转义、宽容解析、白名单清洗、按 id 定位。
//!
//! 红线：**标签名不进协议**。所有定位一律走 `id` / `data-*` 属性，
//! 解析结果只做结构提取，绝不执行任何 HTML。

use std::collections::{BTreeMap, BTreeSet};

use html5ever::tendril::TendrilSink;
use html5ever::{ParseOpts, QualName, local_name, ns, parse_document, parse_fragment};
use markup5ever_rcdom::{Handle, NodeData, RcDom};

use crate::engines::markers::collapse_cjk_spaces;

use super::common::{Warning, WarningCode};

/// 丢弃的不安全元素（§16）。
const DROPPED_TAGS: &[&str] = &[
    "script", "style", "iframe", "object", "embed", "applet", "link", "meta", "base", "frame",
    "frameset", "noscript",
];

/// 保留的属性白名单；此外 `data-*` 一律保留，其余一律丢弃。
const ALLOWED_ATTRS: &[&str] = &["id", "class", "lang", "scope", "rowspan", "colspan"];

/// 文本节点内容转义（`&`、`<`、`>`）。
pub fn escape_text(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            c => output.push(c),
        }
    }
    output
}

/// 属性值转义（在 [`escape_text`] 基础上加引号）。
pub fn escape_attr(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            c => output.push(c),
        }
    }
    output
}

/// 清洗后的 DOM 节点。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    /// 元素节点。
    Element(Element),
    /// 文本节点。
    Text(String),
}

/// 清洗后的元素节点。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Element {
    /// 小写标签名（仅用于诊断，不参与协议判定）。
    pub tag: String,
    /// 白名单属性（属性名小写）。
    pub attrs: BTreeMap<String, String>,
    /// 子节点。
    pub children: Vec<Node>,
}

impl Element {
    /// 读取属性。
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.get(name).map(String::as_str)
    }

    /// 读取 `id`。
    pub fn id(&self) -> Option<&str> {
        self.attr("id")
    }

    /// 是否带有某个 class（空白分隔，逐字节匹配）。
    pub fn has_class(&self, class: &str) -> bool {
        self.attr("class")
            .is_some_and(|value| value.split_whitespace().any(|item| item == class))
    }

    /// 原样拼接的后代文本。
    pub fn raw_text(&self) -> String {
        let mut output = String::new();
        collect_text(&self.children, &mut output);
        output
    }

    /// 归一化后代文本：压缩空白 + 折叠 CJK 之间的空格。
    pub fn text(&self) -> String {
        normalize_html_text(&self.raw_text())
    }

    /// 直接子元素。
    pub fn child_elements(&self) -> Vec<&Element> {
        self.children
            .iter()
            .filter_map(|node| match node {
                Node::Element(element) => Some(element),
                Node::Text(_) => None,
            })
            .collect()
    }

    /// 前序遍历的全部后代元素（不含自身）。
    pub fn descendants(&self) -> Vec<&Element> {
        let mut output = Vec::new();
        collect_elements(&self.children, &mut output);
        output
    }
}

/// HTML 文本归一化：压缩空白后折叠 CJK 空格。
pub fn normalize_html_text(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapse_cjk_spaces(&collapsed)
}

fn collect_text(nodes: &[Node], output: &mut String) {
    for node in nodes {
        match node {
            Node::Text(text) => output.push_str(text),
            Node::Element(element) => {
                collect_text(&element.children, output);
            }
        }
    }
}

fn collect_elements<'a>(nodes: &'a [Node], output: &mut Vec<&'a Element>) {
    for node in nodes {
        if let Node::Element(element) = node {
            output.push(element);
            collect_elements(&element.children, output);
        }
    }
}

/// 清洗后的文档树。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HtmlTree {
    /// 顶层节点。
    pub roots: Vec<Node>,
    /// 被丢弃的不安全标签名。
    pub dropped_tags: BTreeSet<String>,
    /// 被丢弃的非白名单属性名。
    pub dropped_attrs: BTreeSet<String>,
}

impl HtmlTree {
    /// 前序遍历的全部元素。
    pub fn elements(&self) -> Vec<&Element> {
        let mut output = Vec::new();
        collect_elements(&self.roots, &mut output);
        output
    }

    /// 按属性名筛选元素（前序）。
    pub fn elements_with_attr(&self, name: &str) -> Vec<&Element> {
        self.elements()
            .into_iter()
            .filter(|element| element.attrs.contains_key(name))
            .collect()
    }

    /// 全文归一化文本。
    pub fn text(&self) -> String {
        let mut output = String::new();
        collect_text(&self.roots, &mut output);
        normalize_html_text(&output)
    }

    /// 清洗动作转诊断项。
    pub fn warnings(&self) -> Vec<Warning> {
        let mut warnings = Vec::new();
        if !self.dropped_tags.is_empty() {
            warnings.push(Warning::document(
                WarningCode::NodeDropped,
                format!(
                    "丢弃不安全节点：{}",
                    self.dropped_tags
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            ));
        }
        if !self.dropped_attrs.is_empty() {
            warnings.push(Warning::document(
                WarningCode::AttributeDropped,
                format!(
                    "丢弃非白名单属性：{}",
                    self.dropped_attrs
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            ));
        }
        warnings
    }
}

/// 以文档模式宽容解析并清洗。
pub fn parse_html(input: &str) -> HtmlTree {
    let dom = parse_document(RcDom::default(), ParseOpts::default()).one(input);
    build_tree(&dom.document)
}

/// 以 `<table>` 片段上下文解析：模型只回 `<tbody>`/`<tr>` 时文档模式会整片丢弃。
pub fn parse_html_in_table(input: &str) -> HtmlTree {
    let context = QualName::new(None, ns!(html), local_name!("table"));
    let dom = parse_fragment(
        RcDom::default(),
        ParseOpts::default(),
        context,
        Vec::new(),
        false,
    )
    .one(input);
    build_tree(&dom.document)
}

fn build_tree(handle: &Handle) -> HtmlTree {
    let mut tree = HtmlTree::default();
    let mut nodes = Vec::new();
    convert_children(handle, &mut nodes, &mut tree);
    tree.roots = nodes;
    tree
}

fn convert_children(handle: &Handle, output: &mut Vec<Node>, tree: &mut HtmlTree) {
    for child in handle.children.borrow().iter() {
        match &child.data {
            NodeData::Text { contents } => {
                let text = contents.borrow().to_string();
                if !text.is_empty() {
                    output.push(Node::Text(text));
                }
            }
            NodeData::Element { name, attrs, .. } => {
                let tag = name.local.to_string().to_ascii_lowercase();
                if DROPPED_TAGS.contains(&tag.as_str()) {
                    tree.dropped_tags.insert(tag);
                    continue;
                }
                let mut kept = BTreeMap::new();
                for attr in attrs.borrow().iter() {
                    let key = attr.name.local.to_string().to_ascii_lowercase();
                    if ALLOWED_ATTRS.contains(&key.as_str()) || key.starts_with("data-") {
                        kept.insert(key, attr.value.to_string());
                    } else {
                        tree.dropped_attrs.insert(key);
                    }
                }
                let mut children = Vec::new();
                convert_children(child, &mut children, tree);
                // `html`/`head`/`body` 是解析器补出来的骨架，直接提升子节点，
                // 让协议层只面对内容元素。
                if matches!(tag.as_str(), "html" | "head" | "body") && kept.is_empty() {
                    output.extend(children);
                } else {
                    output.push(Node::Element(Element {
                        tag,
                        attrs: kept,
                        children,
                    }));
                }
            }
            NodeData::Document | NodeData::Doctype { .. } => {
                convert_children(child, output, tree);
            }
            NodeData::Comment { .. } | NodeData::ProcessingInstruction { .. } => {}
        }
    }
}

/// 按 `id` 建索引（逐字节精确匹配，不做大小写折叠）。
///
/// 返回 `(索引, 重复出现的 id)`；重复 id 只保留首次出现的元素。
pub fn index_by_id(tree: &HtmlTree) -> (BTreeMap<String, &Element>, Vec<String>) {
    let mut index: BTreeMap<String, &Element> = BTreeMap::new();
    let mut duplicates = Vec::new();
    for element in tree.elements() {
        let Some(id) = element.id() else { continue };
        if id.is_empty() {
            continue;
        }
        if index.contains_key(id) {
            if !duplicates.iter().any(|item| item == id) {
                duplicates.push(id.to_owned());
            }
            continue;
        }
        index.insert(id.to_owned(), element);
    }
    (index, duplicates)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaping_covers_html_specials() {
        assert_eq!(escape_text("a<b>&\"c\""), "a&lt;b&gt;&amp;\"c\"");
        assert_eq!(escape_attr("a<b>&\"c'"), "a&lt;b&gt;&amp;&quot;c&#39;");
    }

    #[test]
    fn parse_drops_unsafe_nodes_and_attributes() {
        let tree = parse_html(
            r#"<article><script>alert(1)</script><p id="s-1" onclick="x()" href="http://evil">hi</p></article>"#,
        );
        let (index, duplicates) = index_by_id(&tree);
        assert!(duplicates.is_empty());
        let paragraph = index.get("s-1").unwrap();
        assert_eq!(paragraph.text(), "hi");
        assert_eq!(paragraph.attr("onclick"), None);
        assert_eq!(paragraph.attr("href"), None);
        assert!(tree.dropped_tags.contains("script"));
        assert!(tree.dropped_attrs.contains("onclick"));
        assert!(!tree.text().contains("alert"));
    }

    #[test]
    fn parse_keeps_data_attributes_and_entities() {
        let tree = parse_html(r#"<p id="s-1" data-editable="false">a &lt;b&gt; &amp; c</p>"#);
        let (index, _) = index_by_id(&tree);
        let paragraph = index.get("s-1").unwrap();
        assert_eq!(paragraph.attr("data-editable"), Some("false"));
        assert_eq!(paragraph.text(), "a <b> & c");
    }

    #[test]
    fn table_fragment_context_keeps_rows() {
        let bare = r#"<tbody data-sid="s-1"><tr><td class="tgt">译文</td></tr></tbody>"#;
        let document_mode = parse_html(bare);
        assert!(document_mode.elements_with_attr("data-sid").is_empty());
        let fragment_mode = parse_html_in_table(bare);
        assert_eq!(fragment_mode.elements_with_attr("data-sid").len(), 1);
    }

    #[test]
    fn duplicate_ids_are_reported_once() {
        let tree = parse_html(r#"<p id="s-1">a</p><p id="s-1">b</p><p id="s-1">c</p>"#);
        let (index, duplicates) = index_by_id(&tree);
        assert_eq!(duplicates, vec!["s-1".to_owned()]);
        assert_eq!(index.get("s-1").unwrap().text(), "a");
    }

    #[test]
    fn text_collapses_pretty_printing_and_cjk_gaps() {
        let tree = parse_html("<p id=\"s-1\">\n  你好\n  世界\n</p>");
        let (index, _) = index_by_id(&tree);
        assert_eq!(index.get("s-1").unwrap().text(), "你好世界");
        let latin = parse_html("<p id=\"s-2\">\n  hello\n  world\n</p>");
        let (latin_index, _) = index_by_id(&latin);
        assert_eq!(latin_index.get("s-2").unwrap().text(), "hello world");
    }

    #[test]
    fn ids_are_matched_byte_exactly() {
        let tree = parse_html(r#"<p id="S-G1.0">a</p><p id="s-g1.0">b</p>"#);
        let (index, duplicates) = index_by_id(&tree);
        assert!(duplicates.is_empty());
        assert_eq!(index.get("s-g1.0").unwrap().text(), "b");
        assert_eq!(index.get("S-G1.0").unwrap().text(), "a");
    }
}

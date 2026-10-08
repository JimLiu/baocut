/*!
 * 元素路径与编辑溯源的**寻址层**（BCF 直接编辑回写方案 §4.3）。
 *
 * 界面在舞台上点中的是 resolve 之后的节点，而回写要落到作者写在 TSX 里的节点，
 * 中间隔着 `Resolver::expand_node` 的组件展开与派生 id 铸造。本模块定义两跳映射
 * 里**共用的那套地址**：
 *
 * 1. **元素路径**（`path`）：从 clip 根元素出发的 `/` 分段串。每段是子节点的
 *    `id`（非空、不含 `/`、且在同级里唯一），否则退化成 `#<下标>`。根元素本身
 *    是空串。id 优先是刻意的——作者重排数组不该让未决的编辑请求失配。
 * 2. **JSON 指针**（`pointer`）：编译产物里的绝对位置，形如
 *    `tracks/0/clips/2/element/children/1/style/x`（无前导 `/`，数组用下标）。
 *    edit-map 的条目、W2 手术的目标都以它为准。
 *
 * 客户端说 `(clip, path, prop)`，服务端用 [`locate_element`] 把它折成 pointer，
 * 再查 edit-map 决定走哪条通道。反方向（pointer → path）不提供：pointer 是实现
 * 内部的精确坐标，暴露给消费方会让它去反解析数组下标。
 */

use serde_json::Value;

use crate::json::JsonExt;

/// 元素路径的下标段前缀。`#` 不是合法 id 首字符，两种段形态不会撞。
pub const INDEX_PREFIX: char = '#';

/// 单个子节点在同级里的路径段：有稳定 id 用 id，否则 `#<下标>`。
///
/// “稳定”= 非空、不含 `/`、不以 `#` 开头、且在 `siblings` 里唯一。同级重名时
/// 两个节点都退化成下标段（否则一条路径会指向两个节点）。
pub fn path_segment(siblings: &[Value], index: usize) -> String {
    let fallback = format!("{INDEX_PREFIX}{index}");
    let Some(node) = siblings.get(index) else {
        return fallback;
    };
    let Some(id) = stable_id(node) else {
        return fallback;
    };
    let unique = siblings
        .iter()
        .enumerate()
        .all(|(i, other)| i == index || stable_id(other) != Some(id));
    if unique { id.to_string() } else { fallback }
}

/// 可作路径段的 id：非空、不含 `/`、不以 `#` 开头。
pub fn stable_id(node: &Value) -> Option<&str> {
    let id = node.gstr("id")?;
    if id.is_empty() || id.contains('/') || id.starts_with(INDEX_PREFIX) {
        return None;
    }
    Some(id)
}

/// 拼接元素路径：`join_path("", "title") == "title"`。
pub fn join_path(base: &str, segment: &str) -> String {
    if base.is_empty() {
        segment.to_string()
    } else {
        format!("{base}/{segment}")
    }
}

/// 拼接 JSON 指针段（同 `join_path`，另起名字是为了让调用点自己说清在拼哪种地址）。
pub fn join_pointer(base: &str, segment: &str) -> String {
    join_path(base, segment)
}

/// `prop` 的点路径 → 指针段（`style.x` → `style/x`）。
pub fn prop_pointer(prop: &str) -> String {
    prop.replace('.', "/")
}

/// 按 JSON 指针（无前导 `/`，数组用下标）取值。
pub fn value_at<'a>(doc: &'a Value, pointer: &str) -> Option<&'a Value> {
    let mut cur = doc;
    if pointer.is_empty() {
        return Some(cur);
    }
    for seg in pointer.split('/') {
        cur = match cur {
            Value::Object(map) => map.get(seg)?,
            Value::Array(items) => items.get(seg.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(cur)
}

/// clip id → 它在编译产物里的 `element` 指针（`tracks/<i>/clips/<j>/element`）。
pub fn locate_clip_element(doc: &Value, clip: &str) -> Option<String> {
    let tracks = doc.get_("tracks")?.as_array()?;
    for (ti, track) in tracks.iter().enumerate() {
        let clips = track.get_("clips").and_then(Value::as_array)?;
        for (ci, c) in clips.iter().enumerate() {
            if c.gstr("id") == Some(clip) && c.get_("element").is_some() {
                return Some(format!("tracks/{ti}/clips/{ci}/element"));
            }
        }
    }
    None
}

/// `(clip, 元素路径)` → 编译产物里的 JSON 指针。
///
/// 路径段既认 id，也认 `#<下标>`；为了兼容手写的目标，纯数字段在 id 匹配失败后
/// 再按下标试一次（方案 §3 的示例就写成 `cards/1/value`）。
pub fn locate_element(doc: &Value, clip: &str, path: &str) -> Option<String> {
    let mut pointer = locate_clip_element(doc, clip)?;
    if path.is_empty() {
        return Some(pointer);
    }
    let mut node = value_at(doc, &pointer)?.clone();
    for seg in path.split('/') {
        let empty = Vec::new();
        let children = node
            .get_("children")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        let index = child_index(children, seg)?;
        pointer = format!("{pointer}/children/{index}");
        node = children[index].clone();
    }
    Some(pointer)
}

/// 一段路径在同级数组里的下标。
fn child_index(children: &[Value], segment: &str) -> Option<usize> {
    if let Some(rest) = segment.strip_prefix(INDEX_PREFIX) {
        return rest.parse::<usize>().ok().filter(|i| *i < children.len());
    }
    let by_id = children
        .iter()
        .enumerate()
        .filter(|(i, _)| path_segment(children, *i) == segment)
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    if by_id.len() == 1 {
        return Some(by_id[0]);
    }
    // 兜底：裸数字段按下标（方案示例里的 `cards/1/value` 形态）
    segment
        .parse::<usize>()
        .ok()
        .filter(|i| *i < children.len())
}

/// 编译产物里一棵元素树的全部路径（深度优先，根在前）。
pub fn element_paths(root: &Value) -> Vec<String> {
    let mut out = Vec::new();
    walk_paths(root, String::new(), &mut out);
    out
}

fn walk_paths(node: &Value, path: String, out: &mut Vec<String>) {
    out.push(path.clone());
    let empty = Vec::new();
    let children = node
        .get_("children")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    for i in 0..children.len() {
        let seg = path_segment(children, i);
        walk_paths(&children[i], join_path(&path, &seg), out);
    }
}

/// 舞台节点的作者溯源（`resolve` 铸派生 id 时随手登记，方案 §4.3-2）。
///
/// 消费方拿它把 resolved 命中折回**作者写的那个节点**；`component` 非空即说明
/// 这个节点是组件展开的产物，W2 手术一律不适用，只能进 W3。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NodeOrigin {
    /// 作者节点的元素路径。组件**内部**节点从组件根起算；逐实例 wrapper
    /// （编译器铸的合成盒）留在 clip 空间，值即 `use` 节点自身的路径。
    pub authored: String,
    /// 组件名（组件展开产物才有）。
    pub component: Option<String>,
    /// 实例化点：`use` 节点自身的元素路径（clip 根起算）。
    pub site: Option<String>,
    /// `use.each` 展开下标。
    pub index: Option<usize>,
}

impl NodeOrigin {
    /// 直接写在 clip 元素树里的作者节点。
    pub fn authored(path: impl Into<String>) -> Self {
        Self {
            authored: path.into(),
            ..Default::default()
        }
    }

    /// 组件展开产物：`site` 是 use 节点路径，`authored` 是组件根内路径。
    pub fn derived(
        component: impl Into<String>,
        site: impl Into<String>,
        index: usize,
        authored: impl Into<String>,
    ) -> Self {
        Self {
            authored: authored.into(),
            component: Some(component.into()),
            site: Some(site.into()),
            index: Some(index),
        }
    }

    /// 派生节点不可字面量手术（方案 §4.3-2：折不回作者节点就归 derived）。
    pub fn is_derived(&self) -> bool {
        self.component.is_some()
    }

    /// 与预览壳 `resolve.js` 的 `_origin` 同形的 JSON（镜像对拍用）。
    pub fn to_json(&self) -> Value {
        let mut map = serde_json::Map::new();
        map.insert("authored".into(), Value::String(self.authored.clone()));
        if let Some(c) = &self.component {
            map.insert("component".into(), Value::String(c.clone()));
        }
        if let Some(s) = &self.site {
            map.insert("site".into(), Value::String(s.clone()));
        }
        if let Some(i) = self.index {
            map.insert("index".into(), Value::Number((i as u64).into()));
        }
        Value::Object(map)
    }
}

/// 反查表的一行：舞台上的 resolved 位置 → 作者节点。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginEntry {
    /// resolved 树里的元素路径（同一套分段规则，但走的是展开后的树）。
    pub resolved: String,
    /// resolved 节点 id（可能重复——组件多实例共享组件根 id，故不作键）。
    pub id: String,
    pub origin: NodeOrigin,
}

impl OriginEntry {
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "resolved": self.resolved,
            "id": self.id,
            "origin": self.origin.to_json(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc() -> Value {
        json!({
            "tracks": [
                {"id": "bg", "kind": "visual", "clips": [
                    {"id": "back", "element": {"type": "box", "id": "root"}}
                ]},
                {"id": "main", "kind": "visual", "clips": [
                    {"id": "problem-shot", "element": {"type": "box", "id": "root", "children": [
                        {"type": "text", "id": "title", "text": "hi", "style": {"x": 180}},
                        {"type": "box", "id": "cards", "children": [
                            {"type": "text", "text": "a"},
                            {"type": "text", "text": "b"}
                        ]},
                        {"type": "box", "id": "dup"},
                        {"type": "box", "id": "dup"}
                    ]}}
                ]}
            ]
        })
    }

    #[test]
    fn segments_prefer_ids_and_fall_back_to_indices() {
        let children = doc()["tracks"][1]["clips"][0]["element"]["children"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(path_segment(&children, 0), "title");
        assert_eq!(path_segment(&children, 1), "cards");
        // 同级重名：两个都退化成下标段
        assert_eq!(path_segment(&children, 2), "#2");
        assert_eq!(path_segment(&children, 3), "#3");
    }

    #[test]
    fn locate_element_walks_ids_indices_and_bare_numbers() {
        let d = doc();
        assert_eq!(
            locate_element(&d, "problem-shot", "").unwrap(),
            "tracks/1/clips/0/element"
        );
        assert_eq!(
            locate_element(&d, "problem-shot", "title").unwrap(),
            "tracks/1/clips/0/element/children/0"
        );
        assert_eq!(
            locate_element(&d, "problem-shot", "cards/#1").unwrap(),
            "tracks/1/clips/0/element/children/1/children/1"
        );
        // 方案示例里的裸数字段
        assert_eq!(
            locate_element(&d, "problem-shot", "cards/1").unwrap(),
            "tracks/1/clips/0/element/children/1/children/1"
        );
        assert_eq!(locate_element(&d, "problem-shot", "nope"), None);
        assert_eq!(locate_element(&d, "missing-clip", ""), None);
    }

    #[test]
    fn value_at_reads_object_and_array_segments() {
        let d = doc();
        let pointer = locate_element(&d, "problem-shot", "title").unwrap();
        let x = value_at(&d, &format!("{pointer}/{}", prop_pointer("style.x"))).unwrap();
        assert_eq!(x, &json!(180));
        assert!(value_at(&d, "tracks/9/clips").is_none());
        assert_eq!(value_at(&d, "").unwrap(), &d);
    }

    #[test]
    fn element_paths_enumerates_the_tree_depth_first() {
        let root = &doc()["tracks"][1]["clips"][0]["element"];
        assert_eq!(
            element_paths(root),
            vec![
                "".to_string(),
                "title".into(),
                "cards".into(),
                "cards/#0".into(),
                "cards/#1".into(),
                "#2".into(),
                "#3".into(),
            ]
        );
    }
}

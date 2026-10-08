//! Transcript 局部补丁（`patchTranscript`）：把编辑器「整文档快照」的差异压缩成
//! 只含改动的补丁，在服务端原地应用到 [`TranscriptDoc`]。
//!
//! 动机：Mac 编辑器本地持有一份可变文档，改说话人名、章节、段落断点或某一段
//! 字幕后曾以 `replaceTranscript` 整份回传；数小时的逐词转录稿轻松达到数 MB，
//! 既撞请求体上限，也让每次按键的写盘/历史/投影都按全量算。补丁把网络与
//! journal 的成本压到与改动成正比，而语义仍然是「客户端提交它想要的最终值」，
//! 不把业务规则搬回服务端。
//!
//! 补丁形状（op 里除 `kind` 之外的字段）：
//!
//! ```jsonc
//! {
//!   "words": {
//!     // 原地改词：只列出变化的字段
//!     "update":  { "<id>": { "t0"?: 1.2, "t1"?: 1.5, "text"?: "…", "sp"?: "s1" } },
//!     // 结构改动：闭区间替换（words 为空即删除）；或在某词之后插入（after=null 为开头）
//!     "splices": [
//!       { "first": "<id>", "last": "<id>", "words": [ {id,t0,t1,text,sp}, … ] },
//!       { "after": "<id>" | null,          "words": [ … ] }
//!     ]
//!   },
//!   "set": {
//!     // 稀疏表：键 → 新值；null 删除该键
//!     "speakers":   { "<id>": {"name": "…", "hue"?: 210} | null },
//!     "breaks":     { "<wordId>": "break" | "nobreak" | null },
//!     // 优化器自动 pin：profile → null 删整表；profile → {wordId → 值 | null}
//!     "autoBreaks": { "<profile>": null | { "<wordId>": "break" | "nobreak" | null } },
//!     // 生效的 LayoutProfile id；null 回到缺省 "default"
//!     "layoutProfile": "<id>" | null,
//!     "paraBreaks": { "<wordId>": true | null },
//!     "hidden":     { "<wordId>": true | null },
//!     // 阶段戳：串照写；null 清掉；true = 盖上补丁应用后 words 的内容指纹
//!     //（客户端拿不到 words 全量时声明「此表与当前文稿一致」的唯一写法）
//!     "stages":     { "asr"|"asrLayout"|"polish"|"segment"|"chapters": "…" | null | true },
//!     // 两级表：lang → null 删整语言；lang → {sid → 值 | null}
//!     "trans":      { "<lang>": null | { "<sid>": "…" | null } },
//!     "transAlign": { "<lang>": null | { "<sid>": {mode,pieces,…} | null } },
//!     "transSrc":   { "<lang>": null | { "<sid>": "…" | null } },
//!     // 0.4 单调化显示改写：lang → sid → {text,basis,transFingerprint}
//!     "transDisplay": { "<lang>": null | { "<sid>": {text,basis,transFingerprint} | null } },
//!     // 章节表很小，整表替换
//!     "chapters":   [ {id,title,start,end}, … ]
//!   }
//! }
//! ```
//!
//! 应用顺序：splices → update → set。全部应用完毕后由调用方跑
//! [`TranscriptDoc::validate`]；补丁本身只保证引用的词/表键存在，不做业务校验。
//! 任何一步失败都返回错误，调用方不得写盘（补丁作用在内存副本上）。

use crate::doc::{
    BreakOverride, Chapter, Speaker, Stages, TransAlign, TransDisplay, TranscriptDoc, Word,
};
use crate::fingerprint::fingerprint;
use anyhow::{Result, anyhow, bail};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// 补丁应用后的统计，供 apply 回执里的 `applied` 条目描述改了什么。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PatchSummary {
    pub updated_words: usize,
    pub removed_words: usize,
    pub inserted_words: usize,
    pub splices: usize,
    /// 被 `set` 触碰的表名（按补丁出现顺序去重）。
    pub tables: Vec<String>,
}

impl PatchSummary {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "updatedWords": self.updated_words,
            "removedWords": self.removed_words,
            "insertedWords": self.inserted_words,
            "splices": self.splices,
            "tables": self.tables,
        })
    }
}

const WORD_KEYS: &[&str] = &["update", "splices"];
const SET_KEYS: &[&str] = &[
    "speakers",
    "chapters",
    "breaks",
    "autoBreaks",
    "layoutProfile",
    "paraBreaks",
    "hidden",
    "stages",
    "trans",
    "transAlign",
    "transSrc",
    "transDisplay",
];
const STAGE_KEYS: &[&str] = &["asr", "asrLayout", "polish", "segment", "chapters"];

/// 把补丁应用到 `doc`。`patch` 是 op 对象本身（可含 `kind`，会被忽略）。
///
/// 事务性：任一步失败时 `doc` 保持原样（内部先在副本上应用，成功才换入）。
pub fn apply_patch(doc: &mut TranscriptDoc, patch: &Value) -> Result<PatchSummary> {
    let object = patch
        .as_object()
        .ok_or_else(|| anyhow!("patchTranscript 必须是对象"))?;
    for key in object.keys() {
        if !matches!(key.as_str(), "kind" | "words" | "set") {
            bail!("patchTranscript 不认识的字段：{key}");
        }
    }
    let mut candidate = doc.clone();
    let mut summary = PatchSummary::default();
    if let Some(words) = object.get("words") {
        apply_words(&mut candidate, words, &mut summary)?;
    }
    if let Some(set) = object.get("set") {
        apply_set(&mut candidate, set, &mut summary)?;
    }
    if summary.is_empty() {
        bail!("patchTranscript 为空：words 与 set 都没有改动");
    }
    *doc = candidate;
    Ok(summary)
}

fn apply_words(doc: &mut TranscriptDoc, words: &Value, summary: &mut PatchSummary) -> Result<()> {
    let object = words
        .as_object()
        .ok_or_else(|| anyhow!("patchTranscript.words 必须是对象"))?;
    for key in object.keys() {
        if !WORD_KEYS.contains(&key.as_str()) {
            bail!("patchTranscript.words 不认识的字段：{key}");
        }
    }
    if let Some(splices) = object.get("splices") {
        let splices = splices
            .as_array()
            .ok_or_else(|| anyhow!("words.splices 必须是数组"))?;
        for (index, splice) in splices.iter().enumerate() {
            apply_splice(doc, splice, summary)
                .map_err(|error| anyhow!("words.splices[{index}]：{error}"))?;
        }
    }
    if let Some(update) = object.get("update") {
        let update = update
            .as_object()
            .ok_or_else(|| anyhow!("words.update 必须是对象"))?;
        apply_word_updates(doc, update, summary)?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SpliceBody {
    #[serde(default)]
    first: Option<String>,
    #[serde(default)]
    last: Option<String>,
    /// `Some(None)` = 显式 null（开头插入），`None` = 未给。
    #[serde(default, deserialize_with = "deserialize_nullable")]
    after: Option<Option<String>>,
    words: Vec<Word>,
}

fn deserialize_nullable<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(Some)
}

fn apply_splice(doc: &mut TranscriptDoc, splice: &Value, summary: &mut PatchSummary) -> Result<()> {
    let body: SpliceBody = serde_json::from_value(splice.clone())
        .map_err(|error| anyhow!("splice 形状无效：{error}"))?;
    let index_of = |doc: &TranscriptDoc, id: &str| -> Result<usize> {
        doc.words
            .iter()
            .position(|word| word.id == id)
            .ok_or_else(|| anyhow!("词 {id} 不存在"))
    };
    match (body.first, body.last, body.after) {
        (Some(first), Some(last), None) => {
            let start = index_of(doc, &first)?;
            let end = index_of(doc, &last)?;
            if end < start {
                bail!("first {first} 在 last {last} 之后");
            }
            let removed = end - start + 1;
            let inserted = body.words.len();
            doc.words.splice(start..=end, body.words);
            summary.removed_words += removed;
            summary.inserted_words += inserted;
        }
        (None, None, Some(after)) => {
            if body.words.is_empty() {
                bail!("插入 splice 的 words 不能为空");
            }
            let at = match after {
                Some(id) => index_of(doc, &id)? + 1,
                None => 0,
            };
            summary.inserted_words += body.words.len();
            doc.words.splice(at..at, body.words);
        }
        _ => bail!("splice 必须是 {{first,last,words}} 或 {{after,words}} 之一"),
    }
    summary.splices += 1;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WordUpdate {
    #[serde(default)]
    t0: Option<f64>,
    #[serde(default)]
    t1: Option<f64>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    sp: Option<String>,
}

fn apply_word_updates(
    doc: &mut TranscriptDoc,
    update: &Map<String, Value>,
    summary: &mut PatchSummary,
) -> Result<()> {
    if update.is_empty() {
        return Ok(());
    }
    // 一次建索引：更新可能覆盖几千词（如整段说话人重指派）。
    let index: BTreeMap<&str, usize> = doc
        .words
        .iter()
        .enumerate()
        .map(|(index, word)| (word.id.as_str(), index))
        .collect();
    let mut targets = Vec::with_capacity(update.len());
    for (id, fields) in update {
        let position = *index
            .get(id.as_str())
            .ok_or_else(|| anyhow!("words.update：词 {id} 不存在"))?;
        let fields: WordUpdate = serde_json::from_value(fields.clone())
            .map_err(|error| anyhow!("words.update[{id}] 形状无效：{error}"))?;
        if fields.t0.is_none()
            && fields.t1.is_none()
            && fields.text.is_none()
            && fields.sp.is_none()
        {
            bail!("words.update[{id}] 没有任何字段");
        }
        targets.push((position, fields));
    }
    for (position, fields) in targets {
        let word = &mut doc.words[position];
        if let Some(t0) = fields.t0 {
            word.t0 = t0;
        }
        if let Some(t1) = fields.t1 {
            word.t1 = t1;
        }
        if let Some(text) = fields.text {
            word.text = text;
        }
        if let Some(sp) = fields.sp {
            word.sp = sp;
        }
        summary.updated_words += 1;
    }
    Ok(())
}

fn apply_set(doc: &mut TranscriptDoc, set: &Value, summary: &mut PatchSummary) -> Result<()> {
    let object = set
        .as_object()
        .ok_or_else(|| anyhow!("patchTranscript.set 必须是对象"))?;
    for (key, value) in object {
        match key.as_str() {
            "speakers" => patch_map(&mut doc.speakers, value, "speakers", |value| {
                serde_json::from_value::<Speaker>(value.clone())
                    .map_err(|error| anyhow!("speaker 形状无效：{error}"))
            })?,
            "chapters" => {
                doc.chapters = serde_json::from_value::<Vec<Chapter>>(value.clone())
                    .map_err(|error| anyhow!("set.chapters 必须是章节数组：{error}"))?;
            }
            "breaks" => patch_map(&mut doc.breaks, value, "breaks", |value| {
                serde_json::from_value::<BreakOverride>(value.clone())
                    .map_err(|_| anyhow!("breaks 值必须是 break 或 nobreak"))
            })?,
            "autoBreaks" => patch_nested(&mut doc.auto_breaks, value, "autoBreaks", |value| {
                serde_json::from_value::<BreakOverride>(value.clone())
                    .map_err(|_| anyhow!("autoBreaks 值必须是 break 或 nobreak"))
            })?,
            "layoutProfile" => {
                doc.layout_profile = match value {
                    Value::Null => None,
                    Value::String(id) if !id.trim().is_empty() => Some(id.clone()),
                    _ => bail!("set.layoutProfile 必须是非空字符串或 null"),
                };
            }
            "paraBreaks" => patch_map(&mut doc.para_breaks, value, "paraBreaks", |value| {
                value
                    .as_bool()
                    .ok_or_else(|| anyhow!("paraBreaks 值必须是布尔"))
            })?,
            "hidden" => patch_map(&mut doc.hidden, value, "hidden", |value| {
                value
                    .as_bool()
                    .ok_or_else(|| anyhow!("hidden 值必须是布尔"))
            })?,
            "stages" => {
                // 顺序上 set 最后应用，words 已是终态；`true` 就盖它的内容指纹。
                let current = fingerprint(&doc.words);
                patch_stages(&mut doc.stages, value, &current)?
            }
            "trans" => patch_nested(&mut doc.trans, value, "trans", |value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| anyhow!("trans 值必须是字符串"))
            })?,
            "transAlign" => patch_nested(&mut doc.trans_align, value, "transAlign", |value| {
                serde_json::from_value::<TransAlign>(value.clone())
                    .map_err(|error| anyhow!("transAlign 形状无效：{error}"))
            })?,
            "transSrc" => patch_nested(&mut doc.trans_src, value, "transSrc", |value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| anyhow!("transSrc 值必须是字符串"))
            })?,
            "transDisplay" => {
                patch_nested(&mut doc.trans_display, value, "transDisplay", |value| {
                    serde_json::from_value::<TransDisplay>(value.clone())
                        .map_err(|error| anyhow!("transDisplay 形状无效：{error}"))
                })?
            }
            other => bail!(
                "patchTranscript.set 不认识的表：{other}（可用：{}）",
                SET_KEYS.join(", ")
            ),
        }
        if !summary.tables.iter().any(|table| table == key) {
            summary.tables.push(key.clone());
        }
    }
    Ok(())
}

/// 稀疏表补丁：`{key: value | null}`。
fn patch_map<T>(
    table: &mut BTreeMap<String, T>,
    patch: &Value,
    name: &str,
    parse: impl Fn(&Value) -> Result<T>,
) -> Result<()> {
    let object = patch
        .as_object()
        .ok_or_else(|| anyhow!("set.{name} 必须是对象"))?;
    for (key, value) in object {
        if value.is_null() {
            table.remove(key);
        } else {
            let parsed = parse(value).map_err(|error| anyhow!("set.{name}[{key}]：{error}"))?;
            table.insert(key.clone(), parsed);
        }
    }
    Ok(())
}

/// 两级表补丁：`{lang: null | {sid: value | null}}`。语言下的表补空后自动移除，
/// 与序列化时 `skip_serializing_if = "BTreeMap::is_empty"` 的约定一致。
fn patch_nested<T>(
    table: &mut BTreeMap<String, BTreeMap<String, T>>,
    patch: &Value,
    name: &str,
    parse: impl Fn(&Value) -> Result<T>,
) -> Result<()> {
    let object = patch
        .as_object()
        .ok_or_else(|| anyhow!("set.{name} 必须是对象"))?;
    for (lang, value) in object {
        if value.is_null() {
            table.remove(lang);
            continue;
        }
        let entries = value
            .as_object()
            .ok_or_else(|| anyhow!("set.{name}[{lang}] 必须是对象或 null"))?;
        let inner = table.entry(lang.clone()).or_default();
        for (id, entry) in entries {
            if entry.is_null() {
                inner.remove(id);
            } else {
                let parsed =
                    parse(entry).map_err(|error| anyhow!("set.{name}[{lang}][{id}]：{error}"))?;
                inner.insert(id.clone(), parsed);
            }
        }
        if inner.is_empty() {
            table.remove(lang);
        }
    }
    Ok(())
}

/// `current` 是补丁应用后 words 的内容指纹：值写 `true` 的阶段盖它。
fn patch_stages(stages: &mut Stages, patch: &Value, current: &str) -> Result<()> {
    let object = patch
        .as_object()
        .ok_or_else(|| anyhow!("set.stages 必须是对象"))?;
    for (key, value) in object {
        let slot = match key.as_str() {
            "asr" => &mut stages.asr,
            "asrLayout" => &mut stages.asr_layout,
            "polish" => &mut stages.polish,
            "segment" => &mut stages.segment,
            "chapters" => &mut stages.chapters,
            other => bail!(
                "set.stages 不认识的阶段：{other}（可用：{}）",
                STAGE_KEYS.join(", ")
            ),
        };
        *slot = match value {
            Value::Null => None,
            Value::String(text) => Some(text.clone()),
            Value::Bool(true) => Some(current.to_owned()),
            _ => bail!("set.stages[{key}] 必须是字符串、null 或 true"),
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia};
    use serde_json::json;

    fn word(id: &str, t0: f64, t1: f64, text: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        }
    }

    fn doc() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "h".to_owned(),
                duration: 10.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        doc.speakers.insert(
            "s1".to_owned(),
            Speaker {
                name: "Alice".to_owned(),
                hue: Some(10),
            },
        );
        doc.words = vec![
            word("a", 0.0, 1.0, "one"),
            word("b", 1.0, 2.0, "two"),
            word("c", 2.0, 3.0, "three"),
            word("d", 3.0, 4.0, "four"),
        ];
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-a".to_owned(), "一二三四".to_owned());
        doc
    }

    #[test]
    fn renames_speaker_without_touching_words() {
        let mut doc = doc();
        let before_words = doc.words.clone();
        let summary = apply_patch(
            &mut doc,
            &json!({"kind": "patchTranscript", "set": {"speakers": {"s1": {"name": "Bob", "hue": 42}}}}),
        )
        .unwrap();
        assert_eq!(doc.speakers["s1"].name, "Bob");
        assert_eq!(doc.speakers["s1"].hue, Some(42));
        assert_eq!(doc.words, before_words);
        assert_eq!(summary.tables, vec!["speakers"]);
        assert_eq!(summary.updated_words, 0);
        doc.validate().unwrap();
    }

    #[test]
    fn updates_words_in_place_and_splices_ranges() {
        let mut doc = doc();
        let summary = apply_patch(
            &mut doc,
            &json!({
                "words": {
                    "update": {"a": {"text": "ONE"}, "d": {"t1": 4.5}},
                    "splices": [
                        {"first": "b", "last": "c", "words": [
                            {"id": "w1", "t0": 1.0, "t1": 3.0, "text": "twothree", "sp": "s1"}
                        ]},
                        {"after": null, "words": [
                            {"id": "w0", "t0": 0.0, "t1": 0.0, "text": "Hi", "sp": "s1"}
                        ]}
                    ]
                }
            }),
        )
        .unwrap();
        let ids: Vec<&str> = doc.words.iter().map(|word| word.id.as_str()).collect();
        assert_eq!(ids, vec!["w0", "a", "w1", "d"]);
        assert_eq!(doc.words[1].text, "ONE");
        assert_eq!(doc.words[3].t1, 4.5);
        assert_eq!(summary.updated_words, 2);
        assert_eq!(summary.removed_words, 2);
        assert_eq!(summary.inserted_words, 2);
        assert_eq!(summary.splices, 2);
        doc.validate().unwrap();
    }

    #[test]
    fn deletes_a_range_and_patches_nested_tables() {
        let mut doc = doc();
        apply_patch(
            &mut doc,
            &json!({
                "words": {"splices": [{"first": "c", "last": "d", "words": []}]},
                "set": {
                    "paraBreaks": {"b": true},
                    "trans": {"zh": {"s-a": "一二", "s-zzz": null}},
                    "transSrc": {"zh": {"s-a": "fp"}},
                    "stages": {"asr": null, "polish": "p1"},
                    "chapters": [{"id": "c1", "title": "T", "start": 0.0, "end": 2.0}]
                }
            }),
        )
        .unwrap();
        assert_eq!(doc.words.len(), 2);
        assert_eq!(doc.para_breaks["b"], true);
        assert_eq!(doc.trans["zh"]["s-a"], "一二");
        assert_eq!(doc.trans_src["zh"]["s-a"], "fp");
        assert_eq!(doc.stages.polish.as_deref(), Some("p1"));
        assert_eq!(doc.chapters.len(), 1);
        doc.validate().unwrap();

        // 两级表补空即整语言消失，与序列化约定一致。
        apply_patch(&mut doc, &json!({"set": {"trans": {"zh": {"s-a": null}}}})).unwrap();
        assert!(doc.trans.get("zh").is_none());
    }

    /// `stages.<阶段>: true` 盖的是补丁应用**之后** words 的内容指纹：同一笔补丁里
    /// 先改词再声明章节一致，戳必须等于改词后的指纹（客户端拿不到全量 words）。
    #[test]
    fn stage_true_stamps_the_post_patch_content_fingerprint() {
        let mut doc = doc();
        let before = fingerprint(&doc.words);
        apply_patch(
            &mut doc,
            &json!({
                "words": {"update": {"a": {"text": "changed"}}},
                "set": {
                    "chapters": [{"id": "c1", "title": "T", "start": 0.0, "end": 2.0}],
                    "stages": {"chapters": true, "polish": null}
                }
            }),
        )
        .unwrap();
        let after = fingerprint(&doc.words);
        assert_ne!(before, after);
        assert_eq!(doc.stages.chapters.as_deref(), Some(after.as_str()));
        assert!(doc.stages.polish.is_none());
        // false 不是合法值：既不是串也不是「盖当前」。
        assert!(apply_patch(&mut doc, &json!({"set": {"stages": {"chapters": false}}})).is_err());
    }

    /// 0.4：`autoBreaks` 是 profile → 词 id 的两级稀疏表，`layoutProfile` 是标量。
    #[test]
    fn patches_auto_breaks_and_layout_profile() {
        let mut doc = doc();
        let summary = apply_patch(
            &mut doc,
            &json!({
                "set": {
                    "autoBreaks": {"default": {"a": "break", "b": "nobreak"}, "portrait": {"c": "break"}},
                    "layoutProfile": "portrait"
                }
            }),
        )
        .unwrap();
        assert_eq!(summary.tables, vec!["autoBreaks", "layoutProfile"]);
        assert_eq!(doc.auto_breaks["default"]["a"], BreakOverride::Break);
        assert_eq!(doc.auto_breaks["default"]["b"], BreakOverride::Nobreak);
        assert_eq!(doc.layout_profile.as_deref(), Some("portrait"));
        assert_eq!(doc.layout_profile_id(), "portrait");
        // 派生按生效 profile 取自动表：portrait 只钉 c。
        assert_eq!(
            doc.effective_breaks(doc.layout_profile_id()),
            BTreeMap::from([("c".to_owned(), BreakOverride::Break)])
        );

        // 单键删除、整表删除、profile 回缺省。
        apply_patch(
            &mut doc,
            &json!({"set": {
                "autoBreaks": {"default": {"b": null}, "portrait": null},
                "layoutProfile": null
            }}),
        )
        .unwrap();
        assert_eq!(doc.auto_breaks.get("default").map(BTreeMap::len), Some(1));
        assert!(!doc.auto_breaks.contains_key("portrait"));
        assert_eq!(doc.layout_profile, None);
        // 补空即整 profile 消失，与序列化约定一致。
        apply_patch(
            &mut doc,
            &json!({"set": {"autoBreaks": {"default": {"a": null}}}}),
        )
        .unwrap();
        assert!(doc.auto_breaks.is_empty());
        doc.validate().unwrap();

        // 值域校验：非法值与空 profile id 都拒绝，且不留半套改动。
        let baseline = doc.clone();
        assert!(
            apply_patch(
                &mut doc,
                &json!({"set": {"autoBreaks": {"default": {"a": "maybe"}}}})
            )
            .is_err()
        );
        assert!(apply_patch(&mut doc, &json!({"set": {"layoutProfile": ""}})).is_err());
        assert!(apply_patch(&mut doc, &json!({"set": {"layoutProfile": 3}})).is_err());
        assert_eq!(doc, baseline);
    }

    /// 0.4：`transDisplay` 与其他 `trans*` 表同形（lang → sid → 值），
    /// 值是完整的 `{text,basis,transFingerprint}` 对象；单键删除与整语言删除同约定。
    #[test]
    fn patches_trans_display_table() {
        let mut doc = doc();
        let summary = apply_patch(
            &mut doc,
            &json!({"set": {"transDisplay": {"zh": {"s-a": {
                "text": "我没去，因为我病了。", "basis": "monotonic-rewrite", "transFingerprint": "fp"
            }}}}}),
        )
        .unwrap();
        assert_eq!(summary.tables, vec!["transDisplay"]);
        assert_eq!(doc.trans_display["zh"]["s-a"].text, "我没去，因为我病了。");
        assert_eq!(doc.trans_display["zh"]["s-a"].basis, "monotonic-rewrite");
        // 形状不全（缺 transFingerprint）拒绝且不留半套改动。
        let baseline = doc.clone();
        assert!(
            apply_patch(
                &mut doc,
                &json!({"set": {"transDisplay": {"zh": {"s-b": {"text": "x", "basis": "y"}}}}}),
            )
            .is_err()
        );
        assert_eq!(doc, baseline);
        apply_patch(
            &mut doc,
            &json!({"set": {"transDisplay": {"zh": {"s-a": null}}}}),
        )
        .unwrap();
        assert!(doc.trans_display.get("zh").is_none());
    }

    #[test]
    fn rejects_unknown_ids_tables_and_empty_patches() {
        let mut doc = doc();
        let baseline = doc.clone();
        assert!(
            apply_patch(
                &mut doc,
                &json!({"words": {"update": {"zz": {"text": "x"}}}})
            )
            .is_err()
        );
        assert!(
            apply_patch(
                &mut doc,
                &json!({"words": {"splices": [{"first": "c", "last": "a", "words": []}]}})
            )
            .is_err()
        );
        assert!(apply_patch(&mut doc, &json!({"set": {"media": {"duration": 1}}})).is_err());
        assert!(apply_patch(&mut doc, &json!({"set": {"words": []}})).is_err());
        assert!(apply_patch(&mut doc, &json!({"kind": "patchTranscript"})).is_err());
        assert!(apply_patch(&mut doc, &json!({"set": {"stages": {"bogus": "x"}}})).is_err());
        // 前半合法、后半非法：失败的补丁不能留下半套改动。
        assert!(
            apply_patch(
                &mut doc,
                &json!({
                    "words": {"update": {"a": {"text": "changed"}}},
                    "set": {"speakers": {"s1": {"name": "X"}}, "nope": {}}
                })
            )
            .is_err()
        );
        assert_eq!(doc, baseline);
    }
}

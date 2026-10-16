//! 模板层（格式规范 §3.17）的目录与版面规则：内置目录按界面语言、按组分节，新建一层的默认参数，定义与实例的互换，
//! 版面编辑器的框几何与命中，画幅锁与字幕避让。都调 `timeline::template` 那一份，界面不另写。
//!
//! 内置模板的名字、说明与示例文字只有简中、繁中、英文、日文四套（`TemplateLang`）；别的界面语言按 `from_tag` 回落到英文。

use serde::{Deserialize, Serialize};
use timeline::template::{self as tpl, Frame, Handle, TemplateLang, group_key, group_label, group_templates};
use timeline::template::{LayerBox, TemplateCanvas, TemplateDoc, TemplateLayer};

use crate::{EntryError, invalid_input};

fn invalid_template(message: String) -> EntryError {
    EntryError {
        code: "INVALID_TEMPLATE",
        message,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogInput {
    /// 界面语言（BCP 47）。
    lang: String,
    /// 品牌库里的定义（一律归「品牌库」组，排在最后）。
    #[serde(default)]
    brand: Vec<TemplateDoc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogRow {
    doc: TemplateDoc,
    brand: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogGroup {
    key: &'static str,
    label: String,
    items: Vec<CatalogRow>,
}

/// 模板目录：内置十七款（按界面语言）加品牌库的定义，按组分节（组按固定次序，空组不出现，组名跟界面语言）。
pub fn template_catalog(input: &[u8]) -> Result<String, EntryError> {
    let input: CatalogInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let lang = TemplateLang::from_tag(&input.lang);
    let rows = tpl::builtins_in(lang)
        .into_iter()
        .map(|doc| CatalogRow { doc, brand: false })
        .chain(input.brand.into_iter().map(|doc| CatalogRow { doc, brand: true }));
    let groups: Vec<CatalogGroup> = group_templates(rows, |row| group_key(&row.doc, row.brand))
        .into_iter()
        .map(|group| CatalogGroup {
            key: group.key,
            label: group_label(group.key, lang).to_string(),
            items: group.items,
        })
        .collect();
    Ok(serde_json::to_string(&groups).expect("目录总能序列化"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewLayerInput {
    kind: String,
    lang: String,
    /// 这套模板里已有的层 id。
    #[serde(default)]
    taken: Vec<String>,
}

/// 新建一层：这一类的默认框与参数（台标的默认文字按界面语言），id 是 `l-<类>-<n>` 里没被占用的最小一个。
pub fn template_new_layer(input: &[u8]) -> Result<String, EntryError> {
    let input: NewLayerInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let (rect, kind) = tpl::new_layer_kind_in(&input.kind, TemplateLang::from_tag(&input.lang))
        .ok_or_else(|| invalid_template(format!("没有这一类模板层：{}", input.kind)))?;
    let id = tpl::next_id(&format!("l-{}-", input.kind), input.taken.iter().map(String::as_str));
    let layer = TemplateLayer { id, on: true, rect, kind };
    Ok(serde_json::to_string(&layer).expect("层总能序列化"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlankInput {
    #[serde(default)]
    canvas: TemplateCanvas,
    /// 新模板的名字（界面文案）。
    name: String,
}

/// 空白模板（版面编辑器的「自己做一个」）。
pub fn template_blank(input: &[u8]) -> Result<String, EntryError> {
    let input: BlankInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let mut doc = tpl::blank(input.canvas);
    doc.name = input.name;
    Ok(serde_json::to_string(&doc).expect("模板总能序列化"))
}

#[derive(Deserialize)]
struct DocInput {
    doc: TemplateDoc,
}

/// 定义 → 实例：深拷贝、记来源（`from` = 定义的 id）、去内置标记。套用时写进序列的是这一份。
pub fn template_instance(input: &[u8]) -> Result<String, EntryError> {
    let input: DocInput = serde_json::from_slice(input).map_err(invalid_input)?;
    Ok(serde_json::to_string(&tpl::instance(&input.doc)).expect("模板总能序列化"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DefinitionInput {
    doc: TemplateDoc,
    name: String,
    /// 品牌库里那一条的 id（新存时由调用方给出）。
    id: String,
}

/// 实例 → 品牌库的定义：换名字与 id，去掉 `from` 与内置标记（与 `merge_into_brand` 存进去的同一形状），并校验。
pub fn template_definition(input: &[u8]) -> Result<String, EntryError> {
    let input: DefinitionInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let mut doc = input.doc;
    doc.name = input.name;
    doc.id = input.id;
    doc.from = None;
    doc.builtin = false;
    tpl::validate(&doc).map_err(|error| invalid_template(error.to_string()))?;
    Ok(serde_json::to_string(&doc).expect("模板总能序列化"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TemplateInfo {
    /// 套用时改成的画幅（`original` 或 `W:H`）；没声明为 null。
    ratio_target: Option<String>,
    /// 画幅锁着（`lockRatio` 且声明了画幅）。
    ratio_locked: bool,
    /// 字幕底线抬到的百分比（画面高）；不用让为 0。
    subs_bottom: f64,
    /// 校验不过时的原因。
    #[serde(skip_serializing_if = "Option::is_none")]
    problem: Option<String>,
}

/// 一套模板的派生量：画幅目标与锁、字幕避让、能不能通过校验。
pub fn template_info(input: &[u8]) -> Result<String, EntryError> {
    let input: DocInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let doc = &input.doc;
    let info = TemplateInfo {
        ratio_target: doc.ratio.as_deref().map(str::trim).filter(|r| !r.is_empty()).map(str::to_owned),
        ratio_locked: tpl::ratio_locked(doc),
        subs_bottom: tpl::subs_bottom(doc, 0.0),
        problem: tpl::validate(doc).err().map(|error| error.to_string()),
    };
    Ok(serde_json::to_string(&info).expect("派生量总能序列化"))
}

#[derive(Deserialize)]
struct RatiosInput {
    left: Option<String>,
    right: Option<String>,
}

/// 两个画幅是否同一档（`null` 与 `original` 同义，`W:H` 按比值比）。
pub fn template_ratio_equivalent(input: &[u8]) -> Result<String, EntryError> {
    let input: RatiosInput = serde_json::from_slice(input).map_err(invalid_input)?;
    Ok(tpl_bool(timeline::protocol::template::ratio_equivalent(
        input.left.as_deref(),
        input.right.as_deref(),
    )))
}

fn tpl_bool(value: bool) -> String {
    serde_json::to_string(&value).expect("布尔总能序列化")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoxInput {
    /// `clamp`：只夹；`drag`：整体平移；`resize`：按把手拉一条边或一个角。
    op: String,
    #[serde(rename = "box")]
    rect: LayerBox,
    #[serde(default)]
    dx: f64,
    #[serde(default)]
    dy: f64,
    /// `resize` 的把手：`n` `s` `e` `w` `ne` `nw` `se` `sw`。
    #[serde(default)]
    handle: Option<String>,
    /// 画面框的像素尺寸（把像素位移折成百分比）。
    #[serde(default)]
    frame: Option<FrameInput>,
}

#[derive(Deserialize)]
struct FrameInput {
    width: f64,
    height: f64,
}

/// 版面编辑器的框：夹进画面、拖动、八把手拉伸，结果一位小数、不小于最小尺寸。
pub fn template_box(input: &[u8]) -> Result<String, EntryError> {
    let input: BoxInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let frame = input
        .frame
        .map(|f| Frame { w: f.width, h: f.height })
        .unwrap_or(Frame { w: 100.0, h: 100.0 });
    let out = match input.op.as_str() {
        "clamp" => tpl::clamp_box(input.rect),
        "drag" => tpl::drag_box(input.rect, input.dx, input.dy, frame),
        "resize" => {
            let handle = input
                .handle
                .as_deref()
                .and_then(Handle::parse)
                .ok_or_else(|| invalid_template("拉伸要给把手（n s e w ne nw se sw）".into()))?;
            tpl::resize_box_from(input.rect, handle, input.dx, input.dy, frame)
        }
        other => return Err(invalid_template(format!("不认识的框操作：{other}"))),
    };
    Ok(serde_json::to_string(&out).expect("框总能序列化"))
}

#[derive(Deserialize)]
struct HitInput {
    doc: TemplateDoc,
    x: f64,
    y: f64,
}

/// 命中（画面百分比坐标）：自顶向下，跳过关掉的层；没命中为 null。
pub fn template_hit(input: &[u8]) -> Result<String, EntryError> {
    let input: HitInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let id = tpl::hit_test(&input.doc, input.x, input.y).map(|layer| layer.id.clone());
    Ok(serde_json::to_string(&id).expect("id 总能序列化"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn call(f: fn(&[u8]) -> Result<String, EntryError>, input: Value) -> Value {
        serde_json::from_str(&f(input.to_string().as_bytes()).unwrap()).unwrap()
    }

    #[test]
    fn catalog_groups_builtins_and_brand_last() {
        let brand = tpl::instance(&tpl::builtins()[0]);
        let groups = call(template_catalog, json!({"lang": "en", "brand": [brand]}));
        let groups = groups.as_array().unwrap();
        let count: usize = groups.iter().map(|g| g["items"].as_array().unwrap().len()).sum();
        assert_eq!(count, 18);
        let last = groups.last().unwrap();
        assert_eq!(last["key"], "brand");
        assert_eq!(last["items"][0]["brand"], true);
        assert_eq!(groups[0]["key"], "chapters");
        // 别的界面语言回落到英文
        let ko = call(template_catalog, json!({"lang": "ko"}));
        let en = call(template_catalog, json!({"lang": "en"}));
        assert_eq!(ko, en);
        let zh = call(template_catalog, json!({"lang": "zh-Hans"}));
        assert_ne!(zh[0]["label"], en[0]["label"]);
    }

    #[test]
    fn new_layer_takes_the_smallest_free_id() {
        let layer = call(template_new_layer, json!({"kind": "logo", "lang": "en", "taken": ["l-logo-1"]}));
        assert_eq!(layer["id"], "l-logo-2");
        assert_eq!(layer["kind"], "logo");
        assert!(template_new_layer(json!({"kind": "nope", "lang": "en"}).to_string().as_bytes()).is_err());
    }

    #[test]
    fn instance_and_definition_round_trip() {
        let def = serde_json::to_value(&tpl::builtins()[3]).unwrap();
        let inst = call(template_instance, json!({"doc": def}));
        assert_eq!(inst["from"], def["id"]);
        assert!(inst.get("builtin").is_none());
        let saved = call(template_definition, json!({"doc": inst, "name": "Mine", "id": "brand_1"}));
        assert_eq!(saved["id"], "brand_1");
        assert_eq!(saved["name"], "Mine");
        assert!(saved.get("from").is_none());
    }

    #[test]
    fn info_reports_ratio_lock_and_subtitle_lift() {
        let talk = serde_json::to_value(tpl::builtin("tpl-talk-top").unwrap()).unwrap();
        let info = call(template_info, json!({"doc": talk}));
        assert_eq!(info["ratioTarget"], "16:9");
        assert_eq!(info["ratioLocked"], true);
        assert_eq!(info["subsBottom"], 4.0);
        assert!(info.get("problem").is_none());
        assert_eq!(
            call(template_ratio_equivalent, json!({"left": "16:9", "right": "32:18"})),
            json!(true)
        );
        assert_eq!(
            call(template_ratio_equivalent, json!({"left": null, "right": "original"})),
            json!(true)
        );
    }

    #[test]
    fn box_geometry_and_hit() {
        let moved = call(
            template_box,
            json!({"op": "drag", "box": {"x": 90, "y": 0, "w": 20, "h": 10}, "dx": 100, "dy": 0, "frame": {"width": 1000, "height": 500}}),
        );
        assert_eq!(moved["x"], 80.0);
        let grown = call(
            template_box,
            json!({"op": "resize", "handle": "se", "box": {"x": 0, "y": 0, "w": 10, "h": 10}, "dx": 100, "dy": 50, "frame": {"width": 1000, "height": 500}}),
        );
        assert_eq!(grown["w"], 20.0);
        assert_eq!(grown["h"], 20.0);
        let doc = serde_json::to_value(tpl::builtin("tpl-chapter-bar").unwrap()).unwrap();
        assert_eq!(call(template_hit, json!({"doc": doc, "x": 50, "y": 95})), json!("l-ch"));
        assert_eq!(call(template_hit, json!({"doc": doc, "x": 50, "y": 50})), Value::Null);
    }
}

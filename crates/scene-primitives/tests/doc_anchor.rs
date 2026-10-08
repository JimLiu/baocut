//! `@doc` 保留锚点（§3.3）：整篇文档窗口求值 + `scene-id-reserved` lint。

use scene_primitives::Resolver;
use scene_primitives::lint::{Severity, lint};
use serde_json::{Value, json};

/// 两个场景共 10s 的最小文档
fn doc() -> Value {
    json!({
        "meta": { "id": "d", "width": 1920, "height": 1080, "fps": 30 },
        "scenes": [
            { "id": "a", "dur": 4, "desc": "前段" },
            { "id": "b", "dur": 6, "desc": "后段" }
        ],
        "tracks": []
    })
}

fn resolved(doc: Value) -> Resolver {
    let mut r = Resolver::new(doc, None).unwrap();
    r.resolve().unwrap();
    r
}

fn at(r: &Resolver, expr: &str) -> f64 {
    r.eval_t(&json!(expr)).unwrap().unwrap()
}

#[test]
fn doc_anchor_spans_the_whole_document() {
    let r = resolved(doc());
    assert_eq!(at(&r, "@doc"), 0.0);
    assert_eq!(at(&r, "@doc.start"), 0.0);
    assert_eq!(at(&r, "@doc.end"), 10.0);
    assert_eq!(at(&r, "@doc.40%"), 4.0);
    assert_eq!(at(&r, "@doc+1.5"), 1.5);
    assert_eq!(at(&r, "@doc.end-0.5"), 9.5);
}

#[test]
fn doc_anchor_stretches_with_reflow() {
    let mut d = doc();
    d["scenes"][1]["dur"] = json!(16); // 总长 4 + 16 = 20
    let r = resolved(d);
    assert_eq!(at(&r, "@doc.end"), 20.0);
    assert_eq!(at(&r, "@doc.50%"), 10.0);
}

#[test]
fn doc_anchor_drives_clip_windows() {
    let mut d = doc();
    d["tracks"] = json!([{
        "id": "main", "kind": "visual", "clips": [
            { "id": "full", "start": "@doc", "end": "@doc.end",
              "element": { "type": "text", "id": "t", "text": "hi" } }
        ]
    }]);
    let ir = {
        let mut r = Resolver::new(d, None).unwrap();
        r.resolve().unwrap()
    };
    let clip = &ir.visual_clips[0];
    assert_eq!((clip.start, clip.end), (0.0, 10.0));
}

#[test]
fn scene_id_doc_is_reserved() {
    let mut d = doc();
    d["scenes"][0]["id"] = json!("doc");
    let diags = lint(&d);
    let hit: Vec<_> = diags
        .iter()
        .filter(|x| x.rule == "scene-id-reserved")
        .collect();
    assert_eq!(hit.len(), 1, "{diags:?}");
    assert_eq!(hit[0].severity, Severity::Error);
    assert_eq!(hit[0].pointer, "/scenes/0/id");

    // 正常场景 id 不触发
    assert!(!lint(&doc()).iter().any(|x| x.rule == "scene-id-reserved"));
}

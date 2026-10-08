//! 对 tests/fixtures/launch-golden/launch.bcut.json（golden 参考文档）的
//! resolve/sample 数值验收。期望值与该 golden 的历史参考实现语义一致。

use scene_primitives::RNode;
use scene_primitives::json::JsonExt;
use scene_primitives::lint::{Severity, lint};
use scene_primitives::resolve::Resolver;
use scene_primitives::sample::sample_frames;
use serde_json::Value;

fn golden_doc() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/launch-golden/launch.bcut.json"
    );
    let data = std::fs::read_to_string(path).expect("读取 golden JSON");
    serde_json::from_str(&data).unwrap()
}

fn find<'a>(node: &'a RNode, id: &str) -> Option<&'a RNode> {
    if node.id == id {
        return Some(node);
    }
    node.children.iter().find_map(|c| find(c, id))
}

#[test]
fn golden_resolve_shapes() {
    let mut r = Resolver::new(golden_doc(), None).unwrap();
    let ir = r.resolve().unwrap();

    assert_eq!(ir.total, 20.0);
    assert_eq!(ir.fps, 30.0);
    assert_eq!((ir.w, ir.h), (1920.0, 1080.0));
    // bg = $theme.color.bg = #0b0b0e
    assert_eq!((ir.bg.r, ir.bg.g, ir.bg.b), (11.0, 11.0, 14.0));
    // theme.color.accent = $vars.accent = #e8906a（theme 可引用 vars）
    let accent = r
        .ctx
        .theme
        .get_("color")
        .and_then(|c| c.gstr("accent"))
        .unwrap();
    assert_eq!(accent, "#e8906a");

    assert_eq!(ir.visual_clips.len(), 4);
    assert_eq!(ir.camera_clips.len(), 2);
    assert_eq!(ir.caption_clips.len(), 1);

    // clip 窗口 + 转场交叠（crossfade 0.5 / slideLeft 0.6，对称展开）
    let by_id = |id: &str| ir.visual_clips.iter().find(|c| c.id == id).unwrap();
    let opening = by_id("opening-shot");
    assert_eq!((opening.start, opening.end), (0.0, 3.0));
    assert!((opening.render_end - 3.25).abs() < 1e-9);
    let problem = by_id("problem-shot");
    assert_eq!((problem.start, problem.end), (3.0, 8.0)); // #opening-shot.end 链式
    assert!((problem.render_start - 2.75).abs() < 1e-9);
    assert!((problem.render_end - 8.3).abs() < 1e-9);
    let growth = by_id("growth-shot");
    assert!((growth.render_start - 7.7).abs() < 1e-9);
    let outro = by_id("outro-shot");
    assert_eq!((outro.start, outro.end), (16.0, 20.0));
    assert!((outro.render_start - 15.75).abs() < 1e-9);

    // camera：cam-growth 从 @growth+1.2 = 9.2 起
    assert!((ir.camera_clips[0].start - 9.2).abs() < 1e-9);
    assert_eq!(ir.camera_clips[0].end, 16.0);
    // kenBurns preset 展开：zoom 1.06 → 1.0
    let outro_cam = &ir.camera_clips[1];
    let v0 = sample_frames(&outro_cam.frames, 16.0);
    let v1 = sample_frames(&outro_cam.frames, 20.0);
    assert!((v0.gf64("zoom").unwrap() - 1.06).abs() < 1e-9);
    assert!((v1.gf64("zoom").unwrap() - 1.0).abs() < 1e-9);
}

#[test]
fn golden_channels_and_sampling() {
    let mut r = Resolver::new(golden_doc(), None).unwrap();
    let ir = r.resolve().unwrap();
    let by_id = |id: &str| ir.visual_clips.iter().find(|c| c.id == id).unwrap();

    // 跨界滑行：growth-shot/heading 的 x 通道 [@growth-0.4=7.6 → @growth+0.6=8.6]
    let heading = find(&by_id("growth-shot").tree, "heading").unwrap();
    let x_ch = heading.channels.iter().find(|c| c.prop == "x").unwrap();
    assert!((x_ch.frames[0].t - 7.6).abs() < 1e-9);
    assert!((x_ch.frames[1].t - 8.6).abs() < 1e-9);
    let x_mid = sample_frames(&x_ch.frames, 8.1).as_f64().unwrap();
    assert!(
        (x_mid - 30.0).abs() < 1e-9,
        "easeInOutCubic(0.5)=0.5 → 60→30，实得 {x_mid}"
    );

    // emphasis pop @growth.70% = 13.6，dur 0.6，scale 1 → 1.14 → 1
    let callout = find(&by_id("growth-shot").tree, "callout").unwrap();
    let s_ch = callout.channels.iter().find(|c| c.prop == "scale").unwrap();
    assert!((s_ch.frames[0].t - 13.6).abs() < 1e-9);
    assert!((s_ch.frames[1].t - (13.6 + 0.55 * 0.6)).abs() < 1e-9);
    assert_eq!(s_ch.frames[1].v.as_f64().unwrap(), 1.14);

    // stagger：pain-cards 三个 wrapper 的 extra_delay = 0 / 0.22 / 0.44
    let cards = find(&by_id("problem-shot").tree, "pain-cards").unwrap();
    assert_eq!(cards.children.len(), 3);
    for (i, w) in cards.children.iter().enumerate() {
        assert!((w.extra_delay - 0.22 * i as f64).abs() < 1e-9);
        // wrapper enter=rise(delay 0.5, distance 48)：opacity 通道起点 = 3.0 + 0.5 + stagger
        let op = w.channels.iter().find(|c| c.prop == "opacity").unwrap();
        assert!((op.frames[0].t - (3.0 + 0.5 + 0.22 * i as f64)).abs() < 1e-9);
        let y = w.channels.iter().find(|c| c.prop == "y").unwrap();
        assert_eq!(y.frames[0].v.as_f64().unwrap(), 48.0); // params.distance=48 替换 {distance}
    }

    // 组件 $props：countUp to=72/45/89，meta.suffix="%"
    let card0 = &cards.children[0];
    let value_node = find(card0, "value").unwrap();
    let tc = value_node
        .channels
        .iter()
        .find(|c| c.prop == "textCount")
        .unwrap();
    assert_eq!(tc.frames[1].v.as_f64().unwrap(), 72.0);
    assert_eq!(tc.meta.as_ref().unwrap().get("suffix").unwrap(), "%");

    // barFill to=$props.ratio：三根柱 0.14 / 0.43 / 1.0，锚定 clip 起点 8.0
    let bars = find(&by_id("growth-shot").tree, "bars").unwrap();
    let ratios = [0.14, 0.43, 1.0];
    for (i, w) in bars.children.iter().enumerate() {
        let bar = find(w, "bar").unwrap();
        let sy = bar.channels.iter().find(|c| c.prop == "scaleY").unwrap();
        assert!((sy.frames[0].t - 8.0).abs() < 1e-9);
        assert_eq!(sy.frames[1].v.as_f64().unwrap(), ratios[i]);
    }

    // 转场 wrap 通道：problem-shot 入场 crossfade + 离场 slideLeft
    let problem = by_id("problem-shot");
    assert_eq!(problem.wrap_channels.len(), 2);
    let fade_in = &problem.wrap_channels[0];
    assert_eq!(fade_in.prop, "opacity");
    let a = sample_frames(&fade_in.frames, 3.0).as_f64().unwrap();
    assert!((a - 0.5).abs() < 1e-9, "剪辑点处 crossfade 半程，实得 {a}");
    let slide_out = &problem.wrap_channels[1];
    assert_eq!(slide_out.prop, "x");
    assert_eq!(
        sample_frames(&slide_out.frames, 8.3).as_f64().unwrap(),
        -1920.0
    );
}

#[test]
fn golden_captions() {
    let mut r = Resolver::new(golden_doc(), None).unwrap();
    let ir = r.resolve().unwrap();
    let cap = &ir.caption_clips[0];

    assert_eq!(cap.lanes.len(), 2);
    assert_eq!((cap.start, cap.end), (0.0, 20.0));
    assert!((cap.offset - 0.07).abs() < 1e-9);
    assert_eq!(cap.gap, 12.0);
    assert!((cap.fade - 0.18).abs() < 1e-9);

    let zh = &cap.lanes[0];
    assert_eq!(zh.id, "zh");
    assert_eq!(zh.font_size, 34.0);
    assert_eq!(zh.font_weight, 600);
    assert_eq!(zh.bg_mode.as_deref(), Some("text"));
    assert!((zh.bg_color.a - 0.55).abs() < 1e-9);
    let hi = zh.hi_color.unwrap();
    assert_eq!((hi.r, hi.g, hi.b), (232.0, 144.0, 106.0)); // $theme.color.accent

    let en = &cap.lanes[1];
    assert_eq!(en.id, "en");
    assert!(en.hi_color.is_none());
    assert!((en.enter_dur - 0.25).abs() < 1e-9); // rise 入场

    // 字幕项时间：until 缺省 = 下一条 at；末条 = clip end
    assert_eq!(cap.items.len(), 4);
    assert!((cap.items[0].at_abs - 0.6).abs() < 1e-9);
    assert!((cap.items[0].until_abs - 3.4).abs() < 1e-9);
    assert!((cap.items[1].until_abs - 7.4).abs() < 1e-9); // @problem.end-0.6
    assert!((cap.items[2].at_abs - 9.4).abs() < 1e-9);
    assert!((cap.items[2].until_abs - 13.4).abs() < 1e-9); // @growth+5.4
    assert!((cap.items[3].until_abs - 20.0).abs() < 1e-9);

    // 词级时间：末词 end = 本条 span
    let zh_line = cap.items[2].lines.get("zh").unwrap();
    let words = zh_line.words.as_ref().unwrap();
    assert_eq!(words.len(), 5);
    assert!((words[0].end - 0.45).abs() < 1e-9);
    assert!((words[4].end - 4.0).abs() < 1e-9);
    // en lane 无词戳 → 整句降级
    assert!(cap.items[2].lines.get("en").unwrap().words.is_none());
}

#[test]
fn golden_lint_clean() {
    let doc = golden_doc();
    let diags = lint(&doc);
    let errors: Vec<_> = diags
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .collect();
    assert!(
        errors.is_empty(),
        "golden 文档不应有 lint error：{errors:#?}"
    );
}

#[test]
fn reflow_semantics() {
    // 把 growth 场景 8s → 12s：@growth.55% 等比伸缩，@growth+1.2 保持偏移，#clip.end 链式跟随
    let mut doc = golden_doc();
    doc["scenes"][2]["dur"] = serde_json::json!(12);
    let mut r = Resolver::new(doc, None).unwrap();
    let ir = r.resolve().unwrap();
    assert_eq!(ir.total, 24.0);

    let growth = ir
        .visual_clips
        .iter()
        .find(|c| c.id == "growth-shot")
        .unwrap();
    assert_eq!((growth.start, growth.end), (8.0, 20.0));
    let outro = ir
        .visual_clips
        .iter()
        .find(|c| c.id == "outro-shot")
        .unwrap();
    assert_eq!((outro.start, outro.end), (20.0, 24.0));

    // camera 起点 @growth+1.2 → 9.2（绝对偏移不伸缩）
    assert!((ir.camera_clips[0].start - 9.2).abs() < 1e-9);

    // emphasis @growth.70% → 8 + 12*0.7 = 16.4（百分比随场景伸缩）
    fn find<'a>(node: &'a RNode, id: &str) -> Option<&'a RNode> {
        if node.id == id {
            return Some(node);
        }
        node.children.iter().find_map(|c| find(c, id))
    }
    let callout = find(&growth.tree, "callout").unwrap();
    let s_ch = callout.channels.iter().find(|c| c.prop == "scale").unwrap();
    assert!((s_ch.frames[0].t - 16.4).abs() < 1e-9);
}

#[test]
fn lint_catches_errors() {
    // 未知场景引用
    let mut doc = golden_doc();
    doc["tracks"][0]["clips"][0]["start"] = serde_json::json!("@nonexistent");
    let diags = lint(&doc);
    assert!(diags.iter().any(|d| d.rule == "time-ref-unknown"));

    // 不可动画属性
    let mut doc = golden_doc();
    doc["presets"]["rise"]["keyframes"][0]["prop"] = serde_json::json!("width");
    let diags = lint(&doc);
    assert!(
        diags
            .iter()
            .any(|d| d.rule == "schema" && d.message.contains("width"))
    );

    // 词拼接不一致
    let mut doc = golden_doc();
    doc["tracks"][2]["clips"][0]["captions"][2]["lines"]["zh"]["words"][0]["text"] =
        serde_json::json!("91");
    let diags = lint(&doc);
    assert!(diags.iter().any(|d| d.rule == "caption-words-mismatch"));
}

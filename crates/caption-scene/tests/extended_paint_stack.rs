use caption_scene::*;
use serde_json::{Value, json};

fn layer(id: impl AsRef<str>) -> Value {
    json!({"id":id.as_ref(),"paint":{"kind":"solid","color":"#FFFFFFFF"}})
}

fn layers(count: usize) -> Vec<Value> {
    (0..count).map(|index| layer(format!("p{index}"))).collect()
}

fn fixture(extended: bool) -> Value {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let scene = &mut body["scene"]["value"];
    scene["animations"] = json!([]);
    scene["requiredCapabilities"] = json!(["caption-scene/1", "caption-paint-stack/1", "caption-paint-style-bindings/1"]);
    if extended {
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!(EXTENDED_PAINT_STACK_CAPABILITY));
    }
    scene["nodes"][0]["style"]["paints"] = json!(layers(1));
    scene["paintStyleBindings"] = json!([]);
    body
}

fn scene(body: &mut Value) -> &mut Value {
    &mut body["scene"]["value"]
}

fn binding(id: &str, paints: Vec<Value>) -> Value {
    json!({"id":id,"nodeId":"caption","selectorId":"words","style":{"paints":paints}})
}

fn inactive(body: &mut Value) {
    scene(body)["selectors"][0]["filter"] = json!({"kind":"range","start":0,"end":0});
}

fn unvalidated(body: &Value) -> Scene {
    serde_json::from_value(body["scene"]["value"].clone()).unwrap()
}

fn many_nodes(body: &mut Value, count: usize, per_stack: usize) {
    scene(body)["nodes"] = json!(
        (0..count)
            .map(|index| json!({
                "id":if index == 0 { "caption".to_owned() } else { format!("paint-node-{index}") },
                "type":"text",
                "style":{"paints":layers(per_stack)}
            }))
            .collect::<Vec<_>>()
    );
}

#[test]
fn extended_layers_require_the_explicit_capability_and_keep_the_old_sixteen_limit() {
    assert_eq!(EXTENDED_PAINT_STACK_CAPABILITY, "caption-paint-stack-extended/1");
    assert_eq!(MAX_EXTENDED_PAINT_DECLARATIONS, 4096);
    for count in [17, 64] {
        let mut body = fixture(true);
        scene(&mut body)["nodes"][0]["style"]["paints"] = json!(layers(count));
        let parsed = parse_style(&body).unwrap();
        assert_eq!(paint_stack_limit(parsed.scene()), 64);
        assert_eq!(paint_style_order(parsed.scene(), "caption").unwrap().len(), count);
        assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
    }
    let mut legacy = fixture(false);
    scene(&mut legacy)["nodes"][0]["style"]["paints"] = json!(layers(16));
    assert_eq!(paint_stack_limit(parse_style(&legacy).unwrap().scene()), 16);
    scene(&mut legacy)["nodes"][0]["style"]["paints"] = json!(layers(17));
    assert!(parse_style(&legacy).is_err());
    assert!(paint_style_order(&unvalidated(&legacy), "caption").is_err());
}

#[test]
fn sixty_five_base_or_inactive_replacement_layers_are_rejected() {
    let mut body = fixture(true);
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!(layers(65));
    assert!(parse_style(&body).is_err());
    assert!(paint_style_order(&unvalidated(&body), "caption").is_err());
    let mut body = fixture(true);
    inactive(&mut body);
    scene(&mut body)["paintStyleBindings"] = json!([binding("unused", layers(65))]);
    assert!(parse_style(&body).is_err());
    assert!(paint_style_order(&unvalidated(&body), "caption").is_err());
}

#[test]
fn replacement_stacks_accept_seventeen_and_sixty_four_only_with_opt_in() {
    for count in [17, 64] {
        for extended in [false, true] {
            let mut body = fixture(extended);
            inactive(&mut body);
            scene(&mut body)["paintStyleBindings"] = json!([binding("unused", layers(count))]);
            assert_eq!(parse_style(&body).is_ok(), extended);
            assert_eq!(paint_style_order(&unvalidated(&body), "caption").is_ok(), extended);
        }
    }
}

#[test]
fn union_limits_apply_to_inactive_stacks_even_when_each_stack_is_small() {
    for extended in [false, true] {
        let mut body = fixture(extended);
        inactive(&mut body);
        scene(&mut body)["nodes"][0]["style"]["paints"] = json!(layers(16));
        scene(&mut body)["paintStyleBindings"] = json!([binding("unused", vec![layer("new-id")])]);
        assert_eq!(parse_style(&body).is_ok(), extended);
        assert_eq!(paint_style_order(&unvalidated(&body), "caption").is_ok(), extended);
    }
    let mut body = fixture(true);
    inactive(&mut body);
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!(layers(64));
    scene(&mut body)["paintStyleBindings"] = json!([binding("unused", vec![layer("sixty-fifth")])]);
    assert!(parse_style(&body).is_err());
    assert!(paint_style_order(&unvalidated(&body), "caption").is_err());
}

#[test]
fn sixty_four_id_order_is_stable_across_disjoint_inactive_small_stacks() {
    let mut body = fixture(true);
    inactive(&mut body);
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!([layer("a"), layer("tail")]);
    let mut bindings = Vec::new();
    let mut expected = vec!["a".to_owned()];
    for (group, count) in [14, 14, 14, 14, 6].into_iter().enumerate() {
        let ids = (0..count).map(|index| format!("group-{group}-{index}")).collect::<Vec<_>>();
        expected.extend(ids.iter().cloned());
        let mut paints = ids.iter().map(layer).collect::<Vec<_>>();
        paints.push(layer("tail"));
        bindings.push(binding(&format!("binding-{group}"), paints));
    }
    expected.push("tail".to_owned());
    assert_eq!(expected.len(), 64);
    scene(&mut body)["paintStyleBindings"] = json!(bindings);
    let parsed = parse_style(&body).unwrap();
    assert_eq!(paint_style_order(parsed.scene(), "caption").unwrap(), expected);
    assert_eq!(paint_style_order(&unvalidated(&body), "caption").unwrap(), expected);
}

#[test]
fn cycle_duplicate_layer_and_duplicate_binding_guards_survive_opt_in() {
    let mut body = fixture(true);
    inactive(&mut body);
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!(layers(17));
    scene(&mut body)["paintStyleBindings"] = json!([binding("unused", vec![layer("p16"), layer("p0")])]);
    assert!(parse_style(&body).unwrap_err().detail.contains("cycle"));
    assert!(
        paint_style_order(&unvalidated(&body), "caption")
            .unwrap_err()
            .detail
            .contains("cycle")
    );
    for replacement in [false, true] {
        let mut body = fixture(true);
        inactive(&mut body);
        if replacement {
            scene(&mut body)["paintStyleBindings"] = json!([binding("unused", vec![layer("same"), layer("same")])]);
        } else {
            scene(&mut body)["nodes"][0]["style"]["paints"] = json!([layer("same"), layer("same")]);
        }
        assert!(parse_style(&body).is_err());
        assert!(paint_style_order(&unvalidated(&body), "caption").is_err());
    }
    let mut body = fixture(true);
    scene(&mut body)["paintStyleBindings"] = json!([binding("duplicate", layers(1)), binding("duplicate", layers(1))]);
    assert!(parse_style(&body).is_err());
}

#[test]
fn extended_mode_preserves_legacy_base_capability_omission_and_binding_count_guard() {
    // The original validator lists the base capability but does not require its
    // declaration for ordinary paints. Opt-in must not narrow that legacy domain.
    for count in [1, 16] {
        let mut accepted = Vec::new();
        for extended in [false, true] {
            let mut body = fixture(extended);
            scene(&mut body)["nodes"][0]["style"]["paints"] = json!(layers(count));
            scene(&mut body)["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .retain(|cap| cap != "caption-paint-stack/1");
            accepted.push(parse_style(&body).is_ok());
        }
        assert_eq!(accepted, [true, true]);
    }
    let mut body = fixture(true);
    scene(&mut body)["paintStyleBindings"] = json!((0..65).map(|i| binding(&format!("binding-{i}"), layers(1))).collect::<Vec<_>>());
    assert!(parse_style(&body).is_err());
    assert!(paint_style_order(&unvalidated(&body), "caption").is_err());
}

#[test]
fn scene_declaration_budget_counts_all_nodes_including_nested_nodes() {
    let mut body = fixture(true);
    many_nodes(&mut body, 64, 64);
    assert!(parse_style(&body).is_ok());
    let last = scene(&mut body)["nodes"].as_array_mut().unwrap().pop().unwrap();
    scene(&mut body)["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"group","type":"group","children":[last]}));
    assert!(parse_style(&body).is_ok());
    scene(&mut body)["nodes"][63]["children"].as_array_mut().unwrap().push(json!({
        "id":"nested-extra","type":"text","style":{"paints":layers(1)}
    }));
    assert!(parse_style(&body).is_err());
}

#[test]
fn inactive_replacement_declarations_consume_the_scene_total_without_new_ids() {
    let mut body = fixture(true);
    inactive(&mut body);
    many_nodes(&mut body, 63, 64);
    scene(&mut body)["paintStyleBindings"] = json!([binding("unused-full", layers(64))]);
    assert!(parse_style(&body).is_ok());
    scene(&mut body)["paintStyleBindings"]
        .as_array_mut()
        .unwrap()
        .push(binding("unused-extra", layers(1)));
    assert!(parse_style(&body).is_err());
}

#[test]
fn declaration_budget_does_not_restrict_the_legacy_domain_without_the_capability() {
    let mut body = fixture(false);
    inactive(&mut body);
    many_nodes(&mut body, 256, 16);
    scene(&mut body)["paintStyleBindings"] = json!((0..64).map(|i| binding(&format!("binding-{i}"), layers(16))).collect::<Vec<_>>());
    assert!(parse_style(&body).is_ok());
    scene(&mut body)["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!(EXTENDED_PAINT_STACK_CAPABILITY));
    assert!(parse_style(&body).is_err());
}

#[test]
fn state_paint_schema_is_not_extended_to_accept_replacement_stacks() {
    let mut body = fixture(true);
    scene(&mut body)["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-effects/1"));
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!([{"id":"fill","paint":{"kind":"node-fill"}}]);
    scene(&mut body)["nodes"][0]["stateStyles"] = json!({"active":{"fill":"#FF0000FF"}});
    assert!(parse_style(&body).is_ok());
    scene(&mut body)["nodes"][0]["stateStyles"]["active"]["paints"] = json!(layers(1));
    assert!(parse_style(&body).is_err());
}

#[test]
fn extended_surface_reservations_are_atomic_and_do_not_refill_operations() {
    let mut budget = Budget::new(9);
    budget.enable_extended_paint_stack();
    budget
        .reserve_extended_paint_surface(16 * 1024 * 1024 - 1, 256 * 1024 * 1024 - 1)
        .unwrap();
    assert_eq!(
        budget.reserve_extended_paint_surface(1, 2).unwrap_err().code,
        "CAPTION_BUDGET_EXCEEDED"
    );
    budget.reserve_extended_paint_surface(1, 1).unwrap();
    budget.enable_extended_paint_stack();
    assert!(budget.reserve_extended_paint_surface(1, 0).is_err());
    assert!(budget.reserve_extended_paint_surface(0, 1).is_err());
    assert_eq!(budget.remaining(), 9);
}

#[test]
fn extended_surface_reservations_share_existing_image_counters_in_both_directions() {
    let mut budget = Budget::default();
    budget.reserve_image_paint_pixels(16 * 1024 * 1024 - 1).unwrap();
    budget.reserve_image_paint_work(256 * 1024 * 1024 - 1).unwrap();
    budget.enable_extended_paint_stack();
    budget.reserve_extended_paint_surface(1, 1).unwrap();
    assert!(budget.reserve_image_paint_pixels(1).is_err());
    assert!(budget.reserve_image_paint_work(1).is_err());
    let mut reverse = Budget::default();
    reverse.enable_extended_paint_stack();
    reverse.reserve_extended_paint_surface(16 * 1024 * 1024, 256 * 1024 * 1024).unwrap();
    assert!(reverse.reserve_image_paint_pixels(1).is_err());
    assert!(reverse.reserve_image_paint_work(1).is_err());
    assert_eq!(
        reverse.reserve_extended_paint_surface(usize::MAX, u64::MAX).unwrap_err().code,
        "CAPTION_BUDGET_EXCEEDED"
    );
}

#[test]
fn legacy_surface_reservations_remain_no_op_and_mask_limit_remains_separate() {
    let mut legacy = Budget::new(1);
    legacy.reserve_extended_paint_surface(usize::MAX, u64::MAX).unwrap();
    legacy.reserve_image_paint_pixels(16 * 1024 * 1024).unwrap();
    legacy.reserve_image_paint_work(256 * 1024 * 1024).unwrap();
    assert_eq!(legacy.remaining(), 1);
    let mut extended = Budget::new(0);
    extended.enable_extended_paint_stack();
    extended.reserve_paint_mask_work(128 * 1024 * 1024).unwrap();
    assert!(extended.reserve_paint_mask_work(1).is_err());
    extended
        .reserve_extended_paint_surface(16 * 1024 * 1024, 256 * 1024 * 1024)
        .unwrap();
    assert!(extended.spend().is_err());
}

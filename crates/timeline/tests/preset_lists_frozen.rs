//! Timeline 0.1 的 preset 枚举是**生产契约**（设计 §10 阶段 2）：阶段 2 新增的
//! canonical family 只对 BCF 开放，不得渗进 `timeline.json` 的两张封闭枚举，
//! 也不得进 Mac / GPUI 的动画面板目录（那由 `exposedTo` 与 `available` 各管一半）。

use motion::preset_registry::{Domain, Surface, ids, manifest, manifest_ids};
use timeline::schema::{
    ENTER_PRESETS, EXIT_LEGACY_PRESETS, EXIT_PRESETS, LOOP_PRESETS, exit_preset_accepted,
};

#[test]
fn timeline_enums_stay_at_fifty_three_forty_nine_and_twenty() {
    // 2026-08-30：+compress/bounce/fall/skid/roll（文字动画目录对齐）。
    // 2026-09-05（第 156 轮）：+slideUp/slideDown/wave/flipboard/dragonfly/
    // billboard；loop +rotate/heartBeat/vogue/dragonfly/billboard/roll。
    // 2026-09-08：+28/+28/+9 元素目录（`el*`，`surface: "element"`）；
    // 文字目录仍是 25/21/11。
    assert_eq!(ENTER_PRESETS.len(), 53);
    assert_eq!(EXIT_PRESETS.len(), 49);
    assert_eq!(LOOP_PRESETS.len(), 20);
    assert_eq!(
        ENTER_PRESETS
            .iter()
            .filter(|id| !id.starts_with("el"))
            .count(),
        25
    );
    assert_eq!(
        EXIT_PRESETS
            .iter()
            .filter(|id| !id.starts_with("el"))
            .count(),
        21
    );
    assert_eq!(
        LOOP_PRESETS
            .iter()
            .filter(|id| !id.starts_with("el"))
            .count(),
        11
    );
}

/// 三张文档闭集与 `bcut-motion` 的三张 timeline 配方表**逐条、按序**相等：
/// 面板目录、文档校验、引擎查表只能有一份真相（第 156 轮，`sink` 保存失败的根因
/// 就是 exit 槽借用入场词表校验）。0.1 兼容名只准读入，不在配方表里。
#[test]
fn timeline_enums_equal_the_recipe_tables_in_order() {
    use motion::preset_registry::timeline_exit;

    assert_eq!(ids(Domain::TimelineEnter), ENTER_PRESETS);
    assert_eq!(ids(Domain::TimelineExit), EXIT_PRESETS);
    assert_eq!(ids(Domain::TimelineLoop), LOOP_PRESETS);
    for id in EXIT_PRESETS {
        assert!(exit_preset_accepted(id));
    }
    for id in EXIT_LEGACY_PRESETS {
        assert!(
            timeline_exit(id).is_none(),
            "{id} 有配方就该进 EXIT_PRESETS"
        );
        assert!(
            ENTER_PRESETS.contains(id),
            "{id} 只可能是借用入场词表时留下的"
        );
        assert!(exit_preset_accepted(id));
    }
    assert!(!exit_preset_accepted("wave"));
}

#[test]
fn no_canonical_family_leaks_into_the_timeline_enums() {
    for id in manifest_ids() {
        assert!(!ENTER_PRESETS.contains(&id), "{id}");
        assert!(!EXIT_PRESETS.contains(&id), "{id}");
        assert!(!LOOP_PRESETS.contains(&id), "{id}");
        let entry = manifest(id).unwrap();
        assert!(
            !entry.exposed_to.contains(&Surface::Timeline),
            "{id} 声明了 timeline 表面"
        );
        assert!(
            !entry.exposed_to.contains(&Surface::MacStage),
            "{id} 声明了 macStage 表面（ADR-M09：Mac catalogue 冻结）"
        );
    }
}

/// BCF 的 alias 表与 Timeline 的三张表是**两个命名空间**：`rise` / `pulse` 在两边
/// 都存在且含义不同，这是设计的（计划 §2.4.3）。守住的是「查表入口不交叉」——
/// Timeline 只走 `timeline_enter/exit/loop`，永远不经过 `canonical_id`。
#[test]
fn timeline_lookups_never_go_through_the_bcf_alias_table() {
    use motion::preset_registry::{canonical_id, timeline_enter, timeline_loop};

    for name in ENTER_PRESETS {
        assert!(timeline_enter(name).is_some(), "{name}");
    }
    assert_eq!(canonical_id("rise"), "motion.moveIn");
    assert_eq!(timeline_enter("rise").unwrap().id, "rise");
    assert_eq!(canonical_id("pulse"), "motion.pulse");
    assert_eq!(timeline_loop("pulse").unwrap().id, "pulse");
}

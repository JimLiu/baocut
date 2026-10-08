//! 编辑操作（命令与协议规范 §4.2）。调用方提交的是经过校验的操作，不是任意的 Patch（§3.5）。
//! 每个操作用稳定的 ID 指明目标；涉及时间的操作带 `sequenceId` 与对齐政策（§6.1）。

use std::collections::{BTreeMap, HashMap};

use editor_semantics::{
    FrameAlignment, GridContext, MediaTime, Rate, Ratio, TimeMap, TimeQuantizationReceipt, TimelineTimeInput, frame_time, frames_at,
    quantize_exact, quantize_frame,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::chapters::{ChapterInput, UpsertChapter, nullable};
use crate::ducking::DuckingInput;
use crate::elements::check_item;
use crate::error::{EngineResult, ErrorBody, Text, kinds, msg};
use crate::ids::new_id;
use crate::import::{PreparedAsset, StorageMode};
use crate::model::*;
use crate::state::{Placed, VideoState, audio_start, item_range};
use crate::store::DocumentBody;
use crate::transitions::TransitionInput;
use timeline::keyframes::Rewindow;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum EditOperation {
    /// 导入一个文件或目录为素材。`storage` 决定 bytes 留在原处（`linked`）还是复制进视频目录（`managed`）；
    /// 不给时文件默认链接，目录（代码包，没有原文件可以指向）默认收进来（视频格式规范 §4.2）。
    /// 目录成为代码包素材。`ref` 供同一事务里后面的操作引用。
    ImportAsset {
        path: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default, rename = "ref")]
        reference: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        storage: Option<StorageMode>,
        /// 导入目录时只收这些文件或子目录（相对路径）。
        #[serde(default)]
        include: Option<Vec<String>>,
        /// 代码包的清单（代码包规范 §2），只对目录有意义。
        #[serde(default)]
        bundle: Option<Value>,
        #[serde(default)]
        provenance: Option<ProvenanceInput>,
    },
    /// 把链接素材的 bytes 收进视频目录（`linked` → `managed`）。素材版本不变。
    CollectAssets {
        asset_ids: Vec<Id>,
    },
    /// 从视频里删掉没有任何引用的素材记录（实例、章节缩略图与文档的来源都不再指向它，见 [`crate::asset_usage`]）。
    /// 还有引用时拒绝。代码包与它烘焙出的预渲染替身成对删除：列出其中一个，另一个也没有引用时一起删掉。
    /// 只删记录，不删 bytes：`blobs/` 里的内容由 GC 按引用图与保留政策回收，撤销能把记录放回来。
    RemoveAssets {
        asset_ids: Vec<Id>,
    },
    /// 链接素材换了位置：核对内容与登记的一致，然后更新定位。素材版本不变。
    RelinkAsset {
        asset_id: Id,
        path: String,
    },
    /// 按精确的字段写入一批实例（格式转换与导入用）。`id` 由引擎分配；时间已经在帧网格与精确时间上，不再量化。
    /// 同一事务里新建的轨道与文档用 `trackRef`、`documentRef`、`styleDocumentRef` 代替对应的 ID。
    InsertItems {
        sequence_id: Id,
        items: Vec<Value>,
    },
    /// 写入一份文档的新版本。不给 `documentId` 时新建文档。正文不进快照（视频格式规范 §4.4）。
    PutDocument {
        #[serde(default)]
        document_id: Option<Id>,
        #[serde(default, rename = "ref")]
        reference: Option<String>,
        kind: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        language: Option<String>,
        #[serde(default)]
        source_asset: Option<AssetTarget>,
        #[serde(default)]
        source_document: Option<DocumentTarget>,
        body: Value,
        #[serde(default)]
        summary: Option<Value>,
        #[serde(default)]
        extensions: BTreeMap<String, Value>,
    },
    /// 把素材放到时间线上。不给 `at` 时接在轨道末尾。
    AddItem {
        #[serde(default)]
        sequence_id: Option<Id>,
        asset: AssetTarget,
        #[serde(default)]
        track_id: Option<Id>,
        #[serde(default)]
        at: Option<TimelineTimeInput>,
        alignment: FrameAlignment,
        #[serde(default)]
        name: Option<String>,
    },
    MoveItem {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        #[serde(default)]
        at: Option<TimelineTimeInput>,
        #[serde(default)]
        offset: Option<TimelineTimeInput>,
        #[serde(default)]
        track_id: Option<Id>,
        alignment: FrameAlignment,
    },
    /// 一组移动在同一笔事务里生效；重叠在全部移动之后检查，所以可以交换两个片段。
    MoveItems {
        #[serde(default)]
        sequence_id: Option<Id>,
        moves: Vec<ItemMove>,
        alignment: FrameAlignment,
    },
    TrimItem {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        edge: Edge,
        at: TimelineTimeInput,
        alignment: FrameAlignment,
    },
    SplitItem {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        at: TimelineTimeInput,
        alignment: FrameAlignment,
    },
    /// 把同一轨道上首尾相接的两个实例合并成一个（拆分的逆，视频格式规范 §3.15）：种类相同；带源时钟的源时间连续、
    /// 速率相同；其余字段一致，或用 `keep`（按 `itemIds` 的先后，`first`、`second`）指明取哪一边。关键帧与音量包络
    /// 能还原成同一串帧时拼回，否则算作不一致。留下时间上靠前的实例（它的 ID、起点与源起点），靠后的删掉。
    JoinItems {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_ids: Vec<Id>,
        #[serde(default)]
        keep: Option<JoinKeep>,
    },
    /// 删除实例只删除引用，不删除素材与 bytes（命令与协议规范 §5）。
    DeleteItems {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_ids: Vec<Id>,
    },
    /// 在声明的轨道上删掉序列的 `[from, to)` 并闭合空隙（波纹删除，视频格式规范 §6.4）。没声明的轨道不动。
    RemoveRange {
        #[serde(default)]
        sequence_id: Option<Id>,
        from: TimelineTimeInput,
        to: TimelineTimeInput,
        track_ids: Vec<Id>,
        alignment: FrameAlignment,
    },
    /// 在源素材的剪口集合里加入剪口（视频格式规范 §6.7），并在同一笔事务里按新的保留区间重排序列上的实例：
    /// 剪口集合的实例所在的轨道上波纹删除，其余实例按 `followPolicy` 移动（§3.16）。区间是源素材时钟上的十进制秒。
    AddCuts {
        #[serde(default)]
        sequence_id: Option<Id>,
        asset_id: Id,
        cuts: Vec<crate::cuts::CutInput>,
    },
    /// 恢复一个剪口：从剪口集合里去掉它，把它删掉的源区间放回接缝处，之后的内容后移（§6.7）。
    RestoreCut {
        #[serde(default)]
        sequence_id: Option<Id>,
        asset_id: Id,
        cut_id: Id,
    },
    /// 按源素材的转写检测口癖与长停顿，把建议写进它的剪辑提案（视频格式规范 §6.2，每个素材至多一份，再提出时整份替换）。
    /// 不改时间线。转写不给时取素材唯一的那份。
    ProposeCuts {
        asset_id: Id,
        #[serde(default)]
        speech_document_id: Option<Id>,
        #[serde(default)]
        detect: crate::proposals::DetectInput,
    },
    /// 接受剪辑提案里的建议：编译成 `addCuts`（`ref` 是建议的 ID），并在同一笔事务里把它们标成 `accepted`（§6.2）。
    AcceptCutSuggestions {
        #[serde(default)]
        sequence_id: Option<Id>,
        proposal_id: Id,
        suggestion_ids: Vec<Id>,
    },
    /// 新增一条轨道，排在最上面。`ref` 供同一事务里后面的 `insertItems` 用 `trackRef` 引用。
    AddTrack {
        #[serde(default)]
        sequence_id: Option<Id>,
        kind: TrackKind,
        #[serde(default)]
        name: Option<String>,
        #[serde(default, rename = "ref")]
        reference: Option<String>,
    },
    /// 删掉一条空轨道。轨道上还有实例、被闪避规则引用或锁定时拒绝；其他轨道的 `order` 不变（与 `addTrack` 对称）。
    DeleteTrack {
        #[serde(default)]
        sequence_id: Option<Id>,
        track_id: Id,
    },
    UpdateTrack {
        #[serde(default)]
        sequence_id: Option<Id>,
        track_id: Id,
        #[serde(default)]
        locked: Option<bool>,
        #[serde(default)]
        visible: Option<bool>,
        #[serde(default)]
        muted: Option<bool>,
        #[serde(default)]
        name: Option<String>,
    },
    /// 调整一个画面实例的叠放次序（画布上的「前移一层 / 后移一层 / 移到最前 / 移到最后」）。叠放次序就是轨道的上下：
    /// 实例与别的实例共用一条轨道时，把它拆到相邻新建的一条轨道上（上面或下面的轨道整体让一格）；它独占一条轨道时，
    /// 轨道整条在同一叠里挪位（画面与字幕轨道是同一叠：相邻两条互换，或挪到最上 / 最下，其余轨道顺次让位）。已经在最前 / 最后时拒绝。
    ArrangeItem {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        direction: ArrangeDirection,
    },
    /// 把一条轨道挪到同一叠里另一条轨道的上面或下面（时间线上拖动行头）。画面与字幕轨道是同一叠，声音轨道另一叠；
    /// 这一叠原有的那组 `order` 值按新次序重新分配，另一叠不动。
    MoveTrack {
        #[serde(default)]
        sequence_id: Option<Id>,
        track_id: Id,
        /// 作为参照的同类轨道。
        target: Id,
        position: TrackPosition,
    },
    /// 改实例的名字、启用、锁定与跟随策略。锁定的实例只能先解锁；空的名字去掉实例自己的名字。`followPolicy` 整个替换
    /// （视频格式规范 §3.16），写法与 `insertItems` 的相同。
    UpdateItem {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        enabled: Option<bool>,
        #[serde(default)]
        locked: Option<bool>,
        #[serde(default)]
        follow_policy: Option<FollowPolicy>,
    },
    /// 改画面实例的几何（视频格式规范 §3.5 `place`）。只改给出的字段；数值给 `null` 去掉，回到按种类的缺省。
    SetTransform {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        x: Option<Option<f64>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        y: Option<Option<f64>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        w: Option<Option<f64>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        scale: Option<Option<f64>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        scale_y: Option<Option<f64>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        rot: Option<Option<f64>>,
        #[serde(default)]
        flip_x: Option<bool>,
        #[serde(default)]
        flip_y: Option<bool>,
    },
    /// 改画面实例的外观（§3.5、§3.6）。只改给出的字段，给 `null` 去掉（回到缺省）。`opacity`、`radius`、`cornerRadii`
    /// 写进 `place`；`mode`、`fit`、`bg`、`mask` 是视觉媒体的；`tile` 用于图片与文字；`style`、`stylePresetId`、
    /// `verticalAlign` 用于文字；`shape` 整个替换图形的参数；`crop` 用于视频与图片。适用范围与取值由 `timeline` 校验。
    SetStyle {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        opacity: Option<Option<f64>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        radius: Option<Option<f64>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        corner_radii: Option<Option<CornerRadii>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        mode: Option<Option<VisualMode>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        fit: Option<Option<Fit>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        bg: Option<Option<Background>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        mask: Option<Option<Mask>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        tile: Option<Option<Tile>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        style: Option<Option<Value>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        style_preset_id: Option<Option<String>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        vertical_align: Option<Option<String>>,
        #[serde(default)]
        shape: Option<ShapeProps>,
        /// 视频与图片的裁剪（§3.5）；`null` 去掉。
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        crop: Option<Option<Crop>>,
    },
    /// 改文字实例的内容：`text` 与 `counter` 给且只给一个，给了的那个替换另一个（§3.6）。
    SetText {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        counter: Option<CounterProps>,
    },
    /// 整个替换生成类元素与图形的种类参数（§3.7：`shape`、`sticker`、`visualizer`、`progress`、`draw`、
    /// `placeholder`、`confetti`、`whiteboard` 里与实例种类相同的那一个）。
    SetProps {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        props: Value,
    },
    /// 整个替换画面实例的元素动画三槽（§3.15）；`null` 去掉。
    SetAnimation {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        animate: Option<Animation>,
    },
    /// 整个替换画面实例一个属性的关键帧（§3.15）；`null` 或空表去掉这条绑定。
    SetKeyframes {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        property: KeyframeProperty,
        keyframes: Option<Vec<Keyframe>>,
    },
    /// 整个替换序列的模板层（§3.17）；`null` 去掉。
    SetTemplate {
        sequence_id: Id,
        template: Option<TemplateLayers>,
    },
    /// 改合成实例的参数，整个替换 `parameterValues`。代码包的参数要先按它公开的 Schema 校验（代码包规范 §3.2），
    /// 引擎还做不到，所以拒绝；`expectedBundleRef` 与 `scope` 也还不支持。
    SetCodeParameters {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        values: Value,
    },
    /// 原地换合成实例的代码包版本与预渲染替身（代码包规范 §3.3）：实例 ID、轨道、起点、几何与不透明度、效果、遮罩、名字、
    /// 开关与锁、跟随、关键帧、声音路由与 lineage 都不变。时间映射回到从 0 开始的线性映射；长度取新替身的长度，
    /// 没有替身时取清单的 `intrinsic`。变短就裁掉，变长撞上同轨后面的实例就拒绝（`TIMELINE_OVERLAP`），不推开别人。
    /// 实例有参数而新包去掉或换了参数 Schema（`parametersSchemaRef`）时，要同时给新的 `parameterValues`。
    ReplaceCodeBundle {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        asset_ref: VersionRef,
        /// 新的预渲染替身；省略或 `null` 是不要替身。
        #[serde(default)]
        prerender: Option<VersionRef>,
        /// 整个替换 `parameterValues`；省略是不改。
        #[serde(default)]
        parameter_values: Option<Value>,
    },
    /// 改声音（§3.9）：音频实例的混音、视频实例的内嵌音频、合成自己的声音。只改给出的字段；
    /// 淡入淡出是实例局部的十进制秒字符串，`"0"` 去掉。
    SetAudioMix {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        #[serde(default)]
        muted: Option<bool>,
        /// 线性倍数，[0, 4]（§3.9）。
        #[serde(default)]
        volume: Option<f64>,
        #[serde(default)]
        fade_in: Option<String>,
        #[serde(default)]
        fade_out: Option<String>,
    },
    /// 恒定速率变速（视频与音频实例）：取用的源区间不变，实例的长度按新速率重算——视频向下取整到帧，音频保持精确。
    /// 变长之后与后面的实例重叠就拒绝，不推开别人。
    SetSpeed {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        rate: Rate,
    },
    /// 字幕实例改用一份字幕样式文档（`caption-style`）；同一事务里新建的文档用 `ref`。
    SetCaptionStyle {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        style_document: DocumentTarget,
    },
    /// 改序列：名字、画布尺寸、画布底色（`#RRGGBB`）。几何按画幅的百分比保存（§3.5），改尺寸时实例跟着画布走，不用改写。
    /// 编辑帧率另有 `changeSequenceFrameRate`（视频格式规范 §2.12），不在这里。
    UpdateSequence {
        sequence_id: Id,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        canvas: Option<CanvasChange>,
        #[serde(default)]
        background: Option<String>,
    },
    /// 设置一个转场（§3.9）：两个首尾相接的同轨实例之间（两个 ID 都给），或一个实例的开头（只给 `rightItemId`）、
    /// 结尾（只给 `leftItemId`）。同一条边上已有的转场被替换。两侧转场 handles 不够时拒绝，不自动缩短；单侧转场可以不给
    /// `duration`（缺省 0.5 秒），生效的长度随实例变短。
    SetTransition {
        sequence_id: Id,
        #[serde(default)]
        left_item_id: Option<Id>,
        #[serde(default)]
        right_item_id: Option<Id>,
        kind: String,
        #[serde(default)]
        params: Option<serde_json::Map<String, Value>>,
        #[serde(default)]
        duration: Option<TimelineTimeInput>,
        #[serde(default)]
        alignment: Option<FrameAlignment>,
        #[serde(default)]
        easing: Option<Easing>,
        #[serde(default)]
        placement: Option<TransitionPlacement>,
        #[serde(default)]
        audio_crossfade: Option<bool>,
    },
    RemoveTransition {
        #[serde(default)]
        sequence_id: Option<Id>,
        transition_id: Id,
    },
    /// 整个替换视觉媒体或合成实例的 `fx`（视频格式规范 §3.8）；`null` 去掉。
    SetEffects {
        #[serde(default)]
        sequence_id: Option<Id>,
        item_id: Id,
        fx: Option<Fx>,
    },
    /// 整个替换序列的章节（§3.13）；其他标记不动。
    SetChapters {
        sequence_id: Id,
        chapters: Vec<ChapterInput>,
        alignment: FrameAlignment,
    },
    /// 新建（不给 `chapterId`）或修改一章；`summary`、`thumbnail` 给 null 去掉。给 `at` 时要写明 `alignment`。
    UpsertChapter {
        sequence_id: Id,
        #[serde(default)]
        chapter_id: Option<Id>,
        #[serde(default)]
        at: Option<TimelineTimeInput>,
        #[serde(default)]
        alignment: Option<FrameAlignment>,
        #[serde(default)]
        title: Option<String>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        summary: Option<Option<String>>,
        #[serde(default, deserialize_with = "nullable", skip_serializing_if = "Option::is_none")]
        thumbnail: Option<Option<AssetTarget>>,
    },
    RemoveChapter {
        #[serde(default)]
        sequence_id: Option<Id>,
        chapter_id: Id,
    },
    /// 新建（不给 `ruleId`）或修改一条闪避规则（§3.9）。`attack`、`release` 是十进制秒字符串。
    SetDucking {
        sequence_id: Id,
        #[serde(default)]
        rule_id: Option<Id>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        enabled: Option<bool>,
        #[serde(default)]
        trigger: Option<DuckingTriggerInput>,
        #[serde(default)]
        target: Option<DuckingGroupInput>,
        /// 压低的 dB，[0, 60]。
        #[serde(default)]
        depth: Option<f64>,
        #[serde(default)]
        attack: Option<String>,
        #[serde(default)]
        release: Option<String>,
    },
    RemoveDucking {
        #[serde(default)]
        sequence_id: Option<Id>,
        rule_id: Id,
    },
    CreateCheckpoint {
        name: String,
        #[serde(default)]
        note: Option<String>,
    },
    RenameVideo {
        name: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AssetTarget {
    Id {
        #[serde(rename = "assetId")]
        asset_id: Id,
    },
    Ref {
        #[serde(rename = "ref")]
        reference: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DocumentTarget {
    Id {
        #[serde(rename = "documentId")]
        document_id: Id,
    },
    Ref {
        #[serde(rename = "ref")]
        reference: String,
    },
}

/// `setDucking` 的触发：有人说话时，或这些轨道与实例发声时。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DuckingTriggerInput {
    Speech,
    Items(DuckingGroupInput),
}

impl DuckingTriggerInput {
    fn resolve(&self, ctx: &EditContext<'_>) -> EngineResult<DuckingTrigger> {
        Ok(match self {
            DuckingTriggerInput::Speech => DuckingTrigger::Speech,
            DuckingTriggerInput::Items(group) => DuckingTrigger::Items(group.resolve(ctx, "trigger")?),
        })
    }
}

/// `setDucking` 的触发组与目标组：已有的轨道与实例，加上同一事务里 `addTrack` 起的 `ref`（`trackRefs`）。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DuckingGroupInput {
    #[serde(default)]
    pub track_ids: Vec<Id>,
    #[serde(default)]
    pub item_ids: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub track_refs: Vec<String>,
}

impl DuckingGroupInput {
    fn resolve(&self, ctx: &EditContext<'_>, field: &str) -> EngineResult<DuckingGroup> {
        let mut track_ids = self.track_ids.clone();
        for reference in &self.track_refs {
            let id = ctx
                .track_refs
                .get(reference)
                .ok_or_else(|| ErrorBody::invalid_operation(msg!(
                    "engine.trackRefMissing",
                    "{field}.trackRefs: this change has no track named {reference}",
                    field,
                    reference
                )))?;
            track_ids.push(id.clone());
        }
        Ok(DuckingGroup {
            track_ids,
            item_ids: self.item_ids.clone(),
        })
    }
}

/// 导入方已知的来源。不给时按「用户导入」记录。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProvenanceInput {
    pub origin: String,
    #[serde(default)]
    pub source: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemMove {
    pub item_id: Id,
    #[serde(default)]
    pub at: Option<TimelineTimeInput>,
    #[serde(default)]
    pub offset: Option<TimelineTimeInput>,
    #[serde(default)]
    pub track_id: Option<Id>,
}

/// `updateSequence` 的画布尺寸（像素）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasChange {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    Start,
    End,
}

/// `arrangeItem` 的方向：往上一层、往下一层、最上、最下。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArrangeDirection {
    Forward,
    Backward,
    Front,
    Back,
}

/// `moveTrack` 放在参照轨道的上面还是下面。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackPosition {
    Above,
    Below,
}

/// 把 JSON 解析成操作。时间输入的错误按时间的错误码报，其余按 `INVALID_OPERATION`。
pub fn parse_operation(index: usize, value: &Value) -> EngineResult<EditOperation> {
    match serde_json::from_value::<EditOperation>(value.clone()) {
        Ok(op) => Ok(op),
        Err(err) => {
            let mut inputs: Vec<&Value> = Vec::new();
            for key in ["at", "offset"] {
                if let Some(v) = value.get(key) {
                    inputs.push(v);
                }
            }
            if let Some(Value::Array(moves)) = value.get("moves") {
                for m in moves {
                    for key in ["at", "offset"] {
                        if let Some(v) = m.get(key) {
                            inputs.push(v);
                        }
                    }
                }
            }
            for input in inputs {
                if serde_json::from_value::<TimelineTimeInput>(input.clone()).is_err() {
                    let unit = input.get("unit").and_then(Value::as_str);
                    let base = if matches!(unit, Some("seconds") | Some("frames")) {
                        ErrorBody::new(
                            "INVALID_TIME_VALUE",
                            msg!("engine.timeInputInvalid", "The time input is invalid"),
                            crate::error::Retryability::Never,
                        )
                        .recovery(msg!(
                            "engine.timeInputInvalidRecovery",
                            "Use a decimal string for seconds and an integer for frames"
                        ))
                    } else {
                        ErrorBody::time_domain_mismatch(msg!(
                            "engine.timeInputDomain",
                            "A time input must be sequence seconds or frames"
                        ))
                    };
                    return Err(base.details(json!({ "operationIndex": index, "input": input })));
                }
            }
            Err(ErrorBody::invalid_operation(msg!(
                "engine.operationInvalid",
                "Operation {number} is invalid: {error}",
                number = index + 1,
                error = err.to_string()
            ))
                .details(json!({ "operationIndex": index, "type": value.get("type") })))
        }
    }
}

/// 一笔事务执行期间积累的结果：量化回执、lineage、导入引用。
pub struct EditContext<'a> {
    pub transaction_id: &'a str,
    pub now: &'a str,
    pub base_revision: String,
    pub prepared: &'a HashMap<usize, PreparedAsset>,
    pub refs: HashMap<String, Id>,
    pub time_resolution: Vec<TimeQuantizationReceipt>,
    pub lineage: BTreeMap<Id, Vec<Id>>,
    /// 导入时复用了已有素材（相同的 bytes）：不新增记录。
    pub reused_assets: Vec<Id>,
    /// 同一事务里新建的文档，供后面的操作用 `ref` 引用。
    pub document_refs: HashMap<String, Id>,
    /// 同一事务里新建的轨道，供后面的 `insertItems` 用 `trackRef` 引用。
    pub track_refs: HashMap<String, Id>,
    /// 这笔事务写入的文档正文，与文档头一起提交。
    pub documents: Vec<DocumentBody>,
    /// 要写新版本的文档在库里存过的最大版本号（含撤销掉的）。撤销后快照里没有那个版本，
    /// 新版本仍要从这里之上编号，不复用已存过正文的号。
    pub document_revision_floor: &'a HashMap<Id, u64>,
    /// 重新链接时在事务之外确认过的新定位（按操作序号）。
    pub relinked: &'a HashMap<usize, FileLocator>,
    pub actor: &'a Actor,
    /// 这笔事务要改的剪口集合在事务开始时的正文（按文档 ID），在事务之外读出。
    pub cut_sets: &'a HashMap<Id, Value>,
    /// 剪辑提案要读的转写与提案在事务开始时的正文（按文档 ID），在事务之外读出。
    pub document_bodies: &'a HashMap<Id, Value>,
    /// 剪口操作写进回执 `impact` 的结果。
    pub cut_impact: crate::cuts::CutImpact,
    /// `replaceCodeBundle` 写进回执 `impact.codeEdits` 的结果。
    pub code_edits: Vec<crate::receipt::CodeEdit>,
    /// `deleteTrack` 删掉的轨道，写进回执 `impact.removedTracks`。
    pub removed_tracks: Vec<Id>,
    /// `removeAssets` 删掉的素材（含成对带走的），写进回执 `impact.removedAssets`。
    pub removed_assets: Vec<Id>,
}

pub fn apply_operation(state: &mut VideoState, index: usize, op: &EditOperation, ctx: &mut EditContext<'_>) -> EngineResult<()> {
    match op {
        EditOperation::ImportAsset {
            name,
            reference,
            bundle,
            provenance,
            ..
        } => import_asset(
            state,
            index,
            name.as_deref(),
            reference.as_deref(),
            bundle.as_ref(),
            provenance.as_ref(),
            ctx,
        ),
        EditOperation::CollectAssets { asset_ids } => collect_assets(state, asset_ids),
        EditOperation::RemoveAssets { asset_ids } => crate::asset_usage::remove_assets(state, asset_ids, ctx),
        EditOperation::RelinkAsset { asset_id, .. } => relink_asset(state, index, asset_id, ctx),
        EditOperation::InsertItems { sequence_id, items } => insert_items(state, sequence_id, items, ctx),
        EditOperation::PutDocument {
            document_id,
            reference,
            kind,
            name,
            language,
            source_asset,
            source_document,
            body,
            summary,
            extensions,
        } => put_document(
            state,
            PutDocumentInput {
                document_id: document_id.as_deref(),
                reference: reference.as_deref(),
                kind,
                name: name.as_deref(),
                language: language.as_deref(),
                source_asset: source_asset.as_ref(),
                source_document: source_document.as_ref(),
                body,
                summary: summary.as_ref(),
                extensions,
            },
            ctx,
        ),
        EditOperation::AddItem {
            sequence_id,
            asset,
            track_id,
            at,
            alignment,
            name,
        } => add_item(
            state,
            sequence_id.as_deref(),
            asset,
            track_id.as_deref(),
            at.as_ref(),
            *alignment,
            name.as_deref(),
            ctx,
        ),
        EditOperation::MoveItem {
            sequence_id,
            item_id,
            at,
            offset,
            track_id,
            alignment,
        } => {
            let mv = ItemMove {
                item_id: item_id.clone(),
                at: at.clone(),
                offset: offset.clone(),
                track_id: track_id.clone(),
            };
            move_item(state, sequence_id.as_deref(), &mv, *alignment, ctx)
        }
        EditOperation::MoveItems {
            sequence_id,
            moves,
            alignment,
        } => {
            if moves.is_empty() {
                return Err(ErrorBody::invalid_operation(msg!("engine.moveItemsEmpty", "moveItems needs at least one entry")));
            }
            for mv in moves {
                move_item(state, sequence_id.as_deref(), mv, *alignment, ctx)?;
            }
            Ok(())
        }
        EditOperation::TrimItem {
            sequence_id,
            item_id,
            edge,
            at,
            alignment,
        } => trim_item(state, sequence_id.as_deref(), item_id, *edge, at, *alignment, ctx),
        EditOperation::SplitItem {
            sequence_id,
            item_id,
            at,
            alignment,
        } => split_item(state, sequence_id.as_deref(), item_id, at, *alignment, ctx).map(|_| ()),
        EditOperation::JoinItems {
            sequence_id,
            item_ids,
            keep,
        } => join_items(state, sequence_id.as_deref(), item_ids, *keep),
        EditOperation::DeleteItems { sequence_id, item_ids } => delete_items(state, sequence_id.as_deref(), item_ids),
        EditOperation::RemoveRange {
            sequence_id,
            from,
            to,
            track_ids,
            alignment,
        } => remove_range(state, sequence_id.as_deref(), from, to, track_ids, *alignment, ctx),
        EditOperation::AddCuts {
            sequence_id,
            asset_id,
            cuts,
        } => crate::cuts::add_cuts(state, sequence_id.as_deref(), asset_id, cuts, ctx),
        EditOperation::RestoreCut {
            sequence_id,
            asset_id,
            cut_id,
        } => crate::cuts::restore_cut(state, sequence_id.as_deref(), asset_id, cut_id, ctx),
        EditOperation::ProposeCuts {
            asset_id,
            speech_document_id,
            detect,
        } => crate::proposals::propose_cuts(state, asset_id, speech_document_id.as_deref(), detect, ctx),
        EditOperation::AcceptCutSuggestions {
            sequence_id,
            proposal_id,
            suggestion_ids,
        } => crate::proposals::accept_cut_suggestions(state, sequence_id.as_deref(), proposal_id, suggestion_ids, ctx),
        EditOperation::AddTrack {
            sequence_id,
            kind,
            name,
            reference,
        } => add_track(state, sequence_id.as_deref(), *kind, name.clone(), reference.as_deref(), ctx),
        EditOperation::DeleteTrack { sequence_id, track_id } => delete_track(state, sequence_id.as_deref(), track_id, ctx),
        EditOperation::UpdateTrack {
            sequence_id,
            track_id,
            locked,
            visible,
            muted,
            name,
        } => update_track(state, sequence_id.as_deref(), track_id, *locked, *visible, *muted, name.clone()),
        EditOperation::ArrangeItem {
            sequence_id,
            item_id,
            direction,
        } => arrange_item(state, sequence_id.as_deref(), item_id, *direction),
        EditOperation::MoveTrack {
            sequence_id,
            track_id,
            target,
            position,
        } => move_track(state, sequence_id.as_deref(), track_id, target, *position),
        EditOperation::UpdateItem {
            sequence_id,
            item_id,
            name,
            enabled,
            locked,
            follow_policy,
        } => update_item(
            state,
            sequence_id.as_deref(),
            item_id,
            ItemUpdate {
                name: name.as_deref(),
                enabled: *enabled,
                locked: *locked,
                follow_policy: follow_policy.as_ref(),
            },
        ),
        EditOperation::SetTransform {
            sequence_id,
            item_id,
            x,
            y,
            w,
            scale,
            scale_y,
            rot,
            flip_x,
            flip_y,
        } => {
            let item = editable_item(state, sequence_id.as_deref(), item_id)?;
            let place = item.place_mut().ok_or_else(|| not_applicable(
                    item_id,
                    msg!("engine.noPictureNoGeometry", "has no picture, so it has no geometry"),
                ))?;
            for (slot, value) in [
                (&mut place.x, x),
                (&mut place.y, y),
                (&mut place.w, w),
                (&mut place.scale, scale),
                (&mut place.scale_y, scale_y),
                (&mut place.rot, rot),
            ] {
                if let Some(v) = value {
                    *slot = *v;
                }
            }
            if let Some(f) = flip_x {
                place.flip_x = *f;
            }
            if let Some(f) = flip_y {
                place.flip_y = *f;
            }
            check_item(state, item_id)
        }
        EditOperation::SetStyle {
            sequence_id,
            item_id,
            opacity,
            radius,
            corner_radii,
            mode,
            fit,
            bg,
            mask,
            tile,
            style,
            style_preset_id,
            vertical_align,
            shape,
            crop,
        } => set_style(
            state,
            sequence_id.as_deref(),
            item_id,
            StyleInput {
                opacity: *opacity,
                radius: *radius,
                corner_radii: *corner_radii,
                mode: *mode,
                fit: *fit,
                bg: *bg,
                mask: mask.clone(),
                tile: tile.clone(),
                style: style.clone(),
                style_preset_id: style_preset_id.clone(),
                vertical_align: vertical_align.clone(),
                shape: shape.clone(),
                crop: *crop,
            },
        ),
        EditOperation::SetTransition {
            sequence_id,
            left_item_id,
            right_item_id,
            kind,
            params,
            duration,
            alignment,
            easing,
            placement,
            audio_crossfade,
        } => crate::transitions::set_transition(
            state,
            TransitionInput {
                sequence_id: Some(sequence_id),
                left_item_id: left_item_id.as_deref(),
                right_item_id: right_item_id.as_deref(),
                kind,
                params: params.as_ref(),
                duration: duration.as_ref(),
                alignment: *alignment,
                easing: *easing,
                placement: *placement,
                audio_crossfade: *audio_crossfade,
            },
            ctx,
        ),
        EditOperation::RemoveTransition {
            sequence_id,
            transition_id,
        } => crate::transitions::remove_transition(state, sequence_id.as_deref(), transition_id),
        EditOperation::SetEffects { sequence_id, item_id, fx } => {
            crate::effects::set_effects(state, sequence_id.as_deref(), item_id, fx.as_ref())
        }
        EditOperation::SetChapters {
            sequence_id,
            chapters,
            alignment,
        } => crate::chapters::set_chapters(state, sequence_id, chapters, *alignment, ctx),
        EditOperation::UpsertChapter {
            sequence_id,
            chapter_id,
            at,
            alignment,
            title,
            summary,
            thumbnail,
        } => crate::chapters::upsert_chapter(
            state,
            UpsertChapter {
                sequence_id,
                chapter_id: chapter_id.as_deref(),
                at: at.as_ref(),
                alignment: *alignment,
                title: title.as_deref(),
                summary: summary.as_ref().map(Option::as_deref),
                thumbnail: thumbnail.as_ref().map(Option::as_ref),
            },
            ctx,
        ),
        EditOperation::RemoveChapter { sequence_id, chapter_id } => {
            crate::chapters::remove_chapter(state, sequence_id.as_deref(), chapter_id)
        }
        EditOperation::SetDucking {
            sequence_id,
            rule_id,
            name,
            enabled,
            trigger,
            target,
            depth,
            attack,
            release,
        } => {
            let trigger = trigger.as_ref().map(|t| t.resolve(ctx)).transpose()?;
            let target = target.as_ref().map(|g| g.resolve(ctx, "target")).transpose()?;
            crate::ducking::set_ducking(
                state,
                DuckingInput {
                    sequence_id,
                    rule_id: rule_id.as_deref(),
                    name: name.as_deref(),
                    enabled: *enabled,
                    trigger: trigger.as_ref(),
                    target: target.as_ref(),
                    depth: *depth,
                    attack: attack.as_deref(),
                    release: release.as_deref(),
                },
            )
        }
        EditOperation::RemoveDucking { sequence_id, rule_id } => crate::ducking::remove_ducking(state, sequence_id.as_deref(), rule_id),
        EditOperation::SetText {
            sequence_id,
            item_id,
            text,
            counter,
        } => {
            if text.is_some() == counter.is_some() {
                return Err(ErrorBody::invalid_operation(msg!(
                    "engine.setTextOneOf",
                    "setText needs exactly one of text and counter"
                )).entities([item_id.clone()]));
            }
            if let Some(text) = text
                && text.chars().count() > MAX_TEXT_CHARS
            {
                return Err(ErrorBody::invalid_operation(msg!(
                    "engine.textTooLong",
                    "Text can have at most {max} characters",
                    max = MAX_TEXT_CHARS
                )).entities([item_id.clone()]));
            }
            match editable_item(state, sequence_id.as_deref(), item_id)? {
                TimelineItem::Text(t) => {
                    t.text = text.clone();
                    t.counter = counter.clone();
                }
                _ => return Err(not_applicable(item_id, msg!("engine.notTextItem", "is not a text clip"))),
            }
            check_item(state, item_id)
        }
        EditOperation::SetProps {
            sequence_id,
            item_id,
            props,
        } => set_props(state, sequence_id.as_deref(), item_id, props),
        EditOperation::SetAnimation {
            sequence_id,
            item_id,
            animate,
        } => {
            let item = editable_item(state, sequence_id.as_deref(), item_id)?;
            let slot = item
                .animate_mut()
                .ok_or_else(|| not_applicable(
                    item_id,
                    msg!("engine.noPictureNoAnimation", "has no picture, so it cannot have element animation"),
                ))?;
            *slot = animate.clone().filter(|a| !a.is_empty());
            check_item(state, item_id)
        }
        EditOperation::SetKeyframes {
            sequence_id,
            item_id,
            property,
            keyframes,
        } => set_keyframes(state, sequence_id.as_deref(), item_id, *property, keyframes.as_deref()),
        EditOperation::SetTemplate { sequence_id, template } => {
            if let Some(t) = template {
                timeline::protocol::template::validate(t).map_err(|m| ErrorBody::invalid_operation(msg!(
                        "engine.templateInvalid",
                        "The template layer is invalid: {error}",
                        error = m.to_string()
                    )))?;
            }
            let sequence = state
                .sequences
                .get_mut(sequence_id)
                .ok_or_else(|| ErrorBody::not_found(kinds::sequence(), sequence_id))?;
            sequence.header.template = template.clone();
            Ok(())
        }
        EditOperation::SetCodeParameters {
            sequence_id,
            item_id,
            values,
        } => {
            check_json_object(item_id, "values", values)?;
            match editable_item(state, sequence_id.as_deref(), item_id)? {
                TimelineItem::Composition(_) => Err(ErrorBody::invalid_operation(msg!(
                    "engine.codeParametersUnsupported",
                    "Code bundle parameters must first be checked against the bundle's published schema (code bundle spec §3.2), which the engine does not support yet; edit the code bundle or hand it to the agent"
                ))
                .entities([item_id.clone()])),
                _ => Err(not_applicable(item_id, msg!("engine.notCompositionItem", "is not a composition clip"))),
            }
        }
        EditOperation::ReplaceCodeBundle {
            sequence_id,
            item_id,
            asset_ref,
            prerender,
            parameter_values,
        } => replace_code_bundle(
            state,
            sequence_id.as_deref(),
            item_id,
            asset_ref,
            prerender.as_ref(),
            parameter_values.as_ref(),
            ctx,
        ),
        EditOperation::SetAudioMix {
            sequence_id,
            item_id,
            muted,
            volume,
            fade_in,
            fade_out,
        } => set_audio_mix(
            state,
            sequence_id.as_deref(),
            item_id,
            *muted,
            *volume,
            fade_in.as_deref(),
            fade_out.as_deref(),
        ),
        EditOperation::SetSpeed {
            sequence_id,
            item_id,
            rate,
        } => set_speed(state, sequence_id.as_deref(), item_id, *rate),
        EditOperation::SetCaptionStyle {
            sequence_id,
            item_id,
            style_document,
        } => {
            let document_id = match style_document {
                DocumentTarget::Id { document_id } => document_id.clone(),
                DocumentTarget::Ref { reference } => ctx
                    .document_refs
                    .get(reference)
                    .cloned()
                    .ok_or_else(|| ErrorBody::invalid_operation(msg!(
                        "engine.documentRefMissing",
                        "There is no document named {reference}",
                        reference
                    )))?,
            };
            let kind = state
                .documents
                .get(&document_id)
                .map(|d| d.kind.clone())
                .ok_or_else(|| ErrorBody::not_found(kinds::document(), &document_id))?;
            if kind != "caption-style" {
                return Err(ErrorBody::invalid_operation(msg!(
                    "engine.notCaptionStyle",
                    "Document {document} is not a caption style (it is {kind})",
                    document = document_id,
                    kind
                )).entities([document_id]));
            }
            match editable_item(state, sequence_id.as_deref(), item_id)? {
                TimelineItem::Caption(c) => {
                    c.style_document_id = Some(document_id);
                    Ok(())
                }
                _ => Err(not_applicable(item_id, msg!("engine.notCaptionItem", "is not a caption clip"))),
            }
        }
        EditOperation::UpdateSequence {
            sequence_id,
            name,
            canvas,
            background,
        } => update_sequence(state, sequence_id, name.as_deref(), canvas.as_ref(), background.as_deref()),
        EditOperation::CreateCheckpoint { name, note } => {
            let name = clean_name(name, kinds::checkpoint())?;
            let id = new_id("ckpt");
            state.checkpoints.insert(
                id.clone(),
                Checkpoint {
                    id,
                    name,
                    video_revision: ctx.base_revision.clone(),
                    created_at: ctx.now.to_string(),
                    origin: CheckpointOrigin {
                        by: match ctx.actor.kind {
                            ActorKind::User => "user".into(),
                            ActorKind::Agent => "task".into(),
                            ActorKind::System => "system".into(),
                        },
                        task_id: None,
                    },
                    note: note.clone(),
                },
            );
            Ok(())
        }
        EditOperation::RenameVideo { name } => {
            state.name = clean_name(name, kinds::video())?;
            Ok(())
        }
    }
}

fn clean_name(name: &str, what: Text) -> EngineResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 200 {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.nameLength",
            "{kind} name must be 1–200 characters",
            kind = what
        )));
    }
    Ok(trimmed.to_string())
}

/// 命令所属的序列。有时间输入的操作必须写明 `sequenceId`（TM04：不猜帧率）。
pub(crate) fn require_sequence<'s>(state: &'s VideoState, sequence_id: Option<&str>) -> EngineResult<(&'s str, Rate, String)> {
    let id = sequence_id.ok_or_else(|| ErrorBody::time_domain_mismatch(msg!(
            "engine.sequenceIdRequired",
            "An operation with time inputs must give sequenceId"
        )))?;
    let (key, seq) = state
        .sequences
        .get_key_value(id)
        .ok_or_else(|| ErrorBody::time_domain_mismatch(msg!(
            "engine.notFound",
            "{kind} {id} does not exist",
            kind = kinds::sequence(),
            id
        )))?;
    Ok((key.as_str(), seq.header.fps, seq.revision.to_string()))
}

pub(crate) fn item_in<'s>(state: &'s VideoState, sequence_id: &str, item_id: &str) -> EngineResult<&'s Placed<TimelineItem>> {
    let placed = state.items.get(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
    if placed.sequence_id != sequence_id {
        return Err(ErrorBody::time_domain_mismatch(msg!(
            "engine.itemNotInSequence",
            "Clip {item} does not belong to sequence {sequence}",
            item = item_id,
            sequence = sequence_id
        )).entities([item_id]));
    }
    Ok(placed)
}

pub(crate) fn ensure_editable(state: &VideoState, item: &TimelineItem) -> EngineResult<()> {
    if item.base().locked {
        return Err(ErrorBody::locked(vec![item.base().id.clone()], msg!("engine.itemLocked", "The clip is locked")));
    }
    ensure_track_editable(state, &item.base().track_id)
}

pub(crate) fn ensure_track_editable(state: &VideoState, track_id: &str) -> EngineResult<()> {
    let track = state.tracks.get(track_id).ok_or_else(|| ErrorBody::not_found(kinds::track(), track_id))?;
    if track.value.locked {
        return Err(ErrorBody::locked(vec![track_id.to_string()], msg!("engine.trackLocked", "The track is locked")));
    }
    Ok(())
}

pub(crate) fn overflow() -> ErrorBody {
    ErrorBody::time(editor_semantics::TimeError::Overflow { field: "time".into() })
}

fn asset_revision<'s>(state: &'s VideoState, asset_ref: &VersionRef) -> EngineResult<&'s AssetRevision> {
    state
        .assets
        .get(&asset_ref.id)
        .and_then(|a| a.revisions.get(&asset_ref.revision))
        .ok_or_else(|| ErrorBody::asset_missing(&asset_ref.id, msg!("engine.assetRecordMissing", "The asset record does not exist")))
}

fn asset_duration(state: &VideoState, asset_ref: &VersionRef) -> EngineResult<Option<Ratio>> {
    asset_revision(state, asset_ref)?
        .duration
        .as_ref()
        .map(|d| d.to_ratio("duration"))
        .transpose()
        .map_err(Into::into)
}

fn import_asset(
    state: &mut VideoState,
    index: usize,
    name: Option<&str>,
    reference: Option<&str>,
    bundle: Option<&Value>,
    provenance: Option<&ProvenanceInput>,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let prepared = ctx
        .prepared
        .get(&index)
        .ok_or_else(|| ErrorBody::invalid_operation(msg!("engine.importNotPrepared", "The imported file is not ready")))?;
    // 相同的 bytes 已在视频里：复用原素材，不新增记录（重新链接到相同的 bytes 不改变版本）。
    let existing = state.assets.values().find(|a| {
        a.revisions
            .get(&a.current_revision)
            .is_some_and(|r| r.content_hash == prepared.content_hash)
    });
    let asset_id = match existing {
        Some(asset) => {
            ctx.reused_assets.push(asset.id.clone());
            asset.id.clone()
        }
        None => {
            let id = new_id("asset");
            let display = match name {
                Some(n) => clean_name(n, kinds::asset())?,
                None => prepared.original_name.clone(),
            };
            let revision = AssetRevision {
                revision: "1".into(),
                content_hash: prepared.content_hash.clone(),
                byte_length: prepared.byte_length,
                media_type: prepared.media_type.clone(),
                storage: prepared.storage.clone(),
                duration: prepared.probe.duration.clone(),
                timebase: prepared.probe.timebase,
                video: prepared.probe.video.clone(),
                audio: prepared.probe.audio.clone(),
                tree: prepared.tree.clone(),
                bundle: bundle.filter(|_| prepared.kind == AssetKind::Bundle).cloned(),
                provenance: Provenance {
                    origin: provenance.map_or_else(|| "user-import".to_string(), |p| p.origin.clone()),
                    imported_from: Some(ImportedFrom {
                        original_name: prepared.original_name.clone(),
                        imported_at: ctx.now.to_string(),
                    }),
                    source: provenance.and_then(|p| p.source.clone()),
                },
            };
            state.assets.insert(
                id.clone(),
                AssetRecord {
                    id: id.clone(),
                    kind: prepared.kind,
                    name: display,
                    current_revision: "1".into(),
                    revisions: BTreeMap::from([("1".to_string(), revision)]),
                },
            );
            id
        }
    };
    if let Some(r) = reference {
        ctx.refs.insert(r.to_string(), asset_id);
    }
    Ok(())
}

/// `addItem` 放进来的视频与图片：铺满画布、整个放进去（`fullscreen` + `contain`，留边按缺省的黑色），
/// 与旧的「布局框铺满画布、contain」一致。几何留空，取 `timeline::geometry` 的缺省。
fn full_canvas_media() -> MediaFields {
    MediaFields {
        mode: Some(VisualMode::Fullscreen),
        fit: Some(Fit::Contain),
        ..MediaFields::default()
    }
}

/// 素材目标解析成素材 ID：直接给的 ID，或同一事务里导入时起的 `ref`。
pub(crate) fn resolve_asset(target: &AssetTarget, ctx: &EditContext<'_>) -> EngineResult<Id> {
    match target {
        AssetTarget::Id { asset_id } => Ok(asset_id.clone()),
        AssetTarget::Ref { reference } => ctx
            .refs
            .get(reference)
            .cloned()
            .ok_or_else(|| ErrorBody::invalid_operation(msg!(
                "engine.importRefMissing",
                "There is no import named {reference}",
                reference
            ))),
    }
}

#[allow(clippy::too_many_arguments)]
fn add_item(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    target: &AssetTarget,
    track_id: Option<&str>,
    at: Option<&TimelineTimeInput>,
    alignment: FrameAlignment,
    name: Option<&str>,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let (sequence_id, fps, seq_revision) = require_sequence(state, sequence_id)?;
    let sequence_id = sequence_id.to_string();
    let asset_id = resolve_asset(target, ctx)?;
    let asset = state.assets.get(&asset_id).ok_or_else(|| ErrorBody::not_found(kinds::asset(), &asset_id))?;
    let asset_ref = VersionRef {
        id: asset.id.clone(),
        revision: asset.current_revision.clone(),
    };
    let kind = match asset.kind {
        AssetKind::Video | AssetKind::Image => TrackKind::Visual,
        AssetKind::Audio => TrackKind::Audio,
        _ => return Err(ErrorBody::invalid_operation(msg!(
            "engine.assetNotPlaceable",
            "This kind of asset cannot be placed on the timeline directly"
        )).entities([asset_id.clone()])),
    };
    let asset_kind = asset.kind;
    let has_video = asset.revisions.get(&asset.current_revision).is_some_and(|r| r.video.is_some());
    let item_name = name.map(str::to_string).or_else(|| Some(asset.name.clone()));

    let track_id = match track_id {
        Some(id) => {
            let track = state
                .tracks
                .get(id)
                .filter(|t| t.sequence_id == sequence_id)
                .ok_or_else(|| ErrorBody::not_found(kinds::track(), id))?;
            if track.value.kind != kind {
                return Err(ErrorBody::invalid_operation(msg!("engine.assetTrackKind", "The asset does not match the kind of track")).entities([id]));
            }
            id.to_string()
        }
        None => state
            .tracks_of(&sequence_id)
            .into_iter()
            .find(|t| t.kind == kind && !t.locked)
            .map(|t| t.id.clone())
            .ok_or_else(|| ErrorBody::locked(
                Vec::new(),
                msg!("engine.noFreeTrack", "No track available: all tracks of this kind are locked"),
            ))?,
    };
    ensure_track_editable(state, &track_id)?;

    // 起点：给了就量化一次；没给就接在轨道末尾。
    let grid = GridContext {
        sequence_id: &sequence_id,
        sequence_revision: &seq_revision,
        fps,
    };
    let track_end = track_end(state, &sequence_id, &track_id, fps)?;
    let id = new_id("item");
    let paint_order = state
        .items
        .values()
        .filter(|i| i.value.base().track_id == track_id)
        .map(|i| i.value.base().paint_order)
        .max()
        .unwrap_or(0)
        + 1;
    let base = ItemBase {
        id: id.clone(),
        track_id: track_id.clone(),
        name: item_name,
        enabled: true,
        locked: false,
        paint_order,
        follow_policy: FollowPolicy::default(),
        lineage: None,
        link_group_id: None,
        role: None,
        ai: None,
        until_sequence_end: false,
        extensions: BTreeMap::new(),
    };

    let item = match kind {
        TrackKind::Visual => {
            let from_frame = match at {
                Some(input) => {
                    let q = editor_semantics::quantize_input(input, &grid, alignment, "at")?;
                    ctx.time_resolution.push(q.receipt);
                    q.frame
                }
                None => frames_at(track_end, fps).ok_or_else(overflow)?.ceil() as i64,
            };
            let duration_frames = if asset_kind == AssetKind::Image || !has_video {
                // 图片默认 5 秒。
                quantize_frame(Ratio::from_int(5).unwrap(), fps, FrameAlignment::NearestFrame, "duration")?
            } else {
                let duration = asset_duration(state, &asset_ref)?.ok_or_else(|| ErrorBody::probe_failed(msg!("engine.videoNoDuration", "The video asset has no duration")))?;
                // 只取完整的帧：量化不能越过素材的终点（命令与协议规范 §6.4）。
                frames_at(duration, fps).ok_or_else(overflow)?.floor() as i64
            };
            if duration_frames <= 0 {
                return Err(ErrorBody::range_collapsed(&asset_id, msg!("engine.assetUnderOneFrame", "The asset is shorter than one frame")));
            }
            let span = FrameSpan {
                from_frame,
                duration_frames,
            };
            if asset_kind == AssetKind::Image {
                TimelineItem::Image(ImageItem {
                    base,
                    span,
                    place: Place::default(),
                    animate: None,
                    media: full_canvas_media(),
                    asset_ref,
                    crop: None,
                    tile: None,
                    source: None,
                    html: None,
                })
            } else {
                TimelineItem::Video(VideoItem {
                    base,
                    span,
                    place: Place::default(),
                    animate: None,
                    media: full_canvas_media(),
                    asset_ref,
                    time_map: TimeMap::Linear {
                        source_in: MediaTime::zero(),
                        rate: Rate::new(1, 1)?,
                    },
                    crop: None,
                    embedded_audio: EmbeddedAudio {
                        enabled: true,
                        volume: 1.0,
                        fade_in: None,
                        fade_out: None,
                        envelope: Vec::new(),
                    },
                })
            }
        }
        TrackKind::Audio => {
            // 音频的开始位置保留子帧精度，不吸附到帧（视频格式规范 §2.10）。
            let start = match at {
                Some(input) => input.resolve(fps, "at", false)?,
                None => track_end,
            };
            let duration = asset_duration(state, &asset_ref)?.ok_or_else(|| ErrorBody::probe_failed(msg!("engine.audioNoDuration", "The audio asset has no duration")))?;
            if duration <= Ratio::ZERO {
                return Err(ErrorBody::range_collapsed(&asset_id, msg!("engine.assetNoLength", "The asset has no length")));
            }
            let (from_frame, subframe_offset) = split_audio_start(start, fps)?;
            TimelineItem::Audio(AudioItem {
                base,
                asset_ref,
                from_frame,
                subframe_offset,
                play_duration: MediaTime::from_ratio(duration, "playDuration")?,
                time_map: TimeMap::Linear {
                    source_in: MediaTime::zero(),
                    rate: Rate::new(1, 1)?,
                },
                mix: AudioMix {
                    volume: 1.0,
                    muted: false,
                    fade_in: None,
                    fade_out: None,
                    envelope: Vec::new(),
                },
            })
        }
        TrackKind::Subtitle => unreachable!(),
    };
    state.items.insert(id, Placed { sequence_id, value: item });
    Ok(())
}

/// 轨道上最后一个实例的精确终点；空轨道为 0。
fn track_end(state: &VideoState, sequence_id: &str, track_id: &str, fps: Rate) -> EngineResult<Ratio> {
    let mut end = Ratio::ZERO;
    for placed in state
        .items
        .values()
        .filter(|i| i.sequence_id == sequence_id && i.value.base().track_id == track_id)
    {
        end = end.max(item_range(&placed.value, fps)?.1);
    }
    Ok(end)
}

/// 精确的音频起点拆成「粗帧 + 余数」，余数落在 [0, 一帧)。
fn split_audio_start(start: Ratio, fps: Rate) -> EngineResult<(i64, MediaTime)> {
    let frame = frames_at(start, fps).ok_or_else(overflow)?.floor();
    let offset = start
        .checked_sub(frame_time(frame, fps).ok_or_else(overflow)?)
        .ok_or_else(overflow)?;
    Ok((frame as i64, MediaTime::from_ratio(offset, "subframeOffset")?))
}

pub(crate) fn move_item(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    mv: &ItemMove,
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let (sequence_id, fps, seq_revision) = require_sequence(state, sequence_id)?;
    let sequence_id = sequence_id.to_string();
    let placed = item_in(state, &sequence_id, &mv.item_id)?;
    ensure_editable(state, &placed.value)?;
    let mut item = placed.value.clone();
    let (start, _) = item_range(&item, fps)?;

    // 绝对位置与相对偏移二选一；相对偏移先求绝对目标，再量化一次（TM07）。
    let (target, requested) = match (&mv.at, &mv.offset) {
        (Some(at), None) => (at.resolve(fps, "at", false)?, at.clone()),
        (None, Some(offset)) => {
            let delta = offset.resolve(fps, "offset", true)?;
            (start.checked_add(delta).ok_or_else(overflow)?, offset.clone())
        }
        _ => return Err(ErrorBody::invalid_operation(msg!("engine.moveNeedsTarget", "A move needs one of at or offset"))),
    };
    if target.is_negative() {
        return Err(ErrorBody::time(editor_semantics::TimeError::Invalid {
            field: "at".into(),
            reason: msg!("engine.moveNegative", "The position after the move cannot be negative"),
        })
        .entities([mv.item_id.clone()]));
    }

    if let Some(track_id) = &mv.track_id {
        let track = state
            .tracks
            .get(track_id)
            .filter(|t| t.sequence_id == sequence_id)
            .ok_or_else(|| ErrorBody::not_found(kinds::track(), track_id))?;
        if track.value.kind != item.track_kind() {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.moveTrackKind",
                "A clip cannot move to a track of another kind"
            )).entities([track_id.clone()]));
        }
        ensure_track_editable(state, track_id)?;
        item.base_mut().track_id = track_id.clone();
    }

    match &mut item {
        TimelineItem::Audio(audio) => {
            let (from_frame, offset) = split_audio_start(target, fps)?;
            audio.from_frame = from_frame;
            audio.subframe_offset = offset;
        }
        other => {
            let grid = GridContext {
                sequence_id: &sequence_id,
                sequence_revision: &seq_revision,
                fps,
            };
            let q = quantize_exact(target, requested, &grid, alignment, "at")?;
            other.span_mut().expect("音频之外的实例都在帧网格上").from_frame = q.frame;
            ctx.time_resolution.push(q.receipt);
        }
    }
    state.items.insert(mv.item_id.clone(), Placed { sequence_id, value: item });
    Ok(())
}

pub(crate) fn trim_item(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    item_id: &str,
    edge: Edge,
    at: &TimelineTimeInput,
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let (sequence_id, fps, seq_revision) = require_sequence(state, sequence_id)?;
    let sequence_id = sequence_id.to_string();
    let placed = item_in(state, &sequence_id, item_id)?;
    ensure_editable(state, &placed.value)?;
    let mut item = placed.value.clone();
    let (old_start, old_end) = item_range(&item, fps)?;
    let grid = GridContext {
        sequence_id: &sequence_id,
        sequence_revision: &seq_revision,
        fps,
    };
    // 合成的源区间只受预渲染替身的长度约束；代码包本身没有时长。
    let timed_asset = match &item {
        TimelineItem::Composition(c) => c.prerender.as_ref(),
        other => other.asset_ref(),
    };
    let source_duration = match timed_asset {
        Some(asset_ref) => asset_duration(state, asset_ref)?,
        None => None,
    };

    match &mut item {
        TimelineItem::Video(VideoItem { span, time_map, .. }) | TimelineItem::Composition(CompositionItem { span, time_map, .. }) => {
            let q = editor_semantics::quantize_input(at, &grid, alignment, "at")?;
            let (new_from, new_end) = match edge {
                Edge::Start => (q.frame, span.end_frame()),
                Edge::End => (span.from_frame, q.frame),
            };
            if new_end <= new_from {
                return Err(ErrorBody::range_collapsed(item_id, msg!("engine.trimToZero", "The clip has no length after trimming")));
            }
            let TimeMap::Linear { source_in, rate } = time_map.clone() else {
                return Err(ErrorBody::invalid_operation(msg!(
                    "engine.trimHoldItem",
                    "A clip with a hold mapping does not support this trim"
                )));
            };
            // 新的 sourceIn 由旧映射在新起点上精确求值（视频格式规范 §2.7）。
            let shift = frame_time((new_from - span.from_frame) as i128, fps).ok_or_else(overflow)?;
            let new_in = source_in
                .to_ratio("sourceIn")?
                .checked_add(shift.checked_mul(rate.ratio()).ok_or_else(overflow)?)
                .ok_or_else(overflow)?;
            let length = frame_time((new_end - new_from) as i128, fps).ok_or_else(overflow)?;
            let new_out = new_in
                .checked_add(length.checked_mul(rate.ratio()).ok_or_else(overflow)?)
                .ok_or_else(overflow)?;
            check_source_range(item_id, new_in, new_out, source_duration)?;
            *span = FrameSpan {
                from_frame: new_from,
                duration_frames: new_end - new_from,
            };
            *time_map = TimeMap::Linear {
                source_in: MediaTime::from_ratio(new_in, "sourceIn")?,
                rate,
            };
            ctx.time_resolution.push(q.receipt);
        }
        TimelineItem::Audio(audio) => {
            let t = at.resolve(fps, "at", false)?;
            let start = audio_start(audio, fps)?;
            let end = start
                .checked_add(audio.play_duration.to_ratio("playDuration")?)
                .ok_or_else(overflow)?;
            let (new_start, new_end) = match edge {
                Edge::Start => (t, end),
                Edge::End => (start, t),
            };
            if new_end <= new_start {
                return Err(ErrorBody::range_collapsed(item_id, msg!("engine.trimToZero", "The clip has no length after trimming")));
            }
            let TimeMap::Linear { source_in, rate } = audio.time_map.clone() else {
                return Err(ErrorBody::invalid_operation(msg!(
                    "engine.trimHoldAudio",
                    "Audio with a hold mapping does not support trimming"
                )));
            };
            let shift = new_start.checked_sub(start).ok_or_else(overflow)?;
            let new_in = source_in
                .to_ratio("sourceIn")?
                .checked_add(shift.checked_mul(rate.ratio()).ok_or_else(overflow)?)
                .ok_or_else(overflow)?;
            let length = new_end.checked_sub(new_start).ok_or_else(overflow)?;
            let new_out = new_in
                .checked_add(length.checked_mul(rate.ratio()).ok_or_else(overflow)?)
                .ok_or_else(overflow)?;
            check_source_range(item_id, new_in, new_out, source_duration)?;
            let (from_frame, offset) = split_audio_start(new_start, fps)?;
            audio.from_frame = from_frame;
            audio.subframe_offset = offset;
            audio.play_duration = MediaTime::from_ratio(length, "playDuration")?;
            audio.time_map = TimeMap::Linear {
                source_in: MediaTime::from_ratio(new_in, "sourceIn")?,
                rate,
            };
        }
        // 其余画面实例与字幕：只改区间。
        other => {
            let span = other.span_mut().expect("除音频外的实例都在帧网格上");
            let q = editor_semantics::quantize_input(at, &grid, alignment, "at")?;
            let (new_from, new_end) = match edge {
                Edge::Start => (q.frame, span.end_frame()),
                Edge::End => (span.from_frame, q.frame),
            };
            if new_end <= new_from {
                return Err(ErrorBody::range_collapsed(item_id, msg!("engine.trimToZero", "The clip has no length after trimming")));
            }
            *span = FrameSpan {
                from_frame: new_from,
                duration_frames: new_end - new_from,
            };
            ctx.time_resolution.push(q.receipt);
        }
    }
    let (new_start, new_end) = item_range(&item, fps)?;
    state.items.insert(item_id.to_string(), Placed { sequence_id, value: item });
    // 关键帧跟着窗口走：localFrame 按内容的位移换算，percent 原样（§3.15）。
    let window = Rewindow::trim(
        seconds_between(old_start, old_end),
        seconds_between(old_start, new_start),
        seconds_between(new_start, new_end),
    );
    crate::item_keyframes::rewindow_item(state, item_id, window, fps)
}

/// `replaceCodeBundle`（代码包规范 §3.3）：只换代码包版本与替身，实例的其余部分原样保留。
fn replace_code_bundle(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    item_id: &str,
    asset_ref: &VersionRef,
    prerender: Option<&VersionRef>,
    parameter_values: Option<&Value>,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    if let Some(values) = parameter_values {
        check_json_object(item_id, "parameterValues", values)?;
    }
    let placed = checked_item(state, sequence_id, item_id)?;
    let TimelineItem::Composition(old) = &placed.value else {
        return Err(not_applicable(item_id, msg!("engine.notCompositionItem", "is not a composition clip")));
    };
    let seq_id = placed.sequence_id.clone();
    let fps = state.sequence(&seq_id)?.header.fps;
    let (old_start, old_end) = item_range(&placed.value, fps)?;
    let old = old.clone();
    let CompositionSource::Bundle { asset_ref: old_ref } = &old.source;
    let old_ref = old_ref.clone();

    // 种类先查：代码包与视频替身（与 `check_item` 同一条规则）。
    let kind_of = |r: &VersionRef| state.assets.get(&r.id).map(|a| a.kind);
    let new_rev = asset_revision(state, asset_ref)?;
    if kind_of(asset_ref) != Some(AssetKind::Bundle) {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.compositionAssetKind",
            "The asset of a composition clip is not a code bundle"
        ))
        .entities([asset_ref.id.clone()]));
    }
    if let Some(r) = prerender {
        asset_revision(state, r)?;
        if kind_of(r) != Some(AssetKind::Video) {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.prerenderAssetKind",
                "The prerendered stand-in of a composition must be a video asset"
            ))
            .entities([r.id.clone()]));
        }
    }

    // 参数闸门：实例有参数、新包去掉或换了参数 Schema，又没给新参数，就拒绝；不默默套用旧值。
    let schema_of = |rev: Option<&AssetRevision>| -> Option<String> {
        rev.and_then(|r| r.bundle.as_ref())
            .and_then(|m| m.get("parametersSchemaRef"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let old_schema = schema_of(asset_revision(state, &old_ref).ok());
    let new_schema = schema_of(Some(new_rev));
    let has_values = old.parameter_values.as_object().is_some_and(|o| !o.is_empty());
    if has_values && parameter_values.is_none() && (new_schema.is_none() || new_schema != old_schema) {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.codeParametersIncompatible",
            "The clip has parameter values, but the new code bundle drops or changes its parameter schema (parametersSchemaRef); give parameterValues for the new bundle"
        ))
        .entities([item_id])
        .details(json!({
            "rule": "parameters-incompatible",
            "previousSchemaRef": old_schema,
            "schemaRef": new_schema,
        })));
    }

    // 新长度：有替身取替身的长度（向下取整到帧，源区间不超出替身）；没有替身取清单的 intrinsic，换算到序列的帧率。
    let frames = match prerender {
        Some(r) => asset_duration(state, r)?.and_then(|d| frames_at(d, fps)).map(Ratio::floor),
        None => intrinsic_frames(new_rev.bundle.as_ref(), fps),
    };
    let frames = match frames {
        Some(f) if f >= 1 => i64::try_from(f).map_err(|_| overflow())?,
        _ => {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.replaceDurationUnknown",
                "Cannot tell the new length: the prerendered stand-in has no duration, or the code bundle manifest has no intrinsic fps and durationFrames"
            ))
            .entities([item_id]));
        }
    };

    let mut next = old.clone();
    next.source = CompositionSource::Bundle {
        asset_ref: asset_ref.clone(),
    };
    next.prerender = prerender.cloned();
    next.span.duration_frames = frames;
    next.time_map = TimeMap::Linear {
        source_in: MediaTime::zero(),
        rate: Rate { num: 1, den: 1 },
    };
    if let Some(values) = parameter_values {
        next.parameter_values = values.clone();
    }
    let item = TimelineItem::Composition(next);
    let (new_start, new_end) = item_range(&item, fps)?;
    let length = new_end.checked_sub(new_start).ok_or_else(overflow)?;
    if let TimelineItem::Composition(c) = &item {
        check_time_map(state, item_id, &c.time_map, length, c.prerender.as_ref())?;
    }

    // 变长撞上同轨的实例：拒绝，提示先挪开或删掉后面的实例（不推开别人）。
    let track_id = item.base().track_id.clone();
    let blocking: Vec<Id> = state
        .items
        .values()
        .filter(|p| p.sequence_id == seq_id && p.value.base().id != item_id && p.value.base().track_id == track_id)
        .filter_map(|p| {
            let (s, e) = item_range(&p.value, fps).ok()?;
            (s < new_end && new_start < e).then(|| p.value.base().id.clone())
        })
        .collect();
    if !blocking.is_empty() {
        let mut ids = vec![item_id.to_string()];
        ids.extend(blocking);
        return Err(ErrorBody::overlap(ids).recovery(msg!(
            "engine.replaceOverlapRecovery",
            "The new version is longer and runs into the next clip on the track; move that clip later (moveItem) or delete it (deleteItems), then replace again"
        )));
    }

    state.items.insert(
        item_id.to_string(),
        Placed {
            sequence_id: seq_id,
            value: item,
        },
    );
    check_item(state, item_id)?;
    // 内容的局部时间仍从 0 开始：关键帧只随窗口变长变短（§3.15）。
    let window = Rewindow::trim(seconds_between(old_start, old_end), 0.0, seconds_between(new_start, new_end));
    crate::item_keyframes::rewindow_item(state, item_id, window, fps)?;
    ctx.code_edits.push(crate::receipt::CodeEdit {
        item_id: item_id.to_string(),
        layer: crate::receipt::CodeEditLayer::Source,
        previous_bundle_ref: old_ref,
        bundle_ref: asset_ref.clone(),
        previous_prerender: old.prerender.clone(),
        prerender: prerender.cloned(),
        old_duration_frames: old.span.duration_frames,
        new_duration_frames: frames,
    });
    Ok(())
}

/// 清单 `intrinsic` 的长度换算到序列帧率（向下取整）；缺字段时为 `None`。
fn intrinsic_frames(manifest: Option<&Value>, fps: Rate) -> Option<i128> {
    let intrinsic = manifest?.get("intrinsic")?;
    let frames = intrinsic.get("durationFrames")?.as_i64()?;
    let rate = intrinsic.get("fps")?;
    let (num, den) = (rate.get("num")?.as_i64()?, rate.get("den")?.as_i64()?);
    if frames <= 0 || num <= 0 || den <= 0 {
        return None;
    }
    let seconds = Ratio::new(frames as i128 * den as i128, num as i128)?;
    frames_at(seconds, fps).map(Ratio::floor)
}

/// `b − a` 的秒数（浮点）：交给 `timeline::keyframes` 的换算用。
pub(crate) fn seconds_between(a: Ratio, b: Ratio) -> f64 {
    b.to_f64() - a.to_f64()
}

/// 源区间必须在素材之内：不默默截断（错误码 `SOURCE_TIME_OUT_OF_RANGE`）。
fn check_source_range(item_id: &str, source_in: Ratio, source_out: Ratio, duration: Option<Ratio>) -> EngineResult<()> {
    let past_end = duration.is_some_and(|d| source_out > d);
    if source_in.is_negative() || past_end {
        let fmt = |r: Ratio| MediaTime::from_ratio(r, "t").ok();
        return Err(ErrorBody::source_out_of_range(
            item_id,
            json!({
                "requestedIn": fmt(source_in),
                "requestedOut": fmt(source_out),
                "available": { "in": MediaTime::zero(), "out": duration.and_then(fmt) },
            }),
        ));
    }
    Ok(())
}

pub(crate) fn split_item(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    item_id: &str,
    at: &TimelineTimeInput,
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<Id> {
    let (sequence_id, fps, seq_revision) = require_sequence(state, sequence_id)?;
    let sequence_id = sequence_id.to_string();
    let placed = item_in(state, &sequence_id, item_id)?;
    ensure_editable(state, &placed.value)?;
    let mut left = placed.value.clone();
    let (start, end) = item_range(&left, fps)?;
    let mut right = left.clone();
    let right_id = new_id("item");
    let grid = GridContext {
        sequence_id: &sequence_id,
        sequence_revision: &seq_revision,
        fps,
    };

    match (&mut left, &mut right) {
        (TimelineItem::Audio(l), TimelineItem::Audio(r)) => {
            // 音频按精确时间拆分，不套用视频的整数帧限制（§2.7）。
            let t = at.resolve(fps, "at", false)?;
            let start = audio_start(l, fps)?;
            let end = start.checked_add(l.play_duration.to_ratio("playDuration")?).ok_or_else(overflow)?;
            if t <= start || t >= end {
                return Err(ErrorBody::range_collapsed(item_id, msg!("engine.splitInside", "The split point must be inside the clip")));
            }
            let source_at = editor_semantics::map_time(&l.time_map, start, t)?;
            if let TimeMap::Linear { rate, .. } = l.time_map.clone() {
                r.time_map = TimeMap::Linear {
                    source_in: MediaTime::from_ratio(source_at, "sourceIn")?,
                    rate,
                };
            }
            let (from_frame, offset) = split_audio_start(t, fps)?;
            r.from_frame = from_frame;
            r.subframe_offset = offset;
            r.play_duration = MediaTime::from_ratio(end.checked_sub(t).ok_or_else(overflow)?, "playDuration")?;
            l.play_duration = MediaTime::from_ratio(t.checked_sub(start).ok_or_else(overflow)?, "playDuration")?;
        }
        (l, r) => {
            // 帧网格上的实例：拆分点量化一次；有 timeMap 的，右片段的 sourceIn 由旧映射在拆分时刻精确求值，
            // 不从格式化的秒重建（§2.7）。
            let span = l.span().expect("音频之外的实例都在帧网格上");
            let q = editor_semantics::quantize_input(at, &grid, alignment, "at")?;
            let split = q.frame - span.from_frame;
            if split <= 0 || split >= span.duration_frames {
                return Err(ErrorBody::range_collapsed(
                    item_id,
                    msg!(
                        "engine.splitInsideFrames",
                        "The split point must be inside the clip, with at least one frame on each side"
                    ),
                ));
            }
            if let Some(map) = l.time_map_mut().map(|m| m.clone()) {
                let split_time = frame_time(q.frame as i128, fps).ok_or_else(overflow)?;
                let start = frame_time(span.from_frame as i128, fps).ok_or_else(overflow)?;
                let source_at = editor_semantics::map_time(&map, start, split_time)?;
                if let (TimeMap::Linear { rate, .. }, Some(right_map)) = (map, r.time_map_mut()) {
                    *right_map = TimeMap::Linear {
                        source_in: MediaTime::from_ratio(source_at, "sourceIn")?,
                        rate,
                    };
                }
            }
            *r.span_mut().expect("同一类型") = FrameSpan {
                from_frame: q.frame,
                duration_frames: span.duration_frames - split,
            };
            l.span_mut().expect("同一类型").duration_frames = split;
            ctx.time_resolution.push(q.receipt);
        }
    }

    let origin = left
        .base()
        .lineage
        .as_ref()
        .map_or_else(|| item_id.to_string(), |l| l.origin_item_id.clone());
    let base = right.base_mut();
    base.id = right_id.clone();
    base.lineage = Some(ItemLineage {
        origin_item_id: origin,
        parent_item_id: Some(item_id.to_string()),
        via_transaction_id: ctx.transaction_id.to_string(),
    });
    ctx.lineage
        .entry(item_id.to_string())
        .or_default()
        .extend([item_id.to_string(), right_id.clone()]);
    state.items.insert(
        item_id.to_string(),
        Placed {
            sequence_id: sequence_id.clone(),
            value: left,
        },
    );
    crate::transitions::follow_split(state, item_id, &right_id);
    crate::ducking::follow_split(state, item_id, &right_id);
    captions_follow_split(state, item_id, &right_id);
    let cut = item_range(&right, fps)?.0;
    state.items.insert(right_id.clone(), Placed { sequence_id, value: right });
    // 两半各自保留落在自己窗口里的关键帧，接缝处各补一帧取样值（§3.15）。
    crate::item_keyframes::split_item(
        state,
        item_id,
        &right_id,
        seconds_between(start, end),
        seconds_between(start, cut),
        fps,
    )?;
    Ok(right_id)
}

/// `joinItems` 在两边字段不一致时取哪一边（按 `itemIds` 的先后）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JoinKeep {
    First,
    Second,
}

/// 合并时不比较的字段：两段本来就该不同的身份与时间，外加名字（只是标签，字段一致时取靠前那件的）。
const JOIN_OWN_KEYS: [&str; 8] = [
    "id",
    "name",
    "lineage",
    "span",
    "fromFrame",
    "subframeOffset",
    "playDuration",
    "timeMap",
];

pub(crate) fn join_items(state: &mut VideoState, sequence_id: Option<&str>, item_ids: &[Id], keep: Option<JoinKeep>) -> EngineResult<()> {
    let [first, second] = item_ids else {
        return Err(ErrorBody::invalid_operation(msg!("engine.joinNeedsTwo", "joinItems needs two clips")));
    };
    if first == second {
        return Err(ErrorBody::invalid_operation(msg!("engine.joinSameItem", "The two clips of joinItems cannot be the same")).entities([first.clone()]));
    }
    // 没有时间输入：不写 sequenceId 时取实例所在的序列。
    let sequence_id = match sequence_id {
        Some(id) => id.to_string(),
        None => state
            .items
            .get(first)
            .ok_or_else(|| ErrorBody::not_found(kinds::item(), first))?
            .sequence_id
            .clone(),
    };
    let (_, fps, _) = require_sequence(state, Some(&sequence_id))?;
    let a = item_in(state, &sequence_id, first)?.value.clone();
    let b = item_in(state, &sequence_id, second)?.value.clone();
    ensure_editable(state, &a)?;
    ensure_editable(state, &b)?;
    let refuse = |reason: Text, details: Value| {
        ErrorBody::invalid_operation(msg!("engine.joinRefused", "Cannot join: {reason}", reason))
            .entities([first.clone(), second.clone()])
            .details(details)
    };
    if a.kind_name() != b.kind_name() {
        return Err(refuse(msg!("engine.joinKind", "the kinds differ"), json!({ "rule": "kind" })));
    }
    if a.base().track_id != b.base().track_id {
        return Err(refuse(msg!("engine.joinTrack", "they are not on the same track"), json!({ "rule": "track" })));
    }
    let (range_a, range_b) = (item_range(&a, fps)?, item_range(&b, fps)?);
    let first_is_earlier = range_a.0 <= range_b.0;
    let ((early, early_range), (late, late_range)) = if first_is_earlier {
        ((&a, range_a), (&b, range_b))
    } else {
        ((&b, range_b), (&a, range_a))
    };
    if late_range.0 != early_range.1 {
        let gap = seconds_between(early_range.1, late_range.0);
        return Err(refuse(msg!("engine.joinNotAdjacent", "they do not touch end to start"), json!({ "rule": "not-adjacent", "gapSeconds": gap })));
    }
    // 带源时钟的：同一速率，靠后那件的源起点 = 靠前那件的源起点 + 长度 × 速率（精确相等）。
    match (early.time_map(), late.time_map()) {
        (None, None) => {}
        (
            Some(TimeMap::Linear { source_in, rate }),
            Some(TimeMap::Linear {
                source_in: late_in,
                rate: late_rate,
            }),
        ) => {
            if rate != late_rate {
                return Err(refuse(msg!("engine.joinRate", "the playback rates differ"), json!({ "rule": "rate" })));
            }
            let length = early_range.1.checked_sub(early_range.0).ok_or_else(overflow)?;
            let expected = source_in
                .to_ratio("sourceIn")?
                .checked_add(length.checked_mul(rate.ratio()).ok_or_else(overflow)?)
                .ok_or_else(overflow)?;
            if late_in.to_ratio("sourceIn")? != expected {
                return Err(refuse(
                    msg!("engine.joinSourceGap", "the source time is not continuous"),
                    json!({ "rule": "source-gap", "expected": MediaTime::from_ratio(expected, "sourceIn")?, "actual": late_in }),
                ));
            }
        }
        (Some(x), Some(y)) if x == y => {}
        _ => return Err(refuse(msg!("engine.joinSourceGap", "the source time is not continuous"), json!({ "rule": "source-gap" }))),
    }

    let (early_id, late_id) = (early.base().id.clone(), late.base().id.clone());
    let early_duration = seconds_between(early_range.0, early_range.1);
    let late_duration = seconds_between(late_range.0, late_range.1);
    let joined = crate::item_keyframes::join_items(state, &early_id, early_duration, &late_id, late_duration, fps)?;
    let attributes = |item: &TimelineItem| -> serde_json::Map<String, Value> {
        let mut value = serde_json::to_value(item).expect("能序列化");
        let object = value.as_object_mut().expect("实例是对象");
        for key in JOIN_OWN_KEYS {
            object.remove(key);
        }
        if joined.is_some() {
            for audio in ["mix", "embeddedAudio", "audio"] {
                if let Some(Value::Object(fields)) = object.get_mut(audio) {
                    fields.remove("envelope");
                }
            }
        }
        std::mem::take(object)
    };
    let (early_attrs, late_attrs) = (attributes(early), attributes(late));
    let mut keys: Vec<String> = early_attrs
        .keys()
        .chain(late_attrs.keys())
        .filter(|k| early_attrs.get(*k) != late_attrs.get(*k))
        .cloned()
        .collect();
    if joined.is_none() {
        keys.push("keyframes".into());
    }
    keys.sort();
    keys.dedup();
    let base = match keep {
        _ if keys.is_empty() => early,
        Some(JoinKeep::First) => &a,
        Some(JoinKeep::Second) => &b,
        None => {
            return Err(refuse(
                msg!("engine.joinAttributes", "the other fields differ; use keep to pick a side"),
                json!({ "rule": "attributes", "keys": keys }),
            ));
        }
    };
    let base_id = base.base().id.clone();
    let mut merged = base.clone();
    match (&mut merged, early) {
        (TimelineItem::Audio(m), TimelineItem::Audio(e)) => {
            m.from_frame = e.from_frame;
            m.subframe_offset = e.subframe_offset.clone();
            let total = late_range.1.checked_sub(early_range.0).ok_or_else(overflow)?;
            m.play_duration = MediaTime::from_ratio(total, "playDuration")?;
        }
        (m, e) => {
            let (early_span, late_span) = (e.span().expect("同一种类"), late.span().expect("同一种类"));
            *m.span_mut().expect("同一种类") = FrameSpan {
                from_frame: early_span.from_frame,
                duration_frames: early_span.duration_frames + late_span.duration_frames,
            };
        }
    }
    if let (Some(map), Some(early_map)) = (merged.time_map_mut(), early.time_map()) {
        *map = early_map.clone();
    }
    let merged_base = merged.base_mut();
    merged_base.id = early_id.clone();
    merged_base.lineage = early.base().lineage.clone();
    if keys.is_empty() {
        merged_base.name = early.base().name.clone();
    }
    state.items.insert(
        early_id.clone(),
        Placed {
            sequence_id: sequence_id.clone(),
            value: merged,
        },
    );
    // 关键帧：拼得回时写拼好的；拼不回而用 keep 放行时，取那一边的原样。
    match joined {
        Some(keyframes) => crate::item_keyframes::write_joined(state, &early_id, keyframes.as_ref(), fps)?,
        None if base_id != early_id => crate::item_keyframes::copy_bindings(state, &base_id, &early_id)?,
        None => {}
    }
    state.items.remove(&late_id);
    crate::transitions::follow_join(state, &early_id, &late_id);
    crate::ducking::follow_join(state, &early_id, &late_id);
    captions_follow_join(state, &early_id, &late_id);
    followers_follow_join(state, &early_id, &late_id);
    check_item(state, &early_id)
}

/// 合并之后，跟着靠后那件的 `item-local` 实例改跟留下的那件（§3.16）；位置在事务最后按源时刻补算。
fn followers_follow_join(state: &mut VideoState, early_id: &str, late_id: &str) {
    for placed in state.items.values_mut() {
        let policy = &mut placed.value.base_mut().follow_policy;
        if matches!(policy, FollowPolicy::ItemLocal { item_id } if item_id == late_id) {
            *policy = FollowPolicy::ItemLocal {
                item_id: early_id.to_string(),
            };
        }
    }
}

/// 合并之后，经靠后那件投影的字幕改经留下的那件投影（它已经在里面时只去掉靠后那件）。
fn captions_follow_join(state: &mut VideoState, early_id: &str, late_id: &str) {
    for placed in state.items.values_mut() {
        if let TimelineItem::Caption(caption) = &mut placed.value {
            replace_joined(&mut caption.scope_item_ids, early_id, late_id);
        }
    }
}

/// ID 表里的 `late_id` 换成 `early_id`；`early_id` 已经在表里时只去掉 `late_id`。
pub(crate) fn replace_joined(ids: &mut Vec<Id>, early_id: &str, late_id: &str) {
    if let Some(at) = ids.iter().position(|id| id == late_id) {
        if ids.iter().any(|id| id == early_id) {
            ids.remove(at);
        } else {
            ids[at] = early_id.to_string();
        }
    }
}

/// 拆分之后，经被拆实例投影的字幕也经右半边投影（§3.8）：右半边紧跟在原实例后面加进 `scopeItemIds`，
/// 否则素材时钟上的字幕在拆分点之后就没了。
fn captions_follow_split(state: &mut VideoState, item_id: &str, right_id: &str) {
    for placed in state.items.values_mut() {
        if let TimelineItem::Caption(caption) = &mut placed.value
            && let Some(at) = caption.scope_item_ids.iter().position(|id| id == item_id)
        {
            caption.scope_item_ids.insert(at + 1, right_id.to_string());
        }
    }
}

/// 删掉的实例从字幕的 `scopeItemIds` 里拿掉；会拿空时保留原样：空表示「文档时间就是序列时间」，
/// 拿空等于悄悄换了时钟。留下的 ID 对不上任何实例，那段字幕就不显示——它的画面已经删了。
fn captions_forget_deleted(state: &mut VideoState, deleted: &[Id]) {
    for placed in state.items.values_mut() {
        if let TimelineItem::Caption(caption) = &mut placed.value
            && caption.scope_item_ids.iter().any(|id| deleted.contains(id))
            && !caption.scope_item_ids.iter().all(|id| deleted.contains(id))
        {
            caption.scope_item_ids.retain(|id| !deleted.contains(id));
        }
    }
}

/// 波纹删除（视频格式规范 §6.4、§6.6）。区间量化到帧网格；声明的轨道上：
/// - 整个落在区间里的实例删掉；
/// - 跨进区间的裁掉进去的那部分，从区间里伸出去的那部分再前移到区间起点；
/// - 盖住整个区间的媒体实例（视频、音频、合成）拆成两段、删掉中间、右段前移，经它投影的字幕跟着右段走；
///   静态实例（图片、文字、形状、字幕）缩短区间那么长；
/// - 区间之后的前移区间那么长（音频保留子帧位置）。
///
/// 轨道或要动的实例锁着时整笔拒绝，不跳过；没声明的轨道不动。
pub(crate) fn remove_range(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    from: &TimelineTimeInput,
    to: &TimelineTimeInput,
    track_ids: &[Id],
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let (sequence_id, fps, seq_revision) = require_sequence(state, sequence_id)?;
    let sequence_id = sequence_id.to_string();
    if track_ids.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.removeRangeTracks",
            "removeRange must declare the affected tracks"
        )));
    }
    for id in track_ids {
        state
            .tracks
            .get(id)
            .filter(|t| t.sequence_id == sequence_id)
            .ok_or_else(|| ErrorBody::not_found(kinds::track(), id))?;
        ensure_track_editable(state, id)?;
    }
    let grid = GridContext {
        sequence_id: &sequence_id,
        sequence_revision: &seq_revision,
        fps,
    };
    let start = editor_semantics::quantize_input(from, &grid, alignment, "from")?;
    let end = editor_semantics::quantize_input(to, &grid, alignment, "to")?;
    let (f0, f1) = (start.frame, end.frame);
    if f1 <= f0 {
        return Err(ErrorBody::range_collapsed(
            &sequence_id,
            msg!("engine.removeRangeUnderFrame", "The range to remove is shorter than one frame"),
        ));
    }
    ctx.time_resolution.push(start.receipt);
    ctx.time_resolution.push(end.receipt);
    let t0 = frame_time(f0 as i128, fps).ok_or_else(overflow)?;
    let t1 = frame_time(f1 as i128, fps).ok_or_else(overflow)?;
    let length = t1.checked_sub(t0).ok_or_else(overflow)?;

    let mut affected: Vec<(Ratio, Ratio, Id)> = Vec::new();
    for (id, placed) in &state.items {
        if placed.sequence_id != sequence_id || !track_ids.contains(&placed.value.base().track_id) {
            continue;
        }
        let (a, b) = item_range(&placed.value, fps)?;
        if b > t0 {
            ensure_editable(state, &placed.value)?;
            affected.push((a, b, id.clone()));
        }
    }
    affected.sort_by(|x, y| x.0.cmp(&y.0).then_with(|| x.2.cmp(&y.2)));

    let frame = |value: i64| TimelineTimeInput::Frames { value };
    let exact = FrameAlignment::ExactFrame;
    let seq = Some(sequence_id.as_str());
    let mut deleted = Vec::new();
    for (a, b, id) in affected {
        if a >= t1 {
            shift_earlier(state, &id, length, f1 - f0, fps)?;
        } else if a >= t0 && b <= t1 {
            deleted.push(id);
        } else if a < t0 && b <= t1 {
            trim_item(state, seq, &id, Edge::End, &frame(f0), exact, ctx)?;
        } else if a >= t0 {
            trim_item(state, seq, &id, Edge::Start, &frame(f1), exact, ctx)?;
            shift_earlier(state, &id, length, f1 - f0, fps)?;
        } else if matches!(
            state.items[&id].value,
            TimelineItem::Video(_) | TimelineItem::Audio(_) | TimelineItem::Composition(_)
        ) {
            let right = split_item(state, seq, &id, &frame(f1), exact, ctx)?;
            trim_item(state, seq, &id, Edge::End, &frame(f0), exact, ctx)?;
            shift_earlier(state, &right, length, f1 - f0, fps)?;
        } else if let Some(span) = state.items.get_mut(&id).and_then(|p| p.value.span_mut()) {
            // 静态实例只缩短，关键帧按跟随剪口的规则换算：起点不动，新的长度短了区间那么长（§3.16）。
            let old = span.duration_frames;
            span.duration_frames -= f1 - f0;
            let frames = |n: i64| n as f64 / fps.ratio().to_f64();
            let window = Rewindow::trim(frames(old), 0.0, frames(old - (f1 - f0)));
            crate::item_keyframes::rewindow_item(state, &id, window, fps)?;
        }
    }
    if !deleted.is_empty() {
        delete_items(state, seq, &deleted)?;
    }
    Ok(())
}

/// 把实例前移 `length`（= `frames` 帧）。音频按精确时间移，保留子帧位置。
pub(crate) fn shift_earlier(state: &mut VideoState, item_id: &str, length: Ratio, frames: i64, fps: Rate) -> EngineResult<()> {
    let placed = state.items.get_mut(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
    match &mut placed.value {
        TimelineItem::Audio(audio) => {
            let start = audio_start(audio, fps)?.checked_sub(length).ok_or_else(overflow)?;
            let (from_frame, offset) = split_audio_start(start, fps)?;
            audio.from_frame = from_frame;
            audio.subframe_offset = offset;
        }
        other => other.span_mut().expect("音频之外的实例都在帧网格上").from_frame -= frames,
    }
    Ok(())
}

pub(crate) fn delete_items(state: &mut VideoState, sequence_id: Option<&str>, item_ids: &[Id]) -> EngineResult<()> {
    if item_ids.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!("engine.deleteItemsEmpty", "deleteItems needs at least one entry")));
    }
    for id in item_ids {
        let placed = state.items.get(id).ok_or_else(|| ErrorBody::not_found(kinds::item(), id))?;
        if let Some(seq) = sequence_id
            && placed.sequence_id != seq
        {
            return Err(ErrorBody::time_domain_mismatch(msg!(
                "engine.itemNotInSequence",
                "Clip {item} does not belong to sequence {sequence}",
                item = id,
                sequence = seq
            )).entities([id.clone()]));
        }
        ensure_editable(state, &placed.value)?;
        state.items.remove(id);
    }
    captions_forget_deleted(state, item_ids);
    crate::elements::prune_bindings(state);
    Ok(())
}

fn add_track(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    kind: TrackKind,
    name: Option<String>,
    reference: Option<&str>,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let sequence_id = sequence_id.unwrap_or(&state.root_sequence_id).to_string();
    state.sequence(&sequence_id)?;
    if let Some(r) = reference
        && ctx.track_refs.contains_key(r)
    {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.trackRefTaken",
            "This change already has a track named {reference}",
            reference = r
        )));
    }
    let order = max_track_order(state, &sequence_id) + 1;
    let id = create_track(state, &sequence_id, kind, name, order)?;
    if let Some(r) = reference {
        ctx.track_refs.insert(r.to_string(), id);
    }
    Ok(())
}

/// 序列里最大的轨道 `order`（没有轨道时 0）。
fn max_track_order(state: &VideoState, sequence_id: &str) -> i64 {
    state
        .tracks
        .values()
        .filter(|t| t.sequence_id == sequence_id)
        .map(|t| t.value.order)
        .max()
        .unwrap_or(0)
}

/// 新建一条轨道放在给定的 `order` 上；没给名字时按种类计数（V2、A3……）。
fn create_track(state: &mut VideoState, sequence_id: &str, kind: TrackKind, name: Option<String>, order: i64) -> EngineResult<Id> {
    let count = state
        .tracks
        .values()
        .filter(|t| t.sequence_id == sequence_id && t.value.kind == kind)
        .count()
        + 1;
    let default_name = match kind {
        TrackKind::Visual => format!("V{count}"),
        TrackKind::Audio => format!("A{count}"),
        TrackKind::Subtitle => format!("S{count}"),
    };
    let id = new_id("track");
    state.tracks.insert(
        id.clone(),
        Placed {
            sequence_id: sequence_id.to_string(),
            value: Track {
                id: id.clone(),
                order,
                kind,
                name: Some(name.map_or(Ok(default_name), |n| clean_name(&n, kinds::track()))?),
                locked: false,
                visible: true,
                muted: false,
                solo: Solo {
                    enabled: false,
                    group: if kind == TrackKind::Audio {
                        SoloGroup::Audio
                    } else {
                        SoloGroup::Visual
                    },
                },
            },
        },
    );
    Ok(id)
}

/// 叠放分组：画面轨道与字幕轨道合成在同一叠里（渲染按 `order` 统一排序，字幕不自动在最上），声音另算一叠。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StackingGroup {
    Picture,
    Sound,
}

fn stacking_group(kind: TrackKind) -> StackingGroup {
    match kind {
        TrackKind::Audio => StackingGroup::Sound,
        TrackKind::Visual | TrackKind::Subtitle => StackingGroup::Picture,
    }
}

/// 序列里同一叠的轨道，按 `order` 从低到高（画面上从下到上）。
fn tracks_in_stack(state: &VideoState, sequence_id: &str, group: StackingGroup) -> Vec<(Id, i64)> {
    let mut tracks: Vec<(Id, i64)> = state
        .tracks
        .values()
        .filter(|t| t.sequence_id == sequence_id && stacking_group(t.value.kind) == group)
        .map(|t| (t.value.id.clone(), t.value.order))
        .collect();
    tracks.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    tracks
}

/// 给新轨道腾出 `order == slot` 这个位置：序列里 `order >= slot` 的轨道整体加一（所有种类一起让，`order` 在序列内保持唯一）。
fn open_track_slot(state: &mut VideoState, sequence_id: &str, slot: i64) {
    for placed in state.tracks.values_mut() {
        if placed.sequence_id == sequence_id && placed.value.order >= slot {
            placed.value.order += 1;
        }
    }
}

/// 同一叠的轨道按新的次序重新领取它们原有的那组 `order` 值：集合不变，只换谁拿哪个，另一叠的轨道不受影响。
fn reassign_track_orders(state: &mut VideoState, ordered: &[Id], orders: &[i64]) {
    debug_assert_eq!(ordered.len(), orders.len());
    for (id, order) in ordered.iter().zip(orders) {
        if let Some(placed) = state.tracks.get_mut(id)
            && placed.value.order != *order
        {
            placed.value.order = *order;
        }
    }
}

/// `arrangeItem`：见 [`EditOperation::ArrangeItem`]。
fn arrange_item(state: &mut VideoState, sequence_id: Option<&str>, item_id: &str, direction: ArrangeDirection) -> EngineResult<()> {
    let placed = checked_item(state, sequence_id, item_id)?;
    let sequence_id = placed.sequence_id.clone();
    let kind = placed.value.track_kind();
    let track_id = placed.value.base().track_id.clone();
    let shared = state
        .items
        .values()
        .any(|p| p.sequence_id == sequence_id && p.value.base().track_id == track_id && p.value.base().id != item_id);
    let same_kind = tracks_in_stack(state, &sequence_id, stacking_group(kind));
    let index = same_kind
        .iter()
        .position(|(id, _)| *id == track_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::track(), &track_id))?;
    let upward = matches!(direction, ArrangeDirection::Forward | ArrangeDirection::Front);
    let at_edge = if upward { index + 1 == same_kind.len() } else { index == 0 };
    if !shared && at_edge {
        return Err(ErrorBody::invalid_operation(if upward {
            msg!("engine.arrangeAtFront", "Clip {item} is already at the front", item = item_id)
        } else {
            msg!("engine.arrangeAtBack", "Clip {item} is already at the back", item = item_id)
        })
        .entities([item_id])
        .details(json!({ "rule": "already-at-edge", "edge": if upward { "front" } else { "back" } })));
    }
    if shared {
        // 与别的实例共用一条轨道：拆到相邻新建的一条轨道上，别的实例留在原处。
        let current = same_kind[index].1;
        let order = match direction {
            ArrangeDirection::Forward => {
                open_track_slot(state, &sequence_id, current + 1);
                current + 1
            }
            ArrangeDirection::Backward => {
                open_track_slot(state, &sequence_id, current);
                current
            }
            ArrangeDirection::Front => max_track_order(state, &sequence_id) + 1,
            ArrangeDirection::Back => {
                let lowest = same_kind[0].1;
                open_track_slot(state, &sequence_id, lowest);
                lowest
            }
        };
        let new_track = create_track(state, &sequence_id, kind, None, order)?;
        state.items.get_mut(item_id).expect("刚检查过").value.base_mut().track_id = new_track;
        return Ok(());
    }
    // 独占一条轨道：整条轨道在同一叠里挪位（画面与字幕一叠），其余轨道顺次让位。
    let orders: Vec<i64> = same_kind.iter().map(|(_, order)| *order).collect();
    let mut ordered: Vec<Id> = same_kind.into_iter().map(|(id, _)| id).collect();
    let moved = ordered.remove(index);
    let at = match direction {
        ArrangeDirection::Forward => index + 1,
        ArrangeDirection::Backward => index - 1,
        ArrangeDirection::Front => ordered.len(),
        ArrangeDirection::Back => 0,
    };
    ordered.insert(at, moved);
    reassign_track_orders(state, &ordered, &orders);
    Ok(())
}

/// `moveTrack`：见 [`EditOperation::MoveTrack`]。
fn move_track(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    track_id: &str,
    target: &str,
    position: TrackPosition,
) -> EngineResult<()> {
    let placed = state
        .tracks
        .get(track_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::track(), track_id))?;
    if let Some(seq) = sequence_id
        && placed.sequence_id != seq
    {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.trackNotInSequence",
            "Track {track} does not belong to sequence {sequence}",
            track = track_id,
            sequence = seq
        )));
    }
    let sequence_id = placed.sequence_id.clone();
    let kind = placed.value.kind;
    let anchor = state
        .tracks
        .get(target)
        .filter(|t| t.sequence_id == sequence_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::track(), target))?;
    if stacking_group(anchor.value.kind) != stacking_group(kind) {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.moveTrackStack",
            "Picture and subtitle tracks stack together and audio tracks separately; a track can only be placed next to one in its own stack"
        ))
        .entities([track_id.to_string(), target.to_string()]));
    }
    if track_id == target {
        return Err(
            ErrorBody::invalid_operation(msg!("engine.moveTrackSelf", "A track cannot be placed relative to itself"))
                .entities([track_id.to_string()]),
        );
    }
    ensure_track_editable(state, track_id)?;
    let stack = tracks_in_stack(state, &sequence_id, stacking_group(kind));
    let orders: Vec<i64> = stack.iter().map(|(_, order)| *order).collect();
    let mut ordered: Vec<Id> = stack.into_iter().map(|(id, _)| id).collect();
    let index = ordered.iter().position(|id| id == track_id).expect("刚检查过");
    let moved = ordered.remove(index);
    let anchor_at = ordered.iter().position(|id| id == target).expect("刚检查过");
    let at = match position {
        TrackPosition::Above => anchor_at + 1,
        TrackPosition::Below => anchor_at,
    };
    ordered.insert(at, moved);
    reassign_track_orders(state, &ordered, &orders);
    Ok(())
}

/// `deleteTrack`：只删空轨道。其他轨道的 `order` 不重排：`addTrack` 取最大值加一、不动别人，删除也不动别人。
fn delete_track(state: &mut VideoState, sequence_id: Option<&str>, track_id: &str, ctx: &mut EditContext<'_>) -> EngineResult<()> {
    let placed = state.tracks.get(track_id).ok_or_else(|| ErrorBody::not_found(kinds::track(), track_id))?;
    if let Some(seq) = sequence_id
        && placed.sequence_id != seq
    {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.trackNotInSequence",
            "Track {track} does not belong to sequence {sequence}",
            track = track_id,
            sequence = seq
        )));
    }
    ensure_track_editable(state, track_id)?;
    let mut item_ids: Vec<Id> = state
        .items
        .values()
        .filter(|p| p.value.base().track_id == track_id)
        .map(|p| p.value.base().id.clone())
        .collect();
    if !item_ids.is_empty() {
        item_ids.sort();
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.trackNotEmpty",
            "Track {track} still has clips on it ({count}); only an empty track can be deleted",
            track = track_id,
            count = item_ids.len()
        ))
        .recovery(msg!(
            "engine.trackNotEmptyRecovery",
            "Delete its clips (deleteItems) or move them to another track (moveItem) first, then delete the track"
        ))
        .entities([track_id.to_string()])
        .details(json!({ "rule": "track-not-empty", "itemIds": item_ids, "next": ["deleteItems", "moveItem"] })));
    }
    let mut rule_ids: Vec<Id> = state
        .ducking
        .values()
        .map(|p| &p.value)
        .filter(|rule| {
            let in_trigger = rule.trigger.group().is_some_and(|g| g.track_ids.iter().any(|id| id == track_id));
            in_trigger || rule.target.track_ids.iter().any(|id| id == track_id)
        })
        .map(|rule| rule.id.clone())
        .collect();
    if !rule_ids.is_empty() {
        rule_ids.sort();
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.trackInDucking",
            "Track {track} is used by a ducking rule",
            track = track_id
        ))
        .recovery(msg!(
            "engine.trackInDuckingRecovery",
            "Take the track out of the rule (setDucking) or delete the rule (removeDucking) first, then delete the track"
        ))
        .entities([track_id.to_string()])
        .details(json!({ "rule": "track-in-ducking", "duckingRuleIds": rule_ids, "next": ["setDucking", "removeDucking"] })));
    }
    state.tracks.remove(track_id);
    ctx.removed_tracks.push(track_id.to_string());
    Ok(())
}

fn update_track(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    track_id: &str,
    locked: Option<bool>,
    visible: Option<bool>,
    muted: Option<bool>,
    name: Option<String>,
) -> EngineResult<()> {
    let placed = state
        .tracks
        .get_mut(track_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::track(), track_id))?;
    if let Some(seq) = sequence_id
        && placed.sequence_id != seq
    {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.trackNotInSequence",
            "Track {track} does not belong to sequence {sequence}",
            track = track_id,
            sequence = seq
        )));
    }
    let track = &mut placed.value;
    // 锁定的轨道只能先解锁（锁定阻止修改，不等于隐藏）。
    let unlocking = locked == Some(false);
    if track.locked && !unlocking && (visible.is_some() || muted.is_some() || name.is_some()) {
        return Err(ErrorBody::locked(vec![track_id.to_string()], msg!("engine.trackLocked", "The track is locked")));
    }
    if let Some(v) = locked {
        track.locked = v;
    }
    if let Some(v) = visible {
        track.visible = v;
    }
    if let Some(v) = muted {
        track.muted = v;
    }
    if let Some(n) = name {
        track.name = Some(clean_name(&n, kinds::track())?);
    }
    Ok(())
}

/// 文字实例的正文上限（字符）。
const MAX_TEXT_CHARS: usize = 10_000;
/// 样式、形状与生成器参数这类自由结构的上限（序列化之后的字节）。
const MAX_OBJECT_BYTES: usize = 64 * 1024;
/// 画布边长的上限（像素）。
const MAX_CANVAS_SIDE: u32 = 16_384;

/// 序列里一个可以修改的实例：片段与所在轨道都没锁。只改属性、不涉及时间，所以 `sequenceId` 可以省略。
fn checked_item<'s>(state: &'s VideoState, sequence_id: Option<&str>, item_id: &str) -> EngineResult<&'s Placed<TimelineItem>> {
    let placed = state.items.get(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
    if let Some(seq) = sequence_id
        && placed.sequence_id != seq
    {
        return Err(ErrorBody::time_domain_mismatch(msg!(
            "engine.itemNotInSequence",
            "Clip {item} does not belong to sequence {sequence}",
            item = item_id,
            sequence = seq
        )).entities([item_id]));
    }
    ensure_editable(state, &placed.value)?;
    Ok(placed)
}

pub(crate) fn editable_item<'s>(state: &'s mut VideoState, sequence_id: Option<&str>, item_id: &str) -> EngineResult<&'s mut TimelineItem> {
    checked_item(state, sequence_id, item_id)?;
    Ok(&mut state.items.get_mut(item_id).expect("刚检查过").value)
}

pub(crate) fn not_applicable(item_id: &str, why: Text) -> ErrorBody {
    ErrorBody::invalid_operation(msg!("engine.notApplicable", "Clip {item} {reason}", item = item_id, reason = why)).entities([item_id])
}

/// 生成类元素与图形的种类参数：按目标类型解析，解析之后再序列化，对不上的字段按不认识报错（§1.4）。
fn parse_props<T: serde::de::DeserializeOwned + Serialize>(item_id: &str, props: &Value) -> EngineResult<T> {
    let parsed: T = serde_json::from_value(props.clone())
        .map_err(|e| ErrorBody::invalid_operation(msg!("engine.propsInvalid", "props is invalid: {error}", error = e.to_string())).entities([item_id]))?;
    let back = serde_json::to_value(&parsed).expect("能序列化");
    if let Some(field) = dropped_field(props, &back, "props") {
        return Err(ErrorBody::invalid_operation(msg!("engine.propsUnknownField", "props has an unknown field {field}", field)).entities([item_id]));
    }
    Ok(parsed)
}

fn set_props(state: &mut VideoState, sequence_id: Option<&str>, item_id: &str, props: &Value) -> EngineResult<()> {
    check_json_object(item_id, "props", props)?;
    match editable_item(state, sequence_id, item_id)? {
        TimelineItem::Shape(i) => i.shape = parse_props(item_id, props)?,
        TimelineItem::Sticker(i) => i.sticker = parse_props(item_id, props)?,
        TimelineItem::Visualizer(i) => i.visualizer = parse_props(item_id, props)?,
        TimelineItem::Progress(i) => i.progress = parse_props(item_id, props)?,
        TimelineItem::Draw(i) => i.draw = parse_props(item_id, props)?,
        TimelineItem::Placeholder(i) => i.placeholder = parse_props(item_id, props)?,
        TimelineItem::Confetti(i) => i.confetti = parse_props(item_id, props)?,
        TimelineItem::Whiteboard(i) => i.whiteboard = parse_props(item_id, props)?,
        _ => return Err(not_applicable(
                item_id,
                msg!(
                    "engine.noKindProps",
                    "has no kind-specific parameters: use setText and setStyle for text, setStyle for media"
                ),
            )),
    }
    check_item(state, item_id)
}

/// 整个替换实例一个属性的关键帧绑定；`None` 或空表去掉。绑定存在序列上（§3.15）。
fn set_keyframes(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    item_id: &str,
    property: KeyframeProperty,
    keyframes: Option<&[Keyframe]>,
) -> EngineResult<()> {
    let placed = checked_item(state, sequence_id, item_id)?;
    if placed.value.place().is_none() {
        return Err(not_applicable(
            item_id,
            msg!("engine.noPictureNoKeyframes", "has no picture, so it cannot have keyframes"),
        ));
    }
    let seq_id = placed.sequence_id.clone();
    let header = &mut state.sequences.get_mut(&seq_id).expect("实例所在的序列").header;
    let existing = header
        .animation_bindings
        .iter()
        .position(|b| b.target_id == item_id && b.property_path == property);
    match (keyframes.filter(|k| !k.is_empty()), existing) {
        (Some(frames), Some(i)) => header.animation_bindings[i].keyframes = frames.to_vec(),
        (Some(frames), None) => header.animation_bindings.push(AnimationBinding {
            id: new_id("kb"),
            target_id: item_id.to_string(),
            property_path: property,
            keyframes: frames.to_vec(),
        }),
        (None, Some(i)) => {
            header.animation_bindings.remove(i);
        }
        (None, None) => {}
    }
    check_item(state, item_id)
}

/// 样式、形状与参数是格式之外定义的结构，引擎只要求它是对象并限制大小；字段的含义由渲染器解释。
fn check_json_object(item_id: &str, field: &str, value: &Value) -> EngineResult<()> {
    if !value.is_object() {
        return Err(ErrorBody::invalid_operation(msg!("engine.fieldNotObject", "{field} must be an object", field)).entities([item_id]));
    }
    if serde_json::to_vec(value).map_or(true, |bytes| bytes.len() > MAX_OBJECT_BYTES) {
        return Err(ErrorBody::invalid_operation(msg!("engine.fieldTooLarge", "{field} cannot exceed 64 KiB", field)).entities([item_id]));
    }
    Ok(())
}

/// `updateItem` 要改的字段，`None` 是不改。
struct ItemUpdate<'a> {
    name: Option<&'a str>,
    enabled: Option<bool>,
    locked: Option<bool>,
    follow_policy: Option<&'a FollowPolicy>,
}

fn update_item(state: &mut VideoState, sequence_id: Option<&str>, item_id: &str, update: ItemUpdate<'_>) -> EngineResult<()> {
    let ItemUpdate {
        name,
        enabled,
        locked,
        follow_policy,
    } = update;
    if name.is_none() && enabled.is_none() && locked.is_none() && follow_policy.is_none() {
        return Err(ErrorBody::invalid_operation(msg!("engine.updateItemEmpty", "updateItem must change at least one thing")));
    }
    let placed = state.items.get(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
    if let Some(seq) = sequence_id
        && placed.sequence_id != seq
    {
        return Err(ErrorBody::time_domain_mismatch(msg!(
            "engine.itemNotInSequence",
            "Clip {item} does not belong to sequence {sequence}",
            item = item_id,
            sequence = seq
        )).entities([item_id]));
    }
    ensure_track_editable(state, &placed.value.base().track_id)?;
    // 锁定的片段只能先解锁；同一个操作里解锁再改别的可以。
    if placed.value.base().locked && locked != Some(false) && (name.is_some() || enabled.is_some() || follow_policy.is_some()) {
        return Err(ErrorBody::locked(vec![item_id.to_string()], msg!("engine.itemLocked", "The clip is locked")));
    }
    let name = match name.map(str::trim) {
        Some("") => Some(None),
        Some(n) => Some(Some(clean_name(n, kinds::item())?)),
        None => None,
    };
    let base = state.items.get_mut(item_id).expect("刚找到").value.base_mut();
    if let Some(n) = name {
        base.name = n;
    }
    if let Some(v) = enabled {
        base.enabled = v;
    }
    if let Some(v) = locked {
        base.locked = v;
    }
    if let Some(policy) = follow_policy {
        base.follow_policy = policy.clone();
        check_item(state, item_id)?;
    }
    Ok(())
}

/// `setStyle` 的字段：外层 `None` 是不改，`Some(None)` 是去掉。
#[derive(Default, PartialEq)]
struct StyleInput {
    opacity: Option<Option<f64>>,
    radius: Option<Option<f64>>,
    corner_radii: Option<Option<CornerRadii>>,
    mode: Option<Option<VisualMode>>,
    fit: Option<Option<Fit>>,
    bg: Option<Option<Background>>,
    mask: Option<Option<Mask>>,
    tile: Option<Option<Tile>>,
    style: Option<Option<Value>>,
    style_preset_id: Option<Option<String>>,
    vertical_align: Option<Option<String>>,
    shape: Option<ShapeProps>,
    crop: Option<Option<Crop>>,
}

fn set_style(state: &mut VideoState, sequence_id: Option<&str>, item_id: &str, input: StyleInput) -> EngineResult<()> {
    if input == StyleInput::default() {
        return Err(ErrorBody::invalid_operation(msg!("engine.setStyleEmpty", "setStyle must change at least one thing")));
    }
    let item = editable_item(state, sequence_id, item_id)?;
    if input.opacity.is_some() || input.radius.is_some() || input.corner_radii.is_some() {
        let place = item.place_mut().ok_or_else(|| not_applicable(item_id, msg!("engine.noPicture", "has no picture")))?;
        if let Some(v) = input.opacity {
            place.opacity = v;
        }
        if let Some(v) = input.radius {
            place.radius = v;
        }
        if let Some(v) = input.corner_radii {
            place.corner_radii = v;
        }
    }
    if input.mode.is_some() || input.fit.is_some() || input.bg.is_some() {
        let media = item
            .media_mut()
            .ok_or_else(|| not_applicable(
                item_id,
                msg!("engine.notVisualMedia", "is not visual media, so it has no mode, fit or bg"),
            ))?;
        if let Some(v) = input.mode {
            media.mode = v;
        }
        if let Some(v) = input.fit {
            media.fit = v;
        }
        if let Some(v) = input.bg {
            media.bg = v;
        }
    }
    if let Some(mask) = input.mask {
        *item
            .mask_mut()
            .ok_or_else(|| not_applicable(
                item_id,
                msg!("engine.maskNotApplicable", "is not visual media or a composition, so it cannot have a mask"),
            ))? = mask;
    }
    if let Some(tile) = input.tile {
        *item.tile_mut().ok_or_else(|| not_applicable(
            item_id,
            msg!("engine.tileNotApplicable", "is not an image or text, so it cannot be tiled"),
        ))? = tile;
    }
    if input.style.is_some() || input.style_preset_id.is_some() || input.vertical_align.is_some() {
        let TimelineItem::Text(t) = &mut *item else {
            return Err(not_applicable(
                item_id,
                msg!("engine.noTextStyle", "is not a text clip, so it has no text style"),
            ));
        };
        if let Some(v) = input.style {
            t.style = v;
        }
        if let Some(v) = input.style_preset_id {
            t.style_preset_id = v;
        }
        if let Some(v) = input.vertical_align {
            t.vertical_align = v;
        }
    }
    if let Some(shape) = input.shape {
        match &mut *item {
            TimelineItem::Shape(s) => s.shape = shape,
            _ => return Err(not_applicable(item_id, msg!("engine.notShapeItem", "is not a shape clip"))),
        }
    }
    if let Some(crop) = input.crop {
        crate::effects::apply_crop(item, item_id, crop.as_ref())?;
    }
    check_item(state, item_id)
}

/// 淡入淡出写成十进制秒；0 表示没有淡变（省略字段）。
fn parse_fade(text: Option<&str>, field: &str) -> EngineResult<Option<Option<MediaTime>>> {
    let Some(text) = text else { return Ok(None) };
    let value = editor_semantics::parse_decimal_seconds(text, field)?;
    if value.is_negative() {
        return Err(ErrorBody::invalid_operation(msg!("engine.fieldNegative", "{field} cannot be negative", field)));
    }
    Ok(Some(if value == Ratio::ZERO {
        None
    } else {
        Some(MediaTime::from_ratio(value, field)?)
    }))
}

#[allow(clippy::too_many_arguments)]
fn set_audio_mix(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    item_id: &str,
    muted: Option<bool>,
    volume: Option<f64>,
    fade_in: Option<&str>,
    fade_out: Option<&str>,
) -> EngineResult<()> {
    if muted.is_none() && volume.is_none() && fade_in.is_none() && fade_out.is_none() {
        return Err(ErrorBody::invalid_operation(msg!("engine.setAudioMixEmpty", "setAudioMix must change at least one thing")));
    }
    let fade_in = parse_fade(fade_in, "fadeIn")?;
    let fade_out = parse_fade(fade_out, "fadeOut")?;
    let placed = checked_item(state, sequence_id, item_id)?;
    let fps = state.sequence(&placed.sequence_id)?.header.fps;
    let (start, end) = item_range(&placed.value, fps)?;
    let length = end.checked_sub(start).ok_or_else(overflow)?;

    let item = &mut state.items.get_mut(item_id).expect("刚检查过").value;
    let (gain, fades) = match item {
        TimelineItem::Audio(audio) => {
            if let Some(m) = muted {
                audio.mix.muted = m;
            }
            (&mut audio.mix.volume, (&mut audio.mix.fade_in, &mut audio.mix.fade_out))
        }
        // 视频与合成自带的声音：静音就是不用这路声音。
        TimelineItem::Video(VideoItem { embedded_audio: audio, .. })
        | TimelineItem::Composition(CompositionItem { audio: Some(audio), .. }) => {
            if let Some(m) = muted {
                audio.enabled = !m;
            }
            (&mut audio.volume, (&mut audio.fade_in, &mut audio.fade_out))
        }
        _ => return Err(not_applicable(item_id, msg!("engine.noSound", "has no sound"))),
    };
    if let Some(v) = volume {
        *gain = v;
    }
    if fade_in.is_none() && fade_out.is_none() {
        return check_item(state, item_id);
    }
    if let Some(v) = fade_in {
        *fades.0 = v;
    }
    if let Some(v) = fade_out {
        *fades.1 = v;
    }
    let total = [&*fades.0, &*fades.1]
        .into_iter()
        .flatten()
        .try_fold(Ratio::ZERO, |sum, t| -> EngineResult<Ratio> {
            sum.checked_add(t.to_ratio("fade")?).ok_or_else(overflow)
        })?;
    if total > length {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.fadesTooLong",
            "Fade-in and fade-out together cannot be longer than the clip"
        )).entities([item_id]));
    }
    check_item(state, item_id)
}

fn set_speed(state: &mut VideoState, sequence_id: Option<&str>, item_id: &str, rate: Rate) -> EngineResult<()> {
    rate.validate("rate")?;
    let speed = rate.ratio();
    let (min, max) = (Ratio::new(1, 10).expect("常数"), Ratio::from_int(10).expect("常数"));
    if speed < min || speed > max {
        return Err(ErrorBody::invalid_operation(msg!("engine.speedRange", "The rate must be between 0.1× and 10×")).entities([item_id]));
    }
    let placed = checked_item(state, sequence_id, item_id)?;
    if !matches!(placed.value, TimelineItem::Video(_) | TimelineItem::Audio(_)) {
        return Err(not_applicable(
            item_id,
            msg!("engine.speedNotMedia", "is not a video or audio clip, so its speed cannot change"),
        ));
    }
    let seq_id = placed.sequence_id.clone();
    let fps = state.sequence(&seq_id)?.header.fps;
    let mut item = placed.value.clone();
    let (start, end) = item_range(&item, fps)?;
    let length = end.checked_sub(start).ok_or_else(overflow)?;
    let Some(TimeMap::Linear { source_in, rate: old }) = item.time_map_mut().cloned() else {
        return Err(not_applicable(
            item_id,
            msg!("engine.speedNotLinear", "has no linear time mapping, so its speed cannot change"),
        ));
    };
    // 取用的源区间不变：新长度 = 源长度 / 新速率。
    let source_length = length.checked_mul(old.ratio()).ok_or_else(overflow)?;
    let new_length = source_length.checked_div(speed).ok_or_else(overflow)?;
    let new_length = match &mut item {
        TimelineItem::Video(v) => {
            let frames = frames_at(new_length, fps).ok_or_else(overflow)?.floor().max(1);
            v.span.duration_frames = i64::try_from(frames).map_err(|_| overflow())?;
            frame_time(frames, fps).ok_or_else(overflow)?
        }
        TimelineItem::Audio(a) => {
            a.play_duration = MediaTime::from_ratio(new_length, "playDuration")?;
            new_length
        }
        _ => unreachable!("上面只放过视频与音频"),
    };
    let map = TimeMap::Linear { source_in, rate };
    check_time_map(state, item_id, &map, new_length, item.asset_ref())?;
    *item.time_map_mut().expect("上面取到过") = map;
    state.items.insert(
        item_id.to_string(),
        Placed {
            sequence_id: seq_id,
            value: item,
        },
    );
    Ok(())
}

fn update_sequence(
    state: &mut VideoState,
    sequence_id: &str,
    name: Option<&str>,
    canvas: Option<&CanvasChange>,
    background: Option<&str>,
) -> EngineResult<()> {
    if name.is_none() && canvas.is_none() && background.is_none() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.updateSequenceEmpty",
            "updateSequence must change at least one thing"
        )));
    }
    let mut next = state.sequence(sequence_id)?.header.clone();
    if let Some(n) = name {
        next.name = clean_name(n, kinds::sequence())?;
    }
    if let Some(bg) = background {
        next.canvas.background = canvas_background(bg)
            .ok_or_else(|| ErrorBody::invalid_operation(msg!("engine.backgroundInvalid", "The canvas background must be #RRGGBB")).details(json!({ "background": bg })))?;
    }
    if let Some(c) = canvas {
        let valid = |side: u32| (1..=MAX_CANVAS_SIDE).contains(&side);
        if !valid(c.width) || !valid(c.height) {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.canvasSideRange",
                "Each canvas side must be 1–{max} pixels",
                max = MAX_CANVAS_SIDE
            )));
        }
        next.canvas.width = c.width;
        next.canvas.height = c.height;
    }
    state.sequences.get_mut(sequence_id).expect("刚找到").header = next;
    Ok(())
}

/// 把链接素材改记为受管理。bytes 已经在事务之外复制并核对过摘要。
fn collect_assets(state: &mut VideoState, asset_ids: &[Id]) -> EngineResult<()> {
    if asset_ids.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!("engine.collectAssetsEmpty", "collectAssets needs at least one entry")));
    }
    for id in asset_ids {
        let asset = state.assets.get_mut(id).ok_or_else(|| ErrorBody::not_found(kinds::asset(), id))?;
        let current = asset.current_revision.clone();
        if let Some(revision) = asset.revisions.get_mut(&current) {
            revision.storage = AssetStorage::Managed;
        }
    }
    Ok(())
}

fn relink_asset(state: &mut VideoState, index: usize, asset_id: &str, ctx: &mut EditContext<'_>) -> EngineResult<()> {
    let locator = ctx
        .relinked
        .get(&index)
        .ok_or_else(|| ErrorBody::invalid_operation(msg!("engine.relinkNotPrepared", "The relinked file is not ready")))?;
    let asset = state
        .assets
        .get_mut(asset_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::asset(), asset_id))?;
    let current = asset.current_revision.clone();
    let revision = asset
        .revisions
        .get_mut(&current)
        .ok_or_else(|| ErrorBody::asset_missing(asset_id, msg!("engine.assetNoCurrentRevision", "The asset has no current revision")))?;
    let frozen = matches!(revision.storage, AssetStorage::Linked { frozen: true, .. });
    revision.storage = AssetStorage::Linked {
        locator: locator.clone(),
        frozen,
    };
    Ok(())
}

/// 输入里的每个字段都必须被认得：解析之后再序列化，对不上的字段就是被丢掉的（视频格式规范 §1.4）。
fn dropped_field(input: &Value, output: &Value, path: &str) -> Option<String> {
    match (input, output) {
        (Value::Object(a), Value::Object(b)) => a.iter().find_map(|(key, value)| {
            let here = if path.is_empty() { key.clone() } else { format!("{path}.{key}") };
            match b.get(key) {
                Some(other) => dropped_field(value, other, &here),
                // 省略的默认值（false、空表、null）不算丢失。
                None if matches!(value, Value::Null | Value::Bool(false)) => None,
                None if value.as_array().is_some_and(Vec::is_empty) || value.as_object().is_some_and(|o| o.is_empty()) => None,
                None => Some(here),
            }
        }),
        (Value::Array(a), Value::Array(b)) => a
            .iter()
            .zip(b)
            .enumerate()
            .find_map(|(i, (x, y))| dropped_field(x, y, &format!("{path}[{i}]"))),
        _ => None,
    }
}

/// 线性映射的源区间必须落在素材之内。
fn check_time_map(state: &VideoState, id: &str, map: &TimeMap, length: Ratio, asset_ref: Option<&VersionRef>) -> EngineResult<()> {
    let TimeMap::Linear { source_in, rate } = map else {
        return Ok(());
    };
    rate.validate("rate")?;
    let source_in = source_in.to_ratio("sourceIn")?;
    let source_out = source_in
        .checked_add(length.checked_mul(rate.ratio()).ok_or_else(overflow)?)
        .ok_or_else(overflow)?;
    let duration = match asset_ref {
        Some(r) => asset_duration(state, r)?,
        None => None,
    };
    check_source_range(id, source_in, source_out, duration)
}

/// `insertItems` 里引用同一事务新建对象的字段：`trackRef` → `trackId`，`documentRef` → `documentId`，
/// `styleDocumentRef` → `styleDocumentId`，`assetImportRef`（`importAsset` 的 `ref`）→ `assetRef`（那个素材的当前版本）。
/// 同一个对象不能既给 ID 又给 ref。
fn resolve_item_refs(state: &VideoState, body: &mut serde_json::Map<String, Value>, ctx: &EditContext<'_>, n: usize) -> EngineResult<()> {
    let fail = |message: Text| ErrorBody::invalid_operation(message).details(json!({ "itemIndex": n }));
    if let Some(value) = body.remove("assetImportRef") {
        let Value::String(reference) = value else {
            return Err(fail(msg!(
                "engine.itemRefNotString",
                "{field} of clip {number} must be a string",
                field = "assetImportRef",
                number = n + 1
            )));
        };
        if body.contains_key("assetRef") {
            return Err(fail(msg!(
                "engine.itemRefAndId",
                "Clip {number} gives both {id} and {reference}",
                number = n + 1,
                id = "assetRef",
                reference = "assetImportRef"
            )));
        }
        let asset_id = ctx
            .refs
            .get(&reference)
            .ok_or_else(|| fail(msg!(
                "engine.importRefMissingInChange",
                "This change has no import named {reference}",
                reference
            )))?;
        let asset = state.assets.get(asset_id).ok_or_else(|| ErrorBody::not_found(kinds::asset(), asset_id))?;
        body.insert("assetRef".into(), json!({ "id": asset_id, "revision": asset.current_revision }));
    }
    for (ref_key, id_key, what) in [
        ("trackRef", "trackId", kinds::track as fn() -> Text),
        ("documentRef", "documentId", kinds::document),
        ("styleDocumentRef", "styleDocumentId", kinds::document),
    ] {
        let Some(value) = body.remove(ref_key) else { continue };
        let Value::String(reference) = value else {
            return Err(fail(msg!(
                "engine.itemRefNotString",
                "{field} of clip {number} must be a string",
                field = ref_key,
                number = n + 1
            )));
        };
        if body.contains_key(id_key) {
            return Err(fail(msg!(
                "engine.itemRefAndId",
                "Clip {number} gives both {id} and {reference}",
                number = n + 1,
                id = id_key,
                reference = ref_key
            )));
        }
        let refs = if ref_key == "trackRef" {
            &ctx.track_refs
        } else {
            &ctx.document_refs
        };
        let id = refs
            .get(&reference)
            .ok_or_else(|| fail(msg!(
                "engine.refMissingInChange",
                "This change has no {kind} named {reference}",
                kind = what(),
                reference
            )))?;
        body.insert(id_key.into(), json!(id));
    }
    Ok(())
}

fn insert_items(state: &mut VideoState, sequence_id: &str, items: &[Value], ctx: &EditContext<'_>) -> EngineResult<()> {
    if items.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!("engine.insertItemsEmpty", "insertItems needs at least one entry")));
    }
    let (sequence_id, fps, _) = require_sequence(state, Some(sequence_id))?;
    let sequence_id = sequence_id.to_string();
    for (n, input) in items.iter().enumerate() {
        let fail = |message: Text| ErrorBody::invalid_operation(message).details(json!({ "itemIndex": n }));
        let Value::Object(fields) = input else {
            return Err(fail(msg!("engine.itemNotObject", "Clip {number} is not an object", number = n + 1)));
        };
        if fields.contains_key("id") || fields.contains_key("lineage") {
            return Err(fail(msg!(
                "engine.itemOwnId",
                "Clip {number} cannot bring its own id or lineage: the engine assigns them",
                number = n + 1
            )));
        }
        // 引擎管的字段有默认值，调用方只写内容。
        let id = new_id("item");
        let mut body = fields.clone();
        resolve_item_refs(state, &mut body, ctx, n)?;
        body.insert("id".into(), json!(id));
        for (key, default) in [
            ("enabled", json!(true)),
            ("locked", json!(false)),
            ("followPolicy", json!(FollowPolicy::default())),
        ] {
            body.entry(key).or_insert(default);
        }
        // 画面实例的几何可以省略，取按种类的缺省（§3.5）。
        if !matches!(body.get("type").and_then(Value::as_str), Some("audio" | "caption")) {
            body.entry("place").or_insert(json!({}));
        }
        let track_id = body.get("trackId").and_then(Value::as_str).unwrap_or_default().to_string();
        let paint_order = state
            .items
            .values()
            .filter(|i| i.value.base().track_id == track_id)
            .map(|i| i.value.base().paint_order)
            .max()
            .unwrap_or(0)
            + 1;
        body.entry("paintOrder").or_insert(json!(paint_order));
        let body = Value::Object(body);
        let item: TimelineItem = serde_json::from_value(body.clone()).map_err(|e| fail(msg!(
                "engine.itemInvalid",
                "Clip {number} is invalid: {error}",
                number = n + 1,
                error = e.to_string()
            )))?;
        if let Some(field) = dropped_field(&body, &serde_json::to_value(&item).expect("能序列化"), "") {
            return Err(fail(msg!(
                "engine.itemUnknownField",
                "Clip {number} has an unknown field {field}",
                number = n + 1,
                field
            )));
        }

        let track = state
            .tracks
            .get(&track_id)
            .filter(|t| t.sequence_id == sequence_id)
            .ok_or_else(|| ErrorBody::not_found(kinds::track(), &track_id))?;
        if track.value.kind != item.track_kind() {
            return Err(ErrorBody::invalid_operation(msg!("engine.itemTrackKind", "The clip does not match the kind of track")).entities([track_id.clone()]));
        }
        ensure_track_editable(state, &track_id)?;
        for asset_ref in item.asset_refs() {
            asset_revision(state, asset_ref)?;
        }
        let (start, end) = item_range(&item, fps)?;
        let length = end.checked_sub(start).ok_or_else(overflow)?;
        match &item {
            TimelineItem::Video(v) => check_time_map(state, &id, &v.time_map, length, Some(&v.asset_ref))?,
            // 替身与合成共用时间映射：源区间不能超出替身的长度。
            TimelineItem::Composition(c) => check_time_map(state, &id, &c.time_map, length, c.prerender.as_ref())?,
            TimelineItem::Caption(c) => {
                for doc in std::iter::once(&c.document_id).chain(&c.style_document_id) {
                    if !state.documents.contains_key(doc) {
                        return Err(ErrorBody::not_found(kinds::document(), doc));
                    }
                }
            }
            TimelineItem::Audio(a) => {
                let one_frame = frame_time(1, fps).ok_or_else(overflow)?;
                let offset = a.subframe_offset.to_ratio("subframeOffset")?;
                if a.from_frame < 0 || offset.is_negative() || offset >= one_frame || length <= Ratio::ZERO {
                    return Err(ErrorBody::range_collapsed(
                        &id,
                        msg!("engine.audioSpanInvalid", "The start or length of the audio clip is invalid"),
                    ));
                }
                check_time_map(state, &id, &a.time_map, length, Some(&a.asset_ref))?;
            }
            _ => {}
        }
        state.items.insert(
            id.clone(),
            Placed {
                sequence_id: sequence_id.clone(),
                value: item,
            },
        );
        check_item(state, &id).map_err(|e| with_item_index(e, n))?;
    }
    Ok(())
}

/// 在错误的细节里补上 `itemIndex`（`insertItems` 里第几个实例）。
fn with_item_index(mut err: ErrorBody, index: usize) -> ErrorBody {
    match &mut err.details {
        Value::Object(map) => {
            map.entry("itemIndex").or_insert(json!(index));
        }
        Value::Null => err.details = json!({ "itemIndex": index }),
        other => err.details = json!({ "itemIndex": index, "detail": other.clone() }),
    }
    err
}

pub(crate) struct PutDocumentInput<'a> {
    pub document_id: Option<&'a str>,
    pub reference: Option<&'a str>,
    pub kind: &'a str,
    pub name: Option<&'a str>,
    pub language: Option<&'a str>,
    pub source_asset: Option<&'a AssetTarget>,
    pub source_document: Option<&'a DocumentTarget>,
    pub body: &'a Value,
    pub summary: Option<&'a Value>,
    pub extensions: &'a BTreeMap<String, Value>,
}

pub(crate) fn put_document(state: &mut VideoState, input: PutDocumentInput<'_>, ctx: &mut EditContext<'_>) -> EngineResult<()> {
    let kind = input.kind.trim();
    let valid_kind = !kind.is_empty()
        && kind.len() <= 64
        && kind
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.' | '/'));
    if !valid_kind {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.documentKindInvalid",
            "A document kind must be 1–64 characters of lowercase letters, digits and - . /"
        )));
    }
    if !input.body.is_object() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.documentBodyNotObject",
            "The document body must be a JSON object"
        )));
    }
    // 认得的正文格式只核对规范为它补充的字段（视频格式规范 §5.2、§5.3、§5.6），别的字段照旧不校验。
    let schema = input.body.get("schema").and_then(Value::as_str).unwrap_or_default();
    let problems = match schema {
        video_model::speech::SPEECH_SCHEMA => video_model::speech::speech_body_problems(input.body),
        video_model::translation::TRANSLATION_SCHEMA => video_model::translation::translation_body_problems(input.body),
        video_model::editorial_proposal::EDITORIAL_PROPOSAL_SCHEMA => {
            video_model::editorial_proposal::editorial_proposal_body_problems(input.body)
        }
        s if video_model::caption_style::is_boxed_style_schema(s) => video_model::caption_style::caption_style_body_problems(input.body),
        _ => Vec::new(),
    };
    if !problems.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.bodyNotSchema",
            "The body does not match {schema}: {problems}",
            schema,
            problems = message_ref::join(problems)
        )));
    }
    let source_asset_id = match input.source_asset {
        Some(AssetTarget::Id { asset_id }) => Some(asset_id.clone()),
        Some(AssetTarget::Ref { reference }) => Some(
            ctx.refs
                .get(reference)
                .cloned()
                .ok_or_else(|| ErrorBody::invalid_operation(msg!(
                "engine.importRefMissing",
                "There is no import named {reference}",
                reference
            )))?,
        ),
        None => None,
    };
    if let Some(id) = &source_asset_id
        && !state.assets.contains_key(id)
    {
        return Err(ErrorBody::not_found(kinds::asset(), id));
    }
    // 剪口集合（§6.7）：刻度、排序与不重叠；知道被剪素材的时长时剪口不超过它。
    if schema == video_model::cut_set::CUT_SET_SCHEMA {
        let asset_id = source_asset_id.as_deref().or_else(|| {
            input
                .document_id
                .and_then(|id| state.documents.get(id))
                .and_then(|d| d.source_asset_id.as_deref())
        });
        let duration = match asset_id.and_then(|id| state.assets.get(id)) {
            Some(asset) => asset.revisions[&asset.current_revision]
                .duration
                .as_ref()
                .map(|d| d.to_ratio("duration"))
                .transpose()?,
            None => None,
        };
        let problems = video_model::cut_set::cut_set_body_problems(input.body, duration);
        if !problems.is_empty() {
            return Err(ErrorBody::invalid_operation(msg!(
            "engine.bodyNotSchema",
            "The body does not match {schema}: {problems}",
            schema,
            problems = message_ref::join(problems)
        )));
        }
    }
    let source_document_id = match input.source_document {
        Some(DocumentTarget::Id { document_id }) => Some(document_id.clone()),
        Some(DocumentTarget::Ref { reference }) => Some(
            ctx.document_refs
                .get(reference)
                .cloned()
                .ok_or_else(|| ErrorBody::invalid_operation(msg!(
                        "engine.documentRefMissing",
                        "There is no document named {reference}",
                        reference
                    )))?,
        ),
        None => None,
    };
    if let Some(id) = &source_document_id
        && !state.documents.contains_key(id)
    {
        return Err(ErrorBody::not_found(kinds::document(), id));
    }

    // 正文按键有序的 JSON 保存，摘要与写法无关。
    let text = crate::video::canonical_json(input.body);
    let content_hash = crate::video::sha256_text(&text);
    let (id, revision) = match input.document_id {
        Some(id) => {
            let existing = state.documents.get(id).ok_or_else(|| ErrorBody::not_found(kinds::document(), id))?;
            if existing.kind != kind {
                return Err(ErrorBody::invalid_operation(msg!(
                    "engine.documentKindFixed",
                    "The kind of an existing document cannot change"
                )).entities([id]));
            }
            // 内容没变：不产生新版本。
            if existing
                .revisions
                .get(&existing.current_revision)
                .is_some_and(|r| r.content_hash == content_hash)
            {
                if let Some(r) = input.reference {
                    ctx.document_refs.insert(r.to_string(), id.to_string());
                }
                return Ok(());
            }
            let latest = existing.revisions.keys().filter_map(|r| r.parse::<u64>().ok()).max().unwrap_or(0);
            let next = latest.max(ctx.document_revision_floor.get(id).copied().unwrap_or(0)) + 1;
            (id.to_string(), next.to_string())
        }
        None => (new_id("doc"), "1".to_string()),
    };
    let record = state.documents.entry(id.clone()).or_insert_with(|| DocumentRecord {
        id: id.clone(),
        kind: kind.to_string(),
        name: String::new(),
        language: None,
        source_asset_id: None,
        source_document_id: None,
        current_revision: revision.clone(),
        revisions: BTreeMap::new(),
        extensions: BTreeMap::new(),
    });
    if let Some(name) = input.name {
        record.name = clean_name(name, kinds::document())?;
    } else if record.name.is_empty() {
        record.name = kind.to_string();
    }
    if let Some(language) = input.language {
        record.language = Some(language.to_string());
    }
    if source_asset_id.is_some() {
        record.source_asset_id = source_asset_id;
    }
    if source_document_id.is_some() {
        record.source_document_id = source_document_id;
    }
    for (key, value) in input.extensions {
        record.extensions.insert(key.clone(), value.clone());
    }
    record.current_revision = revision.clone();
    record.revisions.insert(
        revision.clone(),
        DocumentRevision {
            revision: revision.clone(),
            content_hash: content_hash.clone(),
            byte_length: text.len() as u64,
            created_at: ctx.now.to_string(),
            created_by: ctx.transaction_id.to_string(),
            summary: input.summary.cloned(),
        },
    );
    ctx.documents.push(DocumentBody {
        document_id: id.clone(),
        revision,
        content_hash,
        body: text,
    });
    if let Some(r) = input.reference {
        ctx.document_refs.insert(r.to_string(), id);
    }
    Ok(())
}

/// 同一轨道上的实例不能重叠。只检查这笔事务涉及的序列。
pub fn check_overlaps(state: &VideoState, sequence_id: &str) -> EngineResult<()> {
    let fps = state.sequence(sequence_id)?.header.fps;
    let mut by_track: BTreeMap<&str, Vec<(Ratio, Ratio, &str)>> = BTreeMap::new();
    for placed in state.items.values().filter(|i| i.sequence_id == sequence_id) {
        let (start, end) = item_range(&placed.value, fps)?;
        by_track
            .entry(placed.value.base().track_id.as_str())
            .or_default()
            .push((start, end, placed.value.base().id.as_str()));
    }
    for ranges in by_track.values_mut() {
        ranges.sort();
        for pair in ranges.windows(2) {
            if pair[1].0 < pair[0].1 {
                return Err(ErrorBody::overlap(vec![pair[0].2.to_string(), pair[1].2.to_string()]));
            }
        }
    }
    Ok(())
}

//! 局部更新经过真实持久化、版本校验、撤销和幂等；无需媒体工具。
use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind};
use video_engine::{CreateOptions, UndoRequest, UndoTarget, Video, VideoTransaction};

fn actor() -> Actor {
    Actor {
        kind: ActorKind::User,
        id: "user_local".into(),
    }
}
fn tx(video: &Video, id: &str, operations: Vec<Value>) -> VideoTransaction {
    VideoTransaction {
        command_id: id.into(),
        expected_revision: video.revision(),
        label: None,
        label_ref: None,
        operations,
        actor: actor(),
        task_id: None,
    }
}
fn setup() -> (tempfile::TempDir, Video, String, Value) {
    let dir = tempfile::tempdir().unwrap();
    let mut video = Video::create(
        dir.path(),
        &CreateOptions {
            name: "test".into(),
            fps: Rate { num: 30, den: 1 },
            width: 1920,
            height: 1080,
        },
        std::path::Path::new("ffprobe"),
    )
    .unwrap();
    let body = json!({
        "schema": "baocut.speech/1", "clock": "source-asset", "timescale": 1000,
        "speakers": [{"id":"spk-1","name":"Speaker 1","hue":15},{"id":"spk-2","name":"Speaker 2"},{"id":"spk-3","name":"Speaker 3"},{"id":"spk-4","name":"Speaker 4"},{"id":"spk-5","name":"Speaker 5"}],
        "words": (0..26711).map(|i| json!({"id":format!("w{i}"),"text":"original","start":i*100,"end":i*100+90,"speaker":"spk-1","extra":"preserve unknown extension fields"})).collect::<Vec<_>>(),
        "sentences": null, "extensions":{"custom":true}
    });
    assert!(serde_json::to_vec(&body).unwrap().len() > 2_770_000);
    video
        .apply(&tx(
            &video,
            "cmd_create",
            vec![json!({"type":"putDocument","ref":"speech","kind":"speech","body":body,"summary":{"wordCount":26711}})],
        ))
        .unwrap();
    let id = video.state().documents.keys().next().unwrap().clone();
    (dir, video, id, body)
}

#[test]
fn long_transcript_names_persist_replay_undo_and_do_not_change_words() {
    let (_dir, mut video, id, body) = setup();
    let rename = tx(
        &video,
        "cmd_rename",
        vec![
            json!({"type":"renameSpeakers","documentId":id,"speakers":[{"id":"spk-1","name":"Mark Zuckerberg"},{"id":"spk-2","name":"John Collison"},{"id":"spk-3","name":"Alexandr Wang"}]}),
        ],
    );
    let result = video.apply(&rename).unwrap();
    let updated = video.document(&id, None).unwrap().body;
    assert_eq!(updated["words"], body["words"]);
    assert_eq!(updated["speakers"][0]["name"], "Mark Zuckerberg");
    assert_eq!(updated["speakers"][3], body["speakers"][3]);
    assert_eq!(updated["extensions"], body["extensions"]);
    assert_eq!(
        video.state().documents[&id].revisions["2"].summary,
        Some(json!({"wordCount":26711}))
    );
    assert!(result.receipt.impact.translation_units_stale.is_empty());
    assert_eq!(video.apply(&rename).unwrap().receipt.transaction_id, result.receipt.transaction_id);
    let mut stale = rename.clone();
    stale.command_id = "cmd_stale".into();
    assert_eq!(video.apply(&stale).unwrap_err().code, "PROJECT_REVISION_CONFLICT");
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Transaction(result.receipt.transaction_id),
            actor: actor(),
            expected_revision: None,
        })
        .unwrap();
    assert_eq!(video.document(&id, None).unwrap().body, body);
    video.apply(&tx(&video, "cmd_again", rename.operations)).unwrap();
    assert_eq!(video.state().documents[&id].current_revision, "3");
}

#[test]
fn unknown_duplicate_or_invalid_ids_reject_the_entire_transaction() {
    let (_dir, mut video, id, body) = setup();
    for (i, speakers) in [
        json!([{"id":"spk-1","name":"new"},{"id":"missing","name":"bad"}]),
        json!([{"id":"spk-1","name":"new"},{"id":"spk-1","name":"duplicate"}]),
        json!([{"id":"spk-1","name":" "}]),
    ]
    .into_iter()
    .enumerate()
    {
        let revision = video.revision();
        assert!(
            video
                .apply(&tx(
                    &video,
                    &format!("cmd_invalid_{i}"),
                    vec![json!({"type":"renameSpeakers","documentId":id,"speakers":speakers})]
                ))
                .is_err()
        );
        assert_eq!(video.revision(), revision);
        assert_eq!(video.document(&id, None).unwrap().body, body);
    }
}

#[test]
fn text_and_generic_changes_compose_in_one_transaction_and_preserve_unknown_fields() {
    let (_dir, mut video, id, body) = setup();
    video.apply(&tx(&video,"cmd_edit",vec![
        json!({"type":"renameSpeakers","documentId":id,"speakers":[{"id":"spk-1","name":"Mark Zuckerberg"}]}),
        json!({"type":"updateWords","documentId":id,"words":[{"id":"w12000","text":"corrected"}]}),
        json!({"type":"patchDocument","documentId":id,"changes":[{"path":["speakers",{"id":"spk-1"},"hue"],"value":null},{"path":["extensions","custom"],"remove":true}]}),
    ])).unwrap();
    let updated = video.document(&id, None).unwrap().body;
    assert_eq!(updated["speakers"][0]["name"], "Mark Zuckerberg");
    assert_eq!(updated["speakers"][0]["hue"], Value::Null);
    let mut expected = body["words"].clone();
    expected[12000]["text"] = json!("corrected");
    assert_eq!(updated["words"], expected);
    assert_eq!(updated["extensions"], json!({}));
}

#[test]
fn an_id_field_outside_keyed_entries_is_an_ordinary_field() {
    let (_dir, mut video, id, _body) = setup();
    video
        .apply(&tx(
            &video,
            "cmd_add_preset",
            vec![json!({"type":"patchDocument","documentId":id,"changes":[{"path":["extensions","preset"],"value":{"id":"daoyazi","revision":1}}]})],
        ))
        .unwrap();
    // 换字幕样式时只改 `stylePreset.id` 这一类字段：它不是条目身份，不能整笔拒绝。
    video
        .apply(&tx(
            &video,
            "cmd_switch_preset",
            vec![json!({"type":"patchDocument","documentId":id,"changes":[{"path":["extensions","preset","id"],"value":"studio-ktv"}]})],
        ))
        .unwrap();
    assert_eq!(
        video.document(&id, None).unwrap().body["extensions"]["preset"],
        json!({"id":"studio-ktv","revision":1})
    );
}

#[test]
fn keyed_array_insert_remove_and_move_preserve_other_entries() {
    let (_dir, mut video, id, _body) = setup();
    video
        .apply(&tx(
            &video,
            "cmd_structure",
            vec![json!({"type":"patchDocument","documentId":id,"changes":[
                {"path":["words",{"id":"w0"}],"remove":true},
                {"path":["words",{"id":"w3"}],"moveBefore":"w1"},
                {"path":["words",{"id":"new"}],"value":{"id":"new","text":"inserted"},"beforeId":"w2"}
            ]})],
        ))
        .unwrap();
    let body = video.document(&id, None).unwrap().body;
    assert_eq!(body["words"][0]["id"], "w3");
    assert_eq!(body["words"][1]["id"], "w1");
    assert_eq!(body["words"][2]["id"], "new");
    assert_eq!(body["words"][3]["id"], "w2");
    assert_eq!(body["words"].as_array().unwrap().len(), 26711);
}

#[test]
fn no_op_and_malformed_changes_keep_the_current_document_version() {
    let (_dir, mut video, id, body) = setup();
    video
        .apply(&tx(
            &video,
            "cmd_noop",
            vec![json!({"type":"renameSpeakers","documentId":id,"speakers":[{"id":"spk-1","name":"Speaker 1"}]})],
        ))
        .unwrap();
    assert_eq!(video.state().documents[&id].current_revision, "1");
    let invalid_changes = [
        json!([]),
        json!([{"path":[],"value":{}}]),
        json!([{"path":["missing","text"],"value":"wrong"}]),
        json!([{"path":["words",{"id":"w0"},"id"],"value":"changed"}]),
        json!([{"path":["words",{"id":"w0"},"id"],"remove":true}]),
        json!([{"path":["words",{"id":"w0"},"text"],"value":"wrong","remove":true}]),
        json!([{"path":["words",{"id":"w0"}],"moveBefore":"missing"}]),
        json!([{"path":["userBreaks"],"value":{"w0":"invalid-pin"}}]),
    ];
    for (i, changes) in invalid_changes.into_iter().enumerate() {
        let revision = video.revision();
        assert!(
            video
                .apply(&tx(
                    &video,
                    &format!("cmd_invalid_patch_{i}"),
                    vec![json!({"type":"patchDocument","documentId":id,"changes":changes})]
                ))
                .is_err()
        );
        assert_eq!(video.revision(), revision);
        assert_eq!(video.document(&id, None).unwrap().body, body);
    }
}

#[test]
fn translation_text_updates_refresh_sentence_hash_and_drop_reuse_without_changing_other_units() {
    let (_dir, mut video, speech_id, _) = setup();
    let unit = |id: &str, correspondence: &str| json!({"id":id,"sourceSentenceId":"sentence","sourceFingerprint":"fingerprint","naturalText":"old","status":"reviewed","alignment":{"basis":"natural","correspondence":correspondence,"blocks":[],"sourceWordIds":["w0"],"textHash":video_engine::video::sha256_text("old")},"reuse":{"fromVideoId":"vid_other","unitId":id}});
    let body =
        json!({"schema":"baocut.translation/2","language":"en","units":[unit("u1","sentence"),unit("u2","sentence"),unit("u3","block")]});
    let created = video.apply(&tx(&video,"cmd_translation",vec![json!({"type":"putDocument","kind":"translation","ref":"translation","sourceDocument":{"documentId":speech_id},"body":body})])).unwrap();
    let id = created.receipt.refs["translation"].clone();
    video
        .apply(&tx(
            &video,
            "cmd_translation_patch",
            vec![json!({"type":"patchDocument","documentId":id,"changes":[
                {"path":["units",{"id":"u1"},"naturalText"],"value":"new"},
                {"path":["units",{"id":"u3"},"naturalText"],"value":"new"}
            ]})],
        ))
        .unwrap();
    let updated = video.document(&id, None).unwrap().body;
    assert_eq!(
        updated["units"][0]["alignment"]["textHash"],
        video_engine::video::sha256_text("new")
    );
    assert_eq!(
        updated["units"][0]["alignment"]["sourceWordIds"],
        body["units"][0]["alignment"]["sourceWordIds"]
    );
    assert_eq!(updated["units"][1], body["units"][1]);
    assert_eq!(updated["units"][2]["alignment"], body["units"][2]["alignment"]);
    // 改过自然译句的单元不再是沿用的译文；没改的照旧（§5.3）。
    assert!(updated["units"][0].get("reuse").is_none());
    assert!(updated["units"][2].get("reuse").is_none());
    assert_eq!(updated["units"][1]["reuse"], json!({"fromVideoId":"vid_other","unitId":"u2"}));
}

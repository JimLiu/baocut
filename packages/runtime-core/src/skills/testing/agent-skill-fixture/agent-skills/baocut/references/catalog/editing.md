---
name: 剪辑
description: edits apply 的操作族、剪口播、章节、撤销与读回执。
---

# 剪辑

一笔修改用 {{tool:edits_apply}}，要操作的字段时用 {{tool:edits_ops}} 取。剪口播的做法见 {{skill:demo-polish}}。

## 常用操作

<!-- generated: common-ops -->
**导入素材**（`importAsset`）：把媒体文件登记为视频的素材。

```json
{"type":"importAsset","path":"demo.mp4","ref":"clip"}
```

**放素材**（`addItem`）：把素材放到时间线上；省略 at 时接在轨道末尾，省略 trackId 时用第一条未锁定的同类轨道（视频、图片放视觉轨，音频放音频轨）。

```json
{"type":"addItem","asset":{"ref":"clip"},"at":1}
```

**裁剪**（`trimItem`）：裁切片段的开头或结尾，at 是这条边在时间线上的新位置。

```json
{"type":"trimItem","itemId":"item_1","edge":"end","at":8}
```

**挪动**（`moveItem`）：移动片段；at 是新的开始时间，offset 是相对移动（可为负），二选一。

```json
{"type":"moveItem","itemId":"item_1","at":5}
```

**删除**（`deleteItems`）：删除片段（不移动其他片段，留下空隙）。

```json
{"type":"deleteItems","itemIds":["item_1"]}
```

**分割**（`splitItem`）：在时间线上的这个位置把片段一分为二；关键帧按两半各自的窗口分开，裁切时关键帧跟着内容走。

```json
{"type":"splitItem","itemId":"item_1","at":3.5}
```

**调音量**（`setAudioMix`）：改音频、视频或有声合成的声音；volume 是线性倍数，在 0 到 4，1 为原音量（0.5 约 -6 dB，2 约 +6 dB）；淡变 0 表示去掉。

```json
{"type":"setAudioMix","itemId":"item_1","volume":0.5,"fadeOut":1}
```

**改文字**（`setText`）：改文字片段的文字，或改成计时读数；两者只给一个。

```json
{"type":"setText","itemId":"item_1","text":"第一章"}
```

字幕层用 {{tool:captions_create}} 建，不是这里的操作；剪掉一段并让后面前移用 `removeRange`，口播的剪口用 `addCuts`。其余操作与每个字段的写法用 {{tool:edits_ops}} 取。
<!-- /generated -->

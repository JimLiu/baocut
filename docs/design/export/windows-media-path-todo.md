# Windows 导出媒体路径待办

成片导出（`export-worker render`，架构设计 §9.11）在 Windows 上的原生解码、编码与调度优先级尚有以下缺口。2026-10-15 已在 Windows 11 / RTX 3060 上运行现有测试、1080p 双语字幕导出与 EcoQoS 检查，发现媒体正确性和 GOP 合同未通过，不能把整个 Windows 路径记为完成；环境、失败值与复现命令见 [Windows 实机验证记录](../../acceptance/windows-validation.md)。macOS 一侧的性能整理结果见验收与测试 §4。

涉及的代码：

- 解码：`crates/media-native/src/windows.rs`（Media Foundation Source Reader，输出 NV12）与 `yuv.rs`（NV12 → RGBA 的纯函数）；
- 编码：`crates/media-native/src/encode_windows.rs`（Media Foundation Sink Writer，H.264）；
- 调度优先级：`crates/export-worker/src/priority.rs` 的 `#[cfg(windows)]` 分支；
- 平台无关的顺序流与缓冲轮换：`crates/media-native/src/frames.rs`（`FrameSource`、`SequentialDecoder`）。

现状：CI 的测试只在 Ubuntu 上跑（`.github/workflows/tests.yml`），Windows 只有打包工作流（`desktop-windows.yml`）。本机已用 MSVC 原生构建并运行这些 `cfg(windows)` 路径；这次没有重打发布包，不能替代 Windows 安装包验收。

## 待办

| # | 事项 | 像素 | 优先 | 状态（2026-10-15） |
| --- | --- | --- | --- | --- |
| W1 | 解码直接写进调用方的缓冲 | 不变 | 高 | 已实现：两条路径逐字节相同（`frame_stream` 集成测试）；交替 5 次的中位数 cover 125 → 135 fps、contain 120 → 124 fps |
| W2 | `copy_rows` 去掉逐像素的旋转分支 | 不变 | 高 | 已实现（落在 W8 的 NV12 换算上）：逐行换算 + AVX2 运行时选用，1080p 一帧 7.85 → 1.03 ms，与逐像素实现逐字节相同 |
| W3 | 编码输入直接写进 Media Foundation 的缓冲 | 不变 | 中 | 已实现：换算直接写进 MF 缓冲，省掉每帧一次暂存与整帧拷贝；换算挪进 `yuv.rs`，补随机图像对拍 |
| W4 | 在 Windows 上验证 EcoQoS 的关闭 | 不变 | 高 | 部分通过：原生 API 回读、24 忙进程交替对比通过；真实应用最小化 / 切后台待测 |
| W5 | 解码走硬件（D3D11） | 实测不变 | 中 | 已实现，用户 2026-10-15 确认缺省开启（`BAOCUT_MEDIA_HW_DECODE=0` 关掉）：H.264 / HEVC 8 位 / 10 位与软件解码逐字节相同，解码的 CPU 时间约降九成；4K 源受 CPU 缩放所限 |
| W6 | 编码的节流与低延迟开关 | 码流会变 | 中 | 待 A/B，未启用候选开关 |
| W7 | 三家显卡的硬件编码器兼容 | 码流会变 | 高 | NVIDIA 通过：RTX 3060 实测选中 `NVIDIA H.264 Encoder MFT`（硬件，`done.video.encoderDevice` 报出），GOP 经编码器参数改为 2 秒；软件编码器不再出 B 帧（修首帧晚一帧）；AMD / Intel 与回落待测 |
| W8 | 修复原生媒体测试的实机失败 | 有标注的素材会变 | 高 | 已修复：5 项全部通过，阈值未动；三个根因见下文 |
| W9 | 合成线程的整帧拷贝与分配 | 不变 | 高 | 已实现：Windows 全局分配器（空闲时 1080p 双语字幕 cover 118 → 138 fps、contain 112 → 130 fps）；解出的画面共享给帧光栅、内核画布跨帧复用（空闲时再快 1.08–1.09 倍）；满载都没有一致的方向。这之后分配器不再划算，已拿掉（空闲、满载都持平）。合成上 GPU 另有[方案稿](gpu-compositing.md) |
| W10 | 编码改成恒定质量 | 码流会变 | 高 | 待做：macOS 已改（2026-11-05），Windows 仍按码率曲线给平均码率，平稳的素材大出好几倍 |

### W1 解码直接写进调用方的缓冲

- 问题：`SourceReaderFrames` 没有覆盖 `FrameSource::next_decoded_into`，走 `frames.rs` 的缺省实现：每帧先在 `copy_rows` 里 `vec![0_u8; w * h * 4]` 新分配一帧（1080p 是 8,294,400 字节），再换进调用方的缓冲。成片导出逐帧都这样分配、清零一遍。
- 做法：照 `macos.rs` 的 `next_decoded_into` 覆盖它。`sample_to_rgba` 与 `copy_rows` 改成写进 `&mut Vec<u8>`（`data.resize(w * h * 4, 0)` 后逐行写），`next_decoded` 保留为对它的薄包装，单帧抽取（`extract_frame_rgba`）不受影响。seek 后早于起点的帧照旧在搬像素之前跳过。
- 验证：同一个源、同一个起点，新旧两条路径解出的前 N 帧逐字节相同（见下文「验证」的等价测试）。
- 2026-10-15 已实现（W8 之后，Reader 交的是 NV12）：`SourceReaderFrames::next_decoded_into` 把 NV12 直接换算进调用方的缓冲（尺寸对时 `resize` 不清零），`next_decoded` 是对它的薄包装。`frame_stream.rs` 的 `decoding_into_a_reused_buffer_matches_the_allocating_path_byte_for_byte` 从 0 与 1.5 秒起，把帧流（`next_decoded`）与始终复用一块缓冲的顺序解码器（`next_decoded_into`）逐帧对比，帧数与每帧字节都相同；这条测试不带平台条件，macOS 上同样比对自己的两条路径。Bench（`export-bench --baseline` 为 W7 的 Worker，20 秒、各 5 次交替，机器上有别的会话在跑）：cover 125.4 → 135.1 fps（1.08），contain 119.7 → 124.3 fps（1.04），10 对里 9 对更快。

### W2 `copy_rows` 去掉逐像素的旋转分支

- 问题：`copy_rows` 的内层循环对每个像素做一次 `match rotation`、四次单字节写，编译器没法向量化。绝大多数素材不旋转。
- 做法：把旋转分支提到循环外；`rotation == 0` 时按行把 BGRX 换成 RGBA（`chunks_exact(4)` 逐像素换序、alpha 写 255），与 macOS 的 `swizzle_bgra_to_rgba_row` 同一个形状。旋转的三种情况保持逐像素，但各自一条循环。
- 把这段纯函数挪到不带 `cfg(windows)` 的模块里（只吃字节切片、步长和旋转角），macOS 与 CI 上就能跑它的单元测试。
- 2026-10-15 已实现，形状随 W8 变了：Reader 改交 NV12 之后 `copy_rows` 不在了，逐像素的旋转分支挪到了 `yuv.rs` 的 `nv12_to_rgba` 里，这里改的是它。逐行换算（`convert_row`），每对像素共用的色度项只算一次；不转的直接写进输出行，转的先换进一行暂存、按角度各自一条循环摆到位。x86-64 的缺省目标只到 SSE2，32 位整数乘法向量化不了，同一份代码再按 AVX2（`#[target_feature]`）编一遍、运行时检测后选用。1080p 一帧（i7-12700F，release）：原逐像素 7.85 ms，逐行通用版 4.77 ms，AVX2 版 1.03 ms；转 180° 1.09 ms，转 90° 3.26 ms（按列写）。`yuv.rs` 的对拍测试保留原逐像素实现作参照，随机平面、7 种奇偶宽高、行距大于宽度、四种旋转加非法角度、4 种矩阵 × 2 种范围，通用版与 AVX2 版都逐字节相同；不带平台条件，CI 上跑。

### W3 编码输入直接写进 Media Foundation 的缓冲

- 问题：`SinkWriter::write_frame` 先用 `rgba_to_nv12` 把一帧转进 `staging`，`sample_from_bytes` 再 `MFCreateMemoryBuffer` 新建一块缓冲、把 `staging` 整帧拷进去。每帧多一次分配和一次整帧拷贝（NV12 约 3.1 MB；RGB32 回落时 8.3 MB）。
- 做法：先建缓冲、`Lock`，`rgba_to_nv12`（或 RGB32 的倒行换序）直接写进锁住的内存，`Unlock` 后 `SetCurrentLength`。Sink Writer 可能异步持有 sample，所以缓冲不要跨帧复用，除非改成按 sample 释放回调的缓冲池；每帧新建但直接写入已经省掉那次拷贝。`staging` 字段随之去掉。音频块的 `sample_from_bytes` 用法不变。
- `rgba_to_nv12` 是标量实现。若再要提速可改 SIMD，但必须与现有实现逐字节相同（现有的单元测试只覆盖黑白两色，改之前先补随机图像的对拍测试）。
- 2026-10-15 已实现：`sample_filled_with` 新建缓冲、锁住，`rgba_to_nv12` 或 RGB32 回落的 `rgba_to_bottom_up_bgrx` 直接写进去，`staging` 去掉；音频仍走 `sample_from_bytes`（现在是它的薄包装）。两个换算挪进不带平台条件的 `yuv.rs`，CI 上跑：黑白锚点、随机图像与按坐标逐个算的参照逐字节对拍（4 种尺寸），RGB32 的倒行与换序。编码器的输入字节与改动前相同（同一个函数，只换了目的地）；原生编码器的输出随出帧节奏变，不拿成片逐帧比。试过把 `rgba_to_nv12` 按 AVX2 再编一份（W2 的做法），1080p 一帧反而从约 2.9 ms 慢到约 3.5 ms，没有采用；要提速得换循环的形状。

### W4 在 Windows 上验证 EcoQoS 的关闭

- `priority.rs` 在 Windows 上调用 `SetProcessInformation(ProcessPowerThrottling)`，关掉本进程的执行速度节流。原生实测先开启节流，再调用实际入口，`GetProcessInformation` 回读 `ControlMask=1`、`StateMask=0`，API 关闭行为通过；负载对比见 [Windows 实机验证记录 §2](../../acceptance/windows-validation.md#2-结果)。
- 要确认：调用返回成功（失败时 stderr 有 `cannot opt out of power throttling`）；Worker 在应用最小化、切到后台时导出不降速；同一个构建用 `BAOCUT_EXPORT_PRIORITY=0` 对比，有负载时开着不慢于关着。macOS 上 12 个忙进程时出现过开着反而慢的情况（验收与测试 §4「导出的调度优先级」），Windows 也要在超过核数的负载下量一次。

### W5 解码走硬件（D3D11）

- 问题：Source Reader 只设了 `MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING`，没有给 `MF_SOURCE_READER_D3D_MANAGER`（`IMFDXGIDeviceManager`），也没设 `MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS`。按 Media Foundation 的文档，这样解码与 YUV→RGB32 转换都在 CPU 上做；在真机上还没确认。
- 做法：建 D3D11 设备与 DXGI 设备管理器交给 Reader，打开硬件转换。输出仍要 CPU 可读：要么让视频处理器输出 RGB32 系统内存样本，要么取 NV12 后自己转 RGBA。建设备或协商格式失败时回落现在的软件路径，并在 `done.video` 里报出后端与回落原因（架构设计 §9.6：硬件路径必须协商并报告）。
- 像素会变（解码器与颜色转换换了实现），合入前要用户确认。跨后端只承诺容差（`frames.rs` 文件头：灰度 SSIM ≥ 0.95），不能用逐字节比对验收。
- 2026-10-15 实现，用户确认后合入、缺省开启：
  - 做法：`open_sequential_decoder` 缺省先试显卡（环境变量 `BAOCUT_MEDIA_HW_DECODE=0` 关掉，A/B 与排查用）；单帧抽取与 `FrameStream` 不试。建只要真显卡的 D3D11 设备（带视频支持、多线程保护）与 DXGI 设备管理器，交给 Reader（`MF_SOURCE_READER_D3D_MANAGER`）并打开 `MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS`，仍请求 NV12。显存里的 NV12 样本自己读回：拷进常驻的暂存纹理、`Map` 后用 W8 的同一个换算函数换成 RGBA；不是 NV12 的纹理（P010）退回 Media Foundation 的 `Lock2DSize`。Media Foundation 自己的 `Lock2DSize` 在显存样本上每帧另建暂存，1080p 顺序解码被压在约 100 fps，所以不用它。建设备、交管理器或协商 NV12 失败就回落软件 Reader；第一帧解出来时按样本在不在显存里判定实际走了哪条路，报进 `done.video.decoderDevices`（`[{ name, hardware, fallback? }]`，每种一条）。
  - 像素：W8 之后两条路径都是「解码器交 NV12 → 本 crate 换 RGBA」，H.264 与 HEVC 的解码按标准逐位确定，所以不变。实测 1080p H.264、4K H.264（250 Mb/s）、4K HEVC Main 与 Main10 各 300 帧，显卡与软件解码交出的 RGBA 逐帧逐字节相同（SSIM 无从算起，差为 0）；`windows.rs` 的单元测试在 640×360 的 B 帧 H.264 上从 0.5 秒起逐帧比对。原 TODO 预计「像素会变」是按让视频处理器换 RGB32 的做法估的。
  - 解码本身（`SequentialDecoder` 一路读到底、含读回与换算，单线程，进程总 CPU 时间）：1080p H.264 软件 244 fps / 10.9 CPU 秒、显卡 255 fps / 1.45 CPU 秒；4K H.264 250 Mb/s 软件 50 fps / 44 CPU 秒、显卡 80 fps / 4.2 CPU 秒；4K HEVC Main 软件 95 fps / 24.8 CPU 秒、显卡 135 fps / 2.35 CPU 秒；4K HEVC Main10 软件约 80 fps / 30 CPU 秒、显卡约 65 fps / 31 CPU 秒（P010 纹理退回 `Lock2DSize`，没有收益）。
  - 导出（`export-bench`，对照 W3 的软件解码 Worker）：1080p 夹具空闲时 cover 155.7 → 162.4 fps（1.04）、contain 170.3 → 186.2 fps（1.09），10 对全快；24 个忙进程时逐次 19–54 fps，中位数 cover 0.98、contain 1.16，没有一致结论。4K 源导出成 1080p：H.264 250 Mb/s 27.8 → 30.3 fps（1.09），HEVC Main 31.7 → 31.2 fps（0.99）。4K 源卡在解码线程上 CPU 的 4K → 1080p 盒式缩放（`scale::resize_rgba`，一帧约 19 ms）：Windows 的 Reader 不在解码链路里缩放，macOS 的 AVFoundation 会。
  - 余下：P010（10 位 HEVC）自己读回换算；4K 源的缩放挪到显卡（D3D11 视频处理器在读回前缩到交付尺寸，读回量也少四倍）或给 2:1 的盒式缩放写快路径；AMD / Intel 显卡与无 D3D11 视频支持时的回落待测。

### W6 编码的节流与低延迟开关

- macOS 上把写入器视频轨声明为实时源后，12 个忙进程时从 59 fps 到 183 fps（验收与测试 §4「视频轨声明为实时源」）：机器忙时编码管线排队，合成线程等编码。
- Windows 上对应的候选：Sink Writer 的 `MF_SINK_WRITER_DISABLE_THROTTLING`，编码器的 `CODECAPI_AVLowLatencyMode`。两者都要在 Windows 满载下 A/B，先确认瓶颈确实在编码排队，再决定开哪个。
- 低延迟模式可能改变编码器的帧类型与码控，输出码流会变；画质合同（码率、GOP、profile）不能悄悄变，开之前用 ffprobe 核对。

### W7 三家显卡的硬件编码器兼容

- `MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS = 1` 允许 Sink Writer 选择显卡驱动提供的 H.264 编码 MFT（NVIDIA NVENC、AMD AMF、Intel Quick Sync），没有时回落微软的软件编码器。RTX 3060 主机的 MF 导出与 ffprobe 已实测：High、BT.709、300 帧和 30 fps 正确，GOP 却为 30 帧而非要求的 60 帧；faststart 明确回落且 `moov` 在 `mdat` 后。
- 2026-10-15 补齐：写入器在 `BeginWriting` 之后用 `IMFSinkWriterEx::GetTransformForStream` 找到视频编码 MFT，读它的 `MFT_FRIENDLY_NAME_Attribute` 与 `MFT_ENUM_HARDWARE_URL_Attribute`，经 `Mp4Writer::encoder` 报进 `done.video.encoderDevice`（`{ name, hardware }`；微软的软件编码器没有友好名，按 CLSID 认作 `Microsoft H.264 Encoder MFT`）。RTX 3060 上 1080p、720p、360p 选中的都是 `NVIDIA H.264 Encoder MFT`（硬件）；64×36 这类 NVENC 不收的小画面落到微软的软件编码器。
- GOP 的原因：NVIDIA 的 MFT 不看输出类型上的 `MF_MT_MAX_KEYFRAME_SPACING`，720p 及以上每 30 帧一个关键帧（360p 时恰好是 60），经 `SetInputMediaType` 的编码器参数给 `CODECAPI_AVEncMPVGOPSize` 后 1080p / 720p 都是每 60 帧。同一处给 `CODECAPI_AVEncMPVDefaultBPictureCount = 0`：微软的软件编码器缺省出 B 帧，MP4 Sink 写组合时间偏移却不写编辑表，画面整体晚一帧开始（`start_time` 0.0333 秒，声音从 0 开始）；关掉后 `start_time` 为 0。NVIDIA 的 MFT 本来不出 B 帧，码流不变；软件编码器的码流会变（没有 B 帧，同码率下压缩率略低）。
- 每家各一台机器，导出同一个工程，用 `ffprobe -show_streams -show_frames` 核对：profile 为 High、关键帧间隔等于 `KEYFRAME_INTERVAL_SECONDS` 换算的帧数、BT.709 的 VUI、码率接近设定、faststart 探测的结果与 moov 位置。再核对回落时 `done.video` 报出的后端与原因。
- 驱动缺失或编码 MFT 初始化失败时应能回落，不能让导出失败而不报原因。

### W8 修复原生媒体测试的实机失败

现有单帧、顺序流和写入器测试在 Windows 上分别失败 2、2、1 项；具体测试名、实测值和后续检查见 [Windows 实机验证记录 §3](../../acceptance/windows-validation.md#3-失败与后续事项)。先定位 sample 时间戳、颜色转换、EOF 与容器时基的实际行为，再做 W1–W3 的像素等价优化；不得通过放宽阈值或把失败改成跳过来更新完成状态。W7 的 GOP 差异仍归 W7。

2026-10-15 定位并修复，三个根因互不相干，阈值与断言都没动：

- **时间戳晚两帧**（边界串段、从 0.5 秒起多 2 帧）：Media Foundation 的 MPEG-4 源不应用视频轨的编辑表。libx264 缺省两级 B 帧，`elst` 的 `media_time` 是两帧（时标 15360 下 1024），MF 报的首帧时刻是 0.0667 秒而 ffmpeg 与 AVFoundation 是 0。修法：`media_probe::video_edit_start` 读第一条视频轨的编辑起点，交出的时间戳减去它、seek 目标加上它。
- **颜色矩阵错**（SSIM 0.79–0.81）：让 Source Reader 直接交 RGB32 时，MF 的视频处理器不看码流标注，按画面高度猜矩阵（576 行及以下 BT.601，以上 BT.709）；夹具是 320×180 的 BT.709，红色被按 BT.601 换成 0.914 倍。解码器自己在第一个样本（`CURRENTMEDIATYPECHANGED`）之后报出码流的矩阵、量化范围、对齐后的平面高度（1080 → 1088）与显示孔径。修法：Reader 改交 NV12，按解码器报的布局与颜色在 CPU 上换 RGBA（`yuv.rs`，定点系数，色度最近邻上采样）；码流没标矩阵时沿用 MF 的按高度推定。修后 SSIM 0.97–0.99、逐通道最大偏差 2–5。
- **NTSC 读回 29.9705**：两处。写入器按「单帧时长 × 帧号」给时间戳，333666.67 hns 截成 333666 后逐帧累积误差；MP4 Sink 又按 `round(1000 × 帧率)` 定时标，30000/1001 成了 29970、每帧 1000 tick，容器只能存 2997/100。修法：样本时刻按有理数逐帧算（向下取整加 1 hns，首帧为 0：Sink 换算时标时向下截，恰在 tick 边界上的时刻会因浮点误差少一个 tick，`mdhd` 的时长随之短一个 tick）；NTSC 系在媒体类型上声明整数帧率（30000/1001 声明为 30），时标成了 30000、每帧 1001 tick，读回 30000/1001。代价：编码器按 30 fps 写码流 VUI 的 timing、按 30 fps 分配码率（实际低 0.1%），MP4 的播放与 ffprobe 都以容器时间戳为准。这一项也关系到 Runtime 的发布校验：它比 ffprobe 的 `r_frame_rate` 与输出帧率（容差 1e-6），按这个口径，改动前 Windows 上 29.97 的原生导出（容器 2997/100）会以 `EXPORT_VALIDATION_FAILED` 失败（没有跑端到端导出复现）。

像素变化：只有码流标注的矩阵与按高度推定不一致的素材（标清的 BT.709、高清的 BT.601）颜色会变，这是修正；无标注与常见的高清 BT.709 素材只剩换算实现的舍入与色度上采样差异（1080p testsrc2 与改动前的 MF RGB32 平均每通道差 0.53 级）。与 ffmpeg 8.1 的已知差异：无标注的高清素材 ffmpeg 按 BT.601 换，这里与 MF、浏览器一样按 BT.709。

### W9 合成线程的整帧拷贝与分配

- 实测的瓶颈（2026-10-15，RTX 3060 主机，release 的 `export-worker`，`tools/export-bench.ts` 的 1080p30、20 秒双语字幕夹具，临时插桩）：合成线程每帧约 8.3 ms，其中画视频那一层 6.4 ms（`frame-render` 的 `cropped` 在不裁剪时也整帧克隆一次，2.3 ms；内核把它画进一块新分配的 8.3 MB 画布，3.9 ms），叠到帧上 0.95 ms，字幕 0.9 ms；等解码只有 0.2 ms，编码从不让合成线程等。NVENC 确实在用（`nvidia-smi` 的编码器占用平均约 32%、最高 67%），解码器占用为 0（解码在 CPU 上）。所以这台机器上导出卡在 CPU 的合成，GPU 的编码器在等它；这个夹具上解码不是瓶颈，W1 与 W5 不会让它变快。
- 问题：每帧要几块整帧大小的缓冲（解出的画面、实例的源画面、内核画出的层），用完就放、下一帧再要。Windows 的进程堆把这么大的块直接交给 `VirtualAlloc`、释放时还给系统，每一帧拿到的都是新页，写进去先缺页、由系统清零，一块 8 MB 两千多次。不裁剪时实例的源画面也是解出的画面整帧复制来的。
- 做法（像素都不变）：
  - 先在 Windows 上给 `export-worker` 装过一个全局分配器（870584dd 的 `src/frame_alloc.rs`）：释放的 1 MiB 到 64 MiB 的块按大小与对齐精确匹配留着，下一次同样的分配原样拿回去。下面两条去掉了合成线程上逐帧的整帧分配、W1 又让解码直写调用方的缓冲之后，它不再划算，已经删掉。
  - 解出的画面共享给帧光栅，不复制：`LayerMedia::picture` 交出 `Arc<Pixmap>`，不裁剪、没有效果时 `frame-render` 原样注入内核；内核的恒等直通一路共享到光栅，要改像素（效果、虹膜、遮罩、不透明度）时才 `Arc::make_mut` 复制一份。画完一层就清掉注入表与动态资源表，`Sources` 换帧时 `Arc::try_unwrap` 拿回缓冲还给解码器。
  - 内核的画布跨帧复用：`FrameRenderer::composite` 把用完的那一幅（接管时换下的旧帧，否则是这一层）还给内核（`OverlayRenderPlan::recycle_canvas` → `CpuExecutor::recycle`），下一层经 `rasterize_with_media_into` 画在它上面；旧画布不当作新建时的全零，开头的透明清屏照样写零。
- 结果（交替跑的中位数）：
  - 分配器：空闲时 cover 117.6 → 137.6 fps（1.17 倍）、contain 112.3 → 129.6 fps（1.15 倍）。另起 24 个忙进程（超过 20 个逻辑处理器）时，三批交替的比值在 0.87–1.08 之间，没有一致的方向（7 次一批为 cover 1.03、contain 0.97）。整个导出的峰值工作集 456 → 515 MB。
  - 共享与画布复用（基线是装了分配器的构建；同机另有会话在跑，绝对值比上一行低）：空闲 5 次，cover 120.4 → 129.9 fps（1.08 倍）、contain 118.2 → 128.8 fps（1.09 倍），合成线程每帧 8.30 → 7.70 ms、8.46 → 7.77 ms。24 个忙进程时 7 次的中位数 cover 1.01、contain 1.23，但单次配对的比值在 0.64–1.83 之间，同样的活两种摆法相差 1.5 倍：满载的噪声盖过了差别，没有一致的方向。
  - 拿掉分配器：先在共享与画布复用之后、W1 之前，确认没有别的负载（没有忙进程、别的 Worker 与编译，CPU 约 4%）时同一份代码装与不装交替跑两批、每批 5 次、先后对调：不装的 cover 1.04、1.05 倍，contain 1.02、1.02 倍，20 对里 17 对不装的快（同机另有基准在跑时量的一次装的快，不作数）。W1–W5 合入之后再在拿掉它的构建上对比：空闲 5 次 cover 202.0 → 203.0 fps、contain 188.4 → 190.1 fps（都是 1.01 倍）；24 个忙进程时 7 次的中位数 cover 1.00、contain 1.03，单次配对的比值在 0.5–2 之间，没有方向。
  - 像素不变：`BAOCUT_EXPORT_NATIVE=0`、`output.crf` 为 1 时新旧构建各 300 帧的 `framemd5` 逐帧相同，覆盖两种摆法与另加的裁剪、画中画加不透明度与效果；装分配器那一次原生 Media Foundation 路径（NVENC）的输出也逐帧相同，拿掉它时四种摆法也逐帧相同。预览的 WASM 用同一份代码，`packages/ui` 的一致性测试与原生的夹具逐字节相同；`tools/preview-bench.ts` 新旧 WASM 轮流画，1080p 视频加双语字幕每帧 p50 39.1 → 38.3 ms，其余场景持平。
- 余下：内核画视频层仍要把解出的画面扫一遍、整帧拷进画布（解出的那一份要留给解码器下一帧可能再用，帧还要叠字幕、交给编码器，这一次省不掉）；旧画布开头的透明清屏还要整幅写零一遍，可以与随后整幅不透明的拷贝合成一步（像素不变）。把合成搬上 GPU 见[导出合成上 GPU（方案稿）](gpu-compositing.md)。


### W10 编码改成恒定质量

- macOS 的 H.264 已改成 VideoToolbox 的恒定质量，原来的码率曲线改作上限，写入端按实际码率封顶（架构设计 §9.11，验收与测试 §4「导出码率改成恒定质量」）。Windows 仍把 `crf_bitrate` 当平均码率：4K30 的标准档 38 Mb/s，访谈、录屏这类平稳的素材，同画质下 x264 的码率只有它的一到四成。
- 候选：编码器参数 `CODECAPI_AVEncCommonRateControlMode` 设 `eAVEncCommonRateControlMode_Quality`，配 `CODECAPI_AVEncCommonQuality`（0–100）；或 `eAVEncCommonRateControlMode_PeakConstrainedVBR` 配峰值码率当上限。三家显卡的 MFT 与微软的软件编码器支持的模式不同，先逐家读回 `IsSupported` / `GetValue`，不支持时留在平均码率。
- 标定照 macOS 的做法：同一批素材（4K 与 1080p 的访谈、航拍、街景、MV、录屏）交给 x264 与该编码器，按 VMAF 找与 x264 同一 CRF 相当的质量值；每家的刻度不同，可能要按编码器分别给映射。
- 上限：MF 中途改质量参数是否生效要实测；不生效就只能靠 PeakConstrainedVBR 的峰值，或者沿用 `quality_cap` 在写入端按窗口降质量。
- 验收：同一个工程导出，体积、VMAF、GOP、profile 与 level 用 `ffprobe` 与 libvmaf 核对，噪声这类素材不能超出上限。

## 验证

- **类型检查**（macOS 上就能做，每次改 Windows 代码都跑）：

  ```bash
  cargo check --target x86_64-pc-windows-gnu -p media-native -p export-worker
  ```

  只证明能编译，不能代替 Windows 上的运行。
- **等价测试**（像素不变的 W1–W3）：把纯函数（行搬运与旋转、`rgba_to_nv12`）放进不带 `cfg(windows)` 的模块，新旧实现对随机图像、四种旋转、奇数宽度逐字节对拍，在 CI 上跑。W1 在 Windows 上另加一条集成测试：同一个源从同一个起点分别用 `next_decoded` 与 `next_decoded_into` 解前 N 帧，逐字节相同。
- **合成像素不变**：改动若碰到合成路径，把 Worker 输入的 `output.crf` 设成 1、加 `BAOCUT_EXPORT_NATIVE=0`（整条走 ffmpeg 与 libx264，相同输入编出相同码流），新旧构建各导出一遍，用 `ffmpeg -f framemd5` 逐帧比对。原生编码器的输出随出帧节奏变，不能拿来逐帧比。
- **性能**：在 Windows 上先把改动前的 `export-worker.exe` 另存，再 `node tools/export-bench.ts --baseline <改动前的 Worker>`；空闲时帧率会顶在硬件编码的吞吐上，要另外在有负载时（起超过核数的忙进程）交替跑，记中位数、比值与负载。
- **打包后的自检**：改动随应用分发，按开发流程 §2「Windows 安装包」那一行在 Windows 上打包并跑 `check-packaged-app.mjs`。

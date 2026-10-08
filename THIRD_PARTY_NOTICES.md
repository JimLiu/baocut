# 第三方声明

BaoCut 的原创材料采用 [BaoCut Community License 1.0](LICENSE)。下列第三方代码与资源保留各自原始许可；本项目许可不改变这些组件已经授予的权利。

BaoCut 的部分代码与资源移植、改写或复制自下列开源项目。代码文件开头的注释写明了来源文件与改动；复制的资源文件列在各节里。

## 文件预览

- PDF.js（Mozilla，`pdfjs-dist`，Apache-2.0）：PDF Worker、渲染器、CMap、标准字体与图片解码器；字体、CMap 和解码器保留各自的许可。
- file-type（MIT）及其依赖：文件内容前缀识别，不依赖文件扩展名。
- DOMPurify（Cure53，Apache-2.0 OR MPL-2.0）：静态 HTML 预览的内容清理。

构建从安装包原文收集这些声明，随 Electron 与 Web 输出到 `assets/file-preview-licenses.txt`（`tools/pdf-licenses.ts`）。

## Paseo

- 来源：Paseo（https://github.com/getpaseo/paseo）
- Copyright (c) 2025-present Mohamed Boudra
- 许可：Apache License, Version 2.0（全文见下）

移植或改写了其中部分机制的 BaoCut 文件（相对原作有修改，修改内容见各文件开头的注释）：

- `packages/agent-drivers/src/acp/acp-connection.ts`
- `packages/agent-drivers/src/acp/acp-driver.ts`
- `packages/agent-drivers/src/acp/acp-items.ts`
- `packages/agent-drivers/src/acp/acp-presets.ts`
- `packages/agent-drivers/src/acp/acp-session.ts`
- `packages/agent-drivers/src/claude/claude-binary.ts`
- `packages/agent-drivers/src/claude/claude-models.ts`
- `packages/agent-drivers/src/claude/claude-query.ts`
- `packages/agent-drivers/src/claude/claude-session.ts`
- `packages/agent-drivers/src/codex/codex-models.ts`
- `packages/agent-drivers/src/codex/codex-session.ts`
- `packages/agent-drivers/src/opencode/opencode-binary.ts`
- `packages/agent-drivers/src/opencode/opencode-driver.ts`
- `packages/agent-drivers/src/opencode/opencode-items.ts`
- `packages/agent-drivers/src/opencode/opencode-models.ts`
- `packages/agent-drivers/src/opencode/opencode-preset.ts`
- `packages/agent-drivers/src/opencode/opencode-server.ts`
- `packages/agent-drivers/src/opencode/opencode-session.ts`
- `packages/agent-drivers/src/pi/pi-driver.ts`
- `packages/agent-drivers/src/pi/pi-items.ts`
- `packages/agent-drivers/src/pi/pi-models.ts`
- `packages/agent-drivers/src/pi/pi-rpc-process.ts`
- `packages/agent-drivers/src/pi/pi-session.ts`
- `packages/ui/src/model/composer-completions.ts`
- `packages/ui/src/model/message-queue.ts`
- `packages/ui/src/runtime/message-queue-runner.ts`

### Apache License, Version 2.0

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

## speech-swift

- 来源：[speech-swift](https://github.com/soniqo/speech-swift)（soniqo；原始版权声明为 `Copyright 2025 Ivan Digital`）
- 许可：Apache License, Version 2.0；[上游 LICENSE 的原文副本](crates/model-runtime/licenses/speech-swift.txt)保留完整条款、版权与免责声明。

BaoCut 的 Qwen3-ASR、Whisper、强制对齐、Silero VAD、Qwen3-TTS、VoxCPM2、OmniVoice、IndexTTS2，以及 HTDemucs 人声分离的部分实现参考或改写自该项目（部分先移植到 BaoCut v2，再移入当前项目）。相关 Swift 实现已改写为 Rust，并适配 BaoCut 的 MLX / candle 张量后端、按清单读取的模型包、错误与任务接口；推理与前后处理另按模型官方实现校正。每个相关实现文件开头保留版权、来源文件与修改声明，原有模型上游的来源说明同时保留。ASR 文件注明参考关系：算法以 Rust 实现，MLX 与 candle 后端有本项目自己的适配；Whisper 仍保留其 BaoCut 早先 Swift 实现的来源说明。

下列文件包含参考或改写部分；表格区分两种关系，不表示整份文件均来自 speech-swift，也不包含仅使用相同模型或框架的代码。模型权重、词典和音色录音的许可独立于本项目的代码许可，仍按各自来源声明。

| BaoCut 文件（相对仓库根） | speech-swift 来源文件（相对上游根） | 使用方式 |
| --- | --- | --- |
| `crates/model-runtime/src/backend/candle/aligner.rs` | `Sources/Qwen3ASR/ForcedAligner.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/candle/audio_encoder.rs` | `Sources/Qwen3ASR/AudioEncoder.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/candle/layers.rs` | `Sources/Qwen3ASR/QuantizedTextDecoder.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/candle/qwen3.rs` | `Sources/Qwen3ASR/Qwen3ASR.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/candle/silero.rs` | `Sources/SpeechVAD/SileroModel.swift / Sources/SpeechVAD/SileroVAD.swift / Sources/SpeechVAD/SileroWeightLoading.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/candle/text_decoder.rs` | `Sources/Qwen3ASR/QuantizedTextDecoder.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/candle/weights.rs` | `Sources/Qwen3ASR/WeightLoading.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/coreml/whisper.rs` | `Sources/WhisperASR/WhisperCoreMLRuntime.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/mlx/aligner.rs` | `Sources/Qwen3ASR/ForcedAligner.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/mlx/qwen3/audio_encoder.rs` | `Sources/Qwen3ASR/AudioEncoder.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/mlx/qwen3/layers.rs` | `Sources/Qwen3ASR/QuantizedTextDecoder.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/mlx/qwen3/model.rs` | `Sources/Qwen3ASR/Qwen3ASR.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/mlx/qwen3/text_decoder.rs` | `Sources/Qwen3ASR/QuantizedTextDecoder.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/mlx/qwen3/weights.rs` | `Sources/Qwen3ASR/WeightLoading.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/backend/mlx/silero.rs` | `Sources/SpeechVAD/SileroModel.swift / Sources/SpeechVAD/SileroVAD.swift / Sources/SpeechVAD/SileroWeightLoading.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/separate/config.rs` | `Sources/SourceSeparation/HTDemucs/HTDemucsConfig.swift` | 移植改写 |
| `crates/model-runtime/src/separate/htdemucs/layers.rs` | `Sources/SourceSeparation/HTDemucs/HTDemucsLayers.swift` | 移植改写 |
| `crates/model-runtime/src/separate/htdemucs/model.rs` | `Sources/SourceSeparation/HTDemucs/HTDemucs.swift` | 移植改写 |
| `crates/model-runtime/src/separate/htdemucs/separator.rs` | `Sources/SourceSeparation/HTDemucs/HTDemucsSeparator.swift` | 移植改写 |
| `crates/model-runtime/src/separate/htdemucs/transformer.rs` | `Sources/SourceSeparation/HTDemucs/HTDemucsTransformer.swift` | 移植改写 |
| `crates/model-runtime/src/separate/segment.rs` | `Sources/SourceSeparation/HTDemucs/HTDemucsSeparator.swift` | 移植改写 |
| `crates/model-runtime/src/separate/stft.rs` | `Sources/SourceSeparation/HTDemucs/HTDemucsSpec.swift` | 移植改写 |
| `crates/model-runtime/src/speech/align_common.rs` | `Sources/Qwen3ASR/ForcedAligner.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/speech/decoding.rs` | `Sources/Qwen3ASR/Qwen3ASR.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/speech/mel.rs` | `Sources/Qwen3ASR/AudioPreprocessing.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/speech/qwen3_asr.rs` | `Sources/Qwen3ASR/Configuration.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/speech/text_prep.rs` | `Sources/Qwen3ASR/TextPreprocessing.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/speech/timestamp.rs` | `Sources/Qwen3ASR/TimestampCorrection.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/speech/tokenizer.rs` | `Sources/AudioCommon/Tokenizer.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/speech/whisper_decoding.rs` | `Sources/WhisperASR/WhisperGenerationConfig.swift / Sources/WhisperASR/WhisperByteLevelTokenizer.swift` | 参考实现，Rust 重写 |
| `crates/model-runtime/src/synthesize/index_tts2/config.rs` | `Sources/IndexTTS2TTS/IndexTTS2RuntimeConfig.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/dsp.rs` | `Sources/SpeechRestoration/SeamlessM4TFrontEnd.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/bigvgan.rs` | `Sources/IndexTTS2TTS/IndexTTS2BigVGAN.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/campplus.rs` | `Sources/ChatterboxTTS/CAMPPlus.swift / Sources/IndexTTS2TTS/IndexTTS2CAMPPlusAdapter.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/engine_impl.rs` | `Sources/IndexTTS2TTS/IndexTTS2NativeRuntime.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/gpt.rs` | `Sources/IndexTTS2TTS/IndexTTS2SemanticGPT.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/layers.rs` | `Sources/IndexTTS2TTS/IndexTTS2SemanticGPT.swift / Sources/IndexTTS2TTS/IndexTTS2BigVGAN.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/s2mel.rs` | `Sources/IndexTTS2TTS/IndexTTS2S2Mel.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/semantic_codec.rs` | `Sources/IndexTTS2TTS/IndexTTS2SemanticCodec.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/w2v_bert.rs` | `Sources/IndexTTS2TTS/IndexTTS2Wav2Vec2Bert.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/mlx/weights.rs` | `Sources/MLXCommon/WeightLoading.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/normalizer.rs` | `Sources/IndexTTS2TTS/IndexTTS2TextNormalizer.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/sampling.rs` | `Sources/IndexTTS2TTS/IndexTTS2SemanticGPT.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/segmenter.rs` | `Sources/IndexTTS2TTS/IndexTTS2TextSegmenter.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/sentencepiece.rs` | `Sources/AudioCommon/SentencePieceModel.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/index_tts2/tokenizer.rs` | `Sources/IndexTTS2TTS/IndexTTS2Tokenizer.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/omnivoice/backbone.rs` | `Sources/OmniVoiceTTS/OmniVoiceBackbone.swift / Sources/OmniVoiceTTS/OmniVoiceDiffusion.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/omnivoice/codec.rs` | `Sources/OmniVoiceTTS/OmniVoiceCodec.swift / Sources/OmniVoiceTTS/OmniVoiceCodecEncoder.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/omnivoice/config.rs` | `Sources/OmniVoiceTTS/Configuration.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/omnivoice/engine.rs` | `Sources/OmniVoiceTTS/OmniVoiceModel.swift / Sources/OmniVoiceTTS/OmniVoiceTTSModel.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/code_predictor.rs` | `Sources/Qwen3TTS/CodePredictor.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/codec_decoder.rs` | `Sources/Qwen3TTS/SpeechTokenizerDecoder.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/codec_encoder.rs` | `Sources/Qwen3TTS/SpeechTokenizerEncoder.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/config.rs` | `Sources/Qwen3TTS/Configuration.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/engine.rs` | `Sources/Qwen3TTS/Qwen3TTS.swift / Sources/Qwen3TTS/Qwen3TTS+ICL.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/layers.rs` | `Sources/Qwen3TTS/Talker.swift / Sources/Qwen3TTS/CodePredictor.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/mel.rs` | `Sources/Qwen3TTS/SpeakerEncoder.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/prompt.rs` | `Sources/Qwen3TTS/Qwen3TTS.swift / Sources/Qwen3TTS/Qwen3TTS+ICL.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/sampling.rs` | `Sources/Qwen3TTS/Sampling.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/speaker_encoder.rs` | `Sources/Qwen3TTS/SpeakerEncoder.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/talker.rs` | `Sources/Qwen3TTS/Talker.swift / Sources/Qwen3TTS/CodePredictor.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/tokens.rs` | `Sources/Qwen3TTS/Configuration.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/qwen3_tts/weights.rs` | `Sources/Qwen3TTS/TTSWeightLoading.swift / Sources/Qwen3TTS/TTSWeightLoading+Encoder.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/voxcpm2/audio_vae.rs` | `Sources/VoxCPM2TTS/AudioVAE.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/voxcpm2/config.rs` | `Sources/VoxCPM2TTS/Configuration.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/voxcpm2/engine.rs` | `Sources/VoxCPM2TTS/VoxCPM2TTS.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/voxcpm2/minicpm.rs` | `Sources/VoxCPM2TTS/MiniCPM4.swift / Sources/VoxCPM2TTS/VoxCPM2TTS.swift` | 移植改写 |
| `crates/model-runtime/src/synthesize/voxcpm2/tokenizer.rs` | `Sources/VoxCPM2TTS/VoxCPM2TTS.swift` | 移植改写 |

TTS 与人声分离模块的 `mod.rs` 另汇总来源与修改范围。上游许可副本与来源路径按 speech-swift `1f54e56cf137078ed681a03e0955e777f7314610` 核对；该版本号用于定位声明来源，不表示当前实现与该版本完全相同。

本声明和上游许可副本随桌面与 Web 构建分发；桌面安装包在 `resources/THIRD_PARTY_NOTICES.md` 与 `resources/crates/model-runtime/licenses/speech-swift.txt` 保留可直接读取的副本。

## lobe-icons

- 来源：lobe-icons（https://github.com/lobehub/lobe-icons）
- Copyright (c) 2023 LobeHub
- 许可：MIT License（全文见下）

原样复制的服务商图标（未修改内容，只按服务商 id 改了文件名；每个文件里的 `<title>` 与 `style="flex:none;line-height:1"` 是它的原样标记）：

- `designs/baocut/assets/vendors/anthropic.svg`
- `designs/baocut/assets/vendors/codex.svg`（原名 `codex-color.svg`）
- `designs/baocut/assets/vendors/cursor.svg`
- `designs/baocut/assets/vendors/deepseek.svg`（原名 `deepseek-color.svg`）
- `designs/baocut/assets/vendors/elevenlabs.svg`
- `designs/baocut/assets/vendors/githubcopilot.svg`
- `designs/baocut/assets/vendors/google.svg`（原名 `gemini-color.svg`）
- `designs/baocut/assets/vendors/groq.svg`
- `designs/baocut/assets/vendors/minimax.svg`（原名 `minimax-color.svg`）
- `designs/baocut/assets/vendors/mistral.svg`（原名 `mistral-color.svg`）
- `designs/baocut/assets/vendors/moonshot.svg`（原名 `kimi.svg`）
- `designs/baocut/assets/vendors/openai.svg`
- `designs/baocut/assets/vendors/opencode.svg`
- `designs/baocut/assets/vendors/openrouter.svg`
- `designs/baocut/assets/vendors/pi.svg`
- `designs/baocut/assets/vendors/qwen.svg`（原名 `qwen-color.svg`）
- `designs/baocut/assets/vendors/siliconflow.svg`（原名 `siliconcloud-color.svg`）
- `designs/baocut/assets/vendors/volcengine.svg`（原名 `volcengine-color.svg`）
- `designs/baocut/assets/vendors/xai.svg`
- `designs/baocut/assets/vendors/zhipu.svg`（原名 `zhipu-color.svg`）

`packages/ui/src/components/vendor-icons/` 下是上面其中 9 个文件的逐字节副本（应用里 Agent 选择器的图标；`designs/baocut/app/icon-sync.test.js` 核对两份一致）：

- `packages/ui/src/components/vendor-icons/anthropic.svg`
- `packages/ui/src/components/vendor-icons/codex.svg`
- `packages/ui/src/components/vendor-icons/cursor.svg`
- `packages/ui/src/components/vendor-icons/githubcopilot.svg`
- `packages/ui/src/components/vendor-icons/google.svg`
- `packages/ui/src/components/vendor-icons/moonshot.svg`
- `packages/ui/src/components/vendor-icons/opencode.svg`
- `packages/ui/src/components/vendor-icons/pi.svg`
- `packages/ui/src/components/vendor-icons/xai.svg`

这些图标中的名称与标志是各自所有者的商标，只用于标明 BaoCut 连接的是哪家服务，不表示所有者认可或赞助 BaoCut。

### MIT License

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Spectrum 2 图标

- 来源：Adobe React Spectrum（https://github.com/adobe/react-spectrum），`@react-spectrum/s2` 的 workflow 图标
- 许可：Apache License, Version 2.0（全文见上文「Paseo」一节）

外壳图标 `designs/baocut/assets/shell/*.svg`（`packages/ui/src/components/shell-icons/` 是逐字节相同的一份）里：`summary.svg` 是 S2 `ListBulleted` 的路径，未改；`sidebar.svg`、`sidebar-hidden.svg`、`tabs.svg`、`hide-tabs.svg` 用 S2 展开面板图标（expand right）的方框与面板条，`sidebar.svg` 把面板条加宽到 4，`hide-tabs.svg` 加一条中线；`full.svg`、`exit-full.svg`、`tabs-plus.svg` 是 BaoCut 按 S2 画法自绘。逐个来源见原型同目录的 `provenance.json`。

这组外壳图标的选型（侧栏开关、标签页、完整视图、会话摘要）与完整视图两角的比例（臂长、跨度、两角间距）参考了 OpenAI Codex 桌面应用 26.930.61225 的外壳图标；图形按 S2 画法重画，没有复制它的路径数据。OpenAI 与 Codex 是其所有者的商标，参考不表示所有者认可或赞助 BaoCut。

## HyperFrames

- 来源：HyperFrames（https://github.com/hyperframes/hyperframes）
- 许可：Apache License, Version 2.0（全文见上文「Paseo」一节）

BaoCut 实现了 HyperFrames 公开的作者合同（合同标识 `hyperframes/1`）：根元素的 `data-*` 属性（`data-composition-id`、`data-width`、`data-height`、`data-fps`、`data-duration`）与 `window.__timelines[id].seek`，用来验证、取帧和烘焙按这个合同写的代码包（[代码包规范 §4.7](docs/spec/code-bundle-spec.md#47-hyperframes)）。BaoCut 没有移植、改写或复制 HyperFrames 的代码或资源，也不随应用分发它；本节只说明这个合同的出处。

## smol-toml

历史版本配置的 TOML 解析使用 smol-toml（Squirrel Chat，BSD-3-Clause）。随 Runtime 构建分发，原始许可如下：

```text
Copyright (c) Squirrel Chat et al., All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## keyring

Windows Credential Manager 的读写使用 keyring（keyring Developers），本分发选择 MIT 许可：

```text
Copyright (c) 2016 keyring Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

import path from 'node:path';
import { RpcError, type TemplateMessageRef, type TemplateSendRef } from '@baocut/protocol';
import { localizeTemplate, type LoadedTemplate, type TemplateCatalog } from './template-catalog.ts';
import { RcTemplates } from '@baocut/protocol/messages/runtime-core';

/**
 * 场景模板交给智能体的那一段（模板包规范 §5.2、§5.4）：统一的简报引导前言、模板的默认画幅与时长、`prompt.md` 正文与随附素材。
 * 前言由 Runtime 拼接，不写进每个 `prompt.md`，也不在界面里复制。会话里显示的仍是用户的原话，另带一个模板标记。
 */

/**
 * 简报引导前言，语义照规范 §5.2 的十条。前言用中文写成，但它只是给智能体的说明：提问与回复跟随用户的语言，
 * 成片的语言另按开发流程 §4 的顺序确定，不因为前言或模板正文的语言而改变。
 */
// i18n-ignore-start: 交给智能体的简报引导，按规范 §5.2 用中文写成，提问与回复另跟随用户的语言
export const SCENE_BRIEF_PREAMBLE = [
  '这是一个场景模板任务。先和用户确认简报；用户确认之前不开始制作，不调用会产生费用或修改视频的工具（读取用户给的材料可以）。',
  '1. 简报包含四项：主题（做什么）、目标（希望观众看完做什么或记住什么）、受众、手头的材料（文件、链接或文字；没有也可以）。另外确认画幅与时长：以下面给出的模板默认值为准，用户消息里写了的以用户为准，用户可以改；必要时确认成片的语言。',
  '2. 用户消息与附件里已经给出的信息不再重复询问；能从材料里读出的先读。',
  '3. 缺的项合并成一轮提问，问题简短，每项给出可选的默认值；不逐项来回追问。',
  '4. 用用户的语言提问和回复：跟随用户消息所用的语言，不因为这段说明或模板正文用了某种语言就改用它。',
  '5. 不把任何一种语言设为成片的默认语言：成片的语言按用户的明确要求、已记录的偏好、任务上下文的顺序确定，拿不准时作为简报的一项来确认。',
  '6. 把整理好的简报复述给用户，等用户确认或修改；用户明确表示直接做时，按已知信息与默认值继续，并在复述里写明哪些是默认的。',
  '7. 确认后按下面的模板正文制作；简报与正文冲突时以用户确认的简报为准。',
  '8. 模板正文要求的某项能力没有配置时不中断：没有语音合成就用字幕承担旁白与对白；没有配乐或音效生成就先考虑用代码合成，做不到再跳过；没有转写、图片或视频生成时改用用户给的材料或代码画面。在复述简报与交付时写明哪些要求因此降级，以及配置哪项能力后可以补上。',
  '9. 动手制作前先用 baocut 工具 skills_read 读 video-production（从简报到成片的做法）；下面列出了这个模板建议先读的做法时，也一并读。',
  '10. 用户消息里形如「[受众]」的方括号项，是模板留给用户填、用户没有填的待填项：把它们归入简报缺项一起问，不当作已有信息，也不要原样抄进成片。',
].join('\n');
// i18n-ignore-end

/** 发送时解析好的模板：消息上的标记，以及附在交给智能体的文字后面的那一段。 */
export interface ResolvedTemplate {
  ref: TemplateMessageRef;
  instructions: string;
}

/**
 * 解析 `conversations.send` 的 `template`：只接受场景模板；`version` 只作参考，用目录里当前的版本；`assets` 必须是清单登记的路径，
 * 不给时附上全部素材；`language` 挑模板文案的语言版本（规范 §3.6，缺省为 Runtime 的界面语言），标记上的标题与模板正文都用它。
 */
export async function resolveSceneTemplate(catalog: TemplateCatalog, request: TemplateSendRef): Promise<ResolvedTemplate> {
  const template = await catalog.require(request.id);
  const localized = localizeTemplate(template, request.language);
  const { manifest } = localized;
  if (manifest.kind !== 'scene') {
    throw new RpcError('invalid-request', RcTemplates.notScene({ title: manifest.title }), {
      code: 'TEMPLATE_NOT_SCENE',
      templateId: manifest.id,
      kind: manifest.kind,
    });
  }
  const registered = new Set((manifest.assets ?? []).map((a) => a.path));
  for (const asset of request.assets ?? []) {
    if (!registered.has(asset)) {
      throw new RpcError('invalid-request', RcTemplates.assetNotRegistered({ id: manifest.id, asset }), {
        code: 'TEMPLATE_FILE_NOT_FOUND',
        templateId: manifest.id,
        path: asset,
      });
    }
  }
  const kept = request.assets ? new Set(request.assets) : registered;
  return {
    ref: { id: manifest.id, version: manifest.version, title: manifest.title, kind: manifest.kind, origin: template.origin },
    instructions: sceneTemplateBlock({ ...template, manifest, prompt: localized.prompt }, kept),
  };
}

/** 交给智能体的模板段：前言、默认值、正文与素材，包在 `<baocut-template>` 里。`template` 是挑好语言版本的清单与正文。 */
export function sceneTemplateBlock(template: Pick<LoadedTemplate, 'manifest' | 'prompt' | 'dir'>, assets: ReadonlySet<string>): string {
  const { manifest } = template;
  // i18n-ignore-start: 交给智能体的模板段，与前言同一种语言
  const defaults = [
    manifest.ratio ? `画幅 ${manifest.ratio}` : '画幅自动',
    manifest.durationSeconds ? `时长 ${manifest.durationSeconds} 秒` : '时长自动',
  ].join('，');
  const attached = (manifest.assets ?? []).filter((a) => assets.has(a.path));
  const lines = [
    `<baocut-template id="${manifest.id}" version="${manifest.version}">`,
    `用户选了场景模板「${manifest.title}」。`,
    SCENE_BRIEF_PREAMBLE,
    '',
    `模板默认值：${defaults}。`,
    ...(manifest.skills?.length ? [`这个模板建议先读的做法：${manifest.skills.join('、')}（用 skills_read 读）。`] : []),
    '',
    '模板正文：',
    template.prompt.trim(),
  ];
  if (attached.length) {
    lines.push(
      '',
      '模板随附的素材（只读的本机文件，按模板正文的要求决定怎么用，不会自动放进视频）：',
      ...attached.map((a) => `- ${JSON.stringify(path.join(template.dir, ...a.path.split('/')))}（${a.type}）：${a.note}`),
    );
  }
  // i18n-ignore-end
  lines.push('</baocut-template>');
  return lines.join('\n');
}

import type { ArtRequirement } from './art-assets';
export type MaterialGenerationPrompt = { prompt: string; negative: string };
export function materialPromptText(value?: MaterialGenerationPrompt): string {
  if (!value) return '';
  return [value.prompt.trim(), value.negative.trim() ? '避免内容：\n' + value.negative.trim() : ''].filter(Boolean).join('\n\n');
}
/** A local, editable outline made only from the requirement; no external AI request. */
export function materialPromptDraft(requirement: ArtRequirement, categoryName = ''): MaterialGenerationPrompt {
  const audio = categoryName === '音频' || /音频|音效|音乐/.test(requirement.name);
  const animation = !audio && requirement.category === '动画';
  const guide = audio ? '以声音表达使用场景和事件层次；时长、节奏、循环与输出格式遵循制作规格。'
    : animation ? '明确动作阶段，保持各帧比例、视角和锚点一致；帧数、循环与输出格式遵循制作规格。'
    : '围绕主体组织清晰的轮廓与视觉层级；风格、视角、构图、尺寸和背景遵循制作规格。';
  const lines = ['请为游戏制作以下' + (audio ? '音频素材' : animation ? '动画素材' : '视觉素材') + '：' + requirement.name.trim(),
    '素材类型：' + (audio ? '音频' : requirement.category),
    requirement.description.trim() && '内容与用途：\n' + requirement.description.trim(),
    requirement.specification.trim() && '制作要求：\n' + requirement.specification.trim(),
    requirement.acceptance.trim() && '效果目标：\n' + requirement.acceptance.trim(), guide];
  return { prompt: lines.filter(Boolean).join('\n\n'), negative: requirement.generationPrompt?.negative ?? '' };
}

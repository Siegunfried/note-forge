/**
 * 编排层：把「课程 prompt + 原始速记」拼成完整提示词，交给 apiClient 整理。
 * 不含任何 VSCode 依赖，便于单独测试。
 */

import { ApiClientConfig, chatCompletion } from "./apiClient";
import { OrganizeResult } from "../types";
import { Reference, buildReferenceSection } from "./references";

/** 组装完整提示词文本（含 @ 引用的参考材料；有已有笔记时基于它整合更新）。 */
export function buildFullPrompt(
  promptText: string,
  rawText: string,
  references?: Reference[],
  existingMd?: string,
): string {
  const refSection = buildReferenceSection(references);
  const hasExisting = !!existingMd?.trim();

  const task = hasExisting
    ? `# 本次任务\n下面是「已有笔记」和「最新完整速记」。请**在已有笔记基础上整合更新**：保留已有笔记的内容与结构，把速记里新增的内容补进去、修正有变化的地方；**不要删除、遗漏或重写已有信息**。\n\n# 已有笔记（保留基线）\n\`\`\`markdown\n${existingMd!.trim()}\n\`\`\`\n\n# 最新完整速记\n\`\`\`text\n${rawText}\n\`\`\``
    : `# 本次任务\n以下是我已经提取好的原始笔记文本，请直接整理它：\n\n\`\`\`text\n${rawText}\n\`\`\``;

  return (
    `${promptText}\n\n` +
    task +
    (refSection ? `\n\n${refSection}` : "") +
    `\n\n请严格按上述规则完成整理，并**直接输出完整的 Markdown 内容本身**：\n` +
    `- 不要输出任何解释、前后缀，也不要用 \`\`\` 代码块围栏包裹；\n` +
    `- 从第一个标题（第一个 #）开始，直到文末清单结束。`
  );
}

/** 执行整理：拼提示词 → 调 API → 返回结果。 */
export async function organize(
  rawText: string,
  promptText: string,
  config: ApiClientConfig,
  references?: Reference[],
  existingMd?: string,
): Promise<OrganizeResult> {
  const prompt = buildFullPrompt(promptText, rawText, references, existingMd);
  return chatCompletion(config, [{ role: "user", content: prompt }]);
}

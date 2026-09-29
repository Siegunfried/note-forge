/**
 * 编排层：把「内置 prompt + 原始速记」拼成完整提示词，交给 apiClient 整理。
 * 不含任何 VSCode 依赖，便于单独测试。
 */

import { ApiClientConfig, chatCompletionStream } from "./apiClient";
import { OrganizeResult } from "../types";
import { Reference, buildReferenceSection } from "./references";

/** 组装完整提示词文本（含 @ 引用的参考材料）。结构完全由原文缩进决定，不带已有 .md 基线。 */
export function buildFullPrompt(
  promptText: string,
  rawText: string,
  references?: Reference[],
): string {
  const refSection = buildReferenceSection(references);

  const task = `# 本次任务\n以下是我已经提取好的原始笔记文本，请直接整理它：\n\n\`\`\`text\n${rawText}\n\`\`\``;

  return (
    `${promptText}\n\n` +
    task +
    (refSection ? `\n\n${refSection}` : "") +
    `\n\n请严格按上述规则完成整理，并**直接输出完整的 Markdown 内容本身**：\n` +
    `- 不要输出任何解释、前后缀，也不要用 \`\`\` 代码块围栏包裹；\n` +
    `- 从第一个标题（第一个 #）开始，直到文末。`
  );
}

/** 执行整理：拼提示词 → 调 API → 返回结果。 */
export async function organize(
  rawText: string,
  promptText: string,
  config: ApiClientConfig,
  references?: Reference[],
  onProgress?: (accumulatedText: string) => void,
): Promise<OrganizeResult> {
  const prompt = buildFullPrompt(promptText, rawText, references);
  return chatCompletionStream(config, [{ role: "user", content: prompt }], onProgress);
}

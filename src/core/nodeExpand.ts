/**
 * 节点展开：把一个 .forge 节点交给 AI，展开成一段 markdown 内容。
 * 结构由 mdAssemble 负责，这里只产出单个节点的内容。
 * 展开时附带祖先主题链，用于消歧义 + 避免与父节点重复。
 */

import { ForgeNode } from "./forgeTree";
import { ApiClientConfig, chatCompletionStream } from "./apiClient";
import { Reference, buildReferenceSection } from "./references";

/** 展开一个节点，返回该节点的 markdown 内容（子节点另算）。 */
export async function expandNode(
  node: ForgeNode,
  ancestorTexts: string[],
  promptText: string,
  config: ApiClientConfig,
  references?: Reference[],
): Promise<string> {
  const prompt = buildExpansionPrompt(promptText, node, ancestorTexts, references);
  const result = await chatCompletionStream(config, [{ role: "user", content: prompt }]);
  return result.markdown.trim();
}

/** 并发展开一组节点（带并发上限），返回 path → 内容。 */
export async function expandNodes(
  nodes: ForgeNode[],
  ancestorsOf: (n: ForgeNode) => string[],
  promptText: string,
  config: ApiClientConfig,
  references?: Reference[],
): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  const CONCURRENCY = 5;
  const queue = [...nodes];
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const node = queue.shift();
        if (!node) {
          break;
        }
        const ancestors = ancestorsOf(node);
        contents[node.path] = await expandNode(
          node,
          ancestors,
          promptText,
          config,
          ancestors.length === 0 ? references : undefined, // 引用只给顶层节点
        );
      }
    },
  );
  await Promise.all(workers);
  return contents;
}

/** 拼节点展开 prompt。 */
function buildExpansionPrompt(
  promptText: string,
  node: ForgeNode,
  ancestorTexts: string[],
  references?: Reference[],
): string {
  const contextLine =
    ancestorTexts.length > 0
      ? `\n# 上下文（你属于这条主题链下的子条目，只展开你这一条，不要重复父条目已讲的内容）\n主题链：${ancestorTexts.join(" → ")}\n`
      : "";
  return [
    promptText,
    contextLine,
    buildReferenceSection(references),
    "# 任务",
    "把下面这一条速记展开成一段 markdown 内容：按符号生成 - 列表 / 代码块 / 对比表，并加必要标注，只输出这一段本身，不要标题、不要 JSON、不要围栏包裹。",
    "```text",
    node.rawLine,
    "```",
  ]
    .filter((s) => s !== "")
    .join("\n");
}

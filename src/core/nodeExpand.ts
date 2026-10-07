/**
 * 节点展开：把一个 .forge 节点交给 AI，展开成一段 markdown 内容。
 * 结构由 mdAssemble 负责，这里只产出单个节点的内容。
 * 展开时附带祖先主题链，用于消歧义 + 避免与父节点重复。
 */

import { ForgeNode } from "./forgeTree";
import { ApiClientConfig, chatCompletionStream } from "./apiClient";
import { Reference, buildReferenceSection } from "./references";

/** 单个节点的展开结果。 */
export interface ExpandNodeResult {
  markdown: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** 展开单个节点。 */
export async function expandNode(
  node: ForgeNode,
  ancestorTexts: string[],
  promptText: string,
  config: ApiClientConfig,
  references?: Reference[],
): Promise<ExpandNodeResult> {
  const prompt = buildExpansionPrompt(promptText, node, ancestorTexts, references);
  const result = await chatCompletionStream(config, [{ role: "user", content: prompt }]);
  return { markdown: result.markdown.trim(), usage: result.usage };
}

/** 一批节点的展开结果（含累计 token 用量）。 */
export interface ExpandNodesResult {
  contents: Record<string, string>;
  usage: { promptTokens: number; completionTokens: number };
}

/** 并发展开一组节点（带并发上限），返回 path → 内容 与累计用量。
 *  可选 onProgress 回调：每完成一个节点触发一次，携带 (done, total, lastText) 供上层显示进度。
 *  可选 signal 取消：在每轮取节点前检查，已取消则中止（已完成的节点保留）。
 */
export async function expandNodes(
  nodes: ForgeNode[],
  ancestorsOf: (n: ForgeNode) => string[],
  promptText: string,
  config: ApiClientConfig,
  references?: Reference[],
  onProgress?: (done: number, total: number, lastText: string) => void,
  signal?: { cancelled: boolean },
): Promise<ExpandNodesResult> {
  const contents: Record<string, string> = {};
  const usage = { promptTokens: 0, completionTokens: 0 };
  const CONCURRENCY = 3; // 并发过高易触发 429 限流；配合请求重试，3 路更稳。
  const total = nodes.length;
  let completed = 0;

  const queue = [...nodes];
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        if (signal?.cancelled) {
          return; // 已取消：不再取新节点
        }
        const node = queue.shift();
        if (!node) {
          break;
        }
        const ancestors = ancestorsOf(node);
        const r = await expandNode(
          node,
          ancestors,
          promptText,
          config,
          ancestors.length === 0 ? references : undefined, // 引用只给顶层节点
        );
        contents[node.path] = r.markdown;
        if (r.usage) {
          usage.promptTokens += r.usage.promptTokens;
          usage.completionTokens += r.usage.completionTokens;
        }
        completed++;
        onProgress?.(completed, total, node.text || node.rawLine);
      }
    },
  );
  await Promise.all(workers);
  return { contents, usage };
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

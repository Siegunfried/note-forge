/**
 * 节点展开：把一个 .forge 节点交给 AI，产出正文内容 +（标题节点的）书面化标题。
 * 结构由 mdAssemble 负责，这里只产出单个节点的内容与标题。
 *
 * AI 调用解耦：
 * - 先独立解析当前行：符号标记（lineResolver）→ 只把「本条要求」与正文交给 AI。
 * - 基础 prompt（LINE_BASE_PROMPT）不含符号表，符号处理模板由 buildSymbolDirective 按本条命中注入。
 * - 严格禁止 AI 在输出里夹带符号标记（LINE_BASE_PROMPT 已写明铁律）。
 * - 标题节点额外做一次「标题书面化」（TITLE_NORMALIZE_PROMPT），统一格式风格。
 */

import { ForgeNode, isHeadingNode } from "./forgeTree";
import { ApiClientConfig, chatCompletionStream } from "./apiClient";
import { buildSymbolDirective } from "./lineResolver";
import { LINE_BASE_PROMPT, TITLE_NORMALIZE_PROMPT } from "./promptLoader";

/** token 用量（可跨多次调用累计）。 */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

/** 单个节点的展开结果。 */
export interface NodeOutput {
  /** 正文内容（纯标题 ## 节点无正文）。 */
  content?: string;
  /** 书面化标题（只有标题节点有）。 */
  title?: string;
  usage?: Usage;
}

/** 展开单个节点。 */
export async function expandNode(
  node: ForgeNode,
  ancestorTexts: string[],
  config: ApiClientConfig,
  signal?: AbortSignal,
  extraRequirement?: string,
): Promise<NodeOutput> {
  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  const add = (u?: Usage) => {
    if (u) {
      usage.promptTokens += u.promptTokens;
      usage.completionTokens += u.completionTokens;
    }
  };

  // 标题书面化与正文展开彼此独立（分别只读标题文字 / 正文行），并行发起以缩短耗时。
  // 纯标题节点只做前者，非标题节点只做后者，标题且非纯标题节点两者并行。
  const needTitle = isHeadingNode(node, ancestorTexts.length);
  const needContent = !node.pureHeading;

  const [titleRes, contentRes] = await Promise.all([
    needTitle ? normalizeTitle(node.text, config, signal) : undefined,
    needContent
      ? expandContent(node, ancestorTexts, config, signal, extraRequirement)
      : undefined,
  ]);

  let title: string | undefined;
  if (titleRes) {
    add(titleRes.usage);
    title = titleRes.title;
  }

  let content: string | undefined;
  if (contentRes) {
    add(contentRes.usage);
    content = contentRes.content;
  }

  return {
    content,
    title,
    usage: usage.promptTokens + usage.completionTokens > 0 ? usage : undefined,
  };
}

/** 一批节点的展开结果（含累计 token 用量）。 */
export interface ExpandNodesResult {
  contents: Record<string, string>;
  titles: Record<string, string>;
  usage: Usage;
}

/** 并发展开一组节点（带并发上限），返回 path → 内容、path → 标题 与累计用量。
 *  可选 onProgress 回调：每完成一个节点触发一次，携带 (done, total, lastText) 供上层显示进度。
 *  可选 signal 取消：在每轮取节点前检查，已取消则中止并中止在途请求（已完成的节点保留）。
 *  可选 extraRequirement：附加自定义要求（重新生成时用户输入），注入到每个节点的 prompt。
 */
export async function expandNodes(
  nodes: ForgeNode[],
  ancestorsOf: (n: ForgeNode) => string[],
  config: ApiClientConfig,
  onProgress?: (done: number, total: number, lastText: string) => void,
  signal?: AbortSignal,
  extraRequirement?: string,
): Promise<ExpandNodesResult> {
  const contents: Record<string, string> = {};
  const titles: Record<string, string> = {};
  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  const CONCURRENCY = 3; // 并发过高易触发 429 限流；配合请求重试，3 路更稳。
  const total = nodes.length;
  let completed = 0;

  const queue = [...nodes];
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        if (signal?.aborted) {
          return; // 已取消：不再取新节点
        }
        const node = queue.shift();
        if (!node) {
          break;
        }
        const ancestors = ancestorsOf(node);
        try {
          const r = await expandNode(
            node,
            ancestors,
            config,
            signal,
            extraRequirement,
          );
          if (r.content !== undefined && r.content !== "") {
            contents[node.path] = r.content;
          }
          if (r.title !== undefined) {
            titles[node.path] = r.title;
          }
          if (r.usage) {
            usage.promptTokens += r.usage.promptTokens;
            usage.completionTokens += r.usage.completionTokens;
          }
          completed++;
          onProgress?.(completed, total, node.text || node.rawLine);
        } catch (err) {
          if (signal?.aborted) {
            return; // 取消导致在途请求中止：静默结束，不抛错
          }
          throw err;
        }
      }
    },
  );
  await Promise.all(workers);
  return { contents, titles, usage };
}

/** 标题书面化：把速记标题改写为规范书面中文标题（整个标题节点额外一次 AI 调用）。 */
async function normalizeTitle(
  heading: string,
  config: ApiClientConfig,
  signal?: AbortSignal,
): Promise<{ title: string; usage?: Usage }> {
  if (!heading.trim()) {
    return { title: heading };
  }
  const prompt = `${TITLE_NORMALIZE_PROMPT}\n\n# 待改写的标题\n\`\`\`text\n${heading}\n\`\`\``;
  const result = await chatCompletionStream(
    config,
    [{ role: "user", content: prompt }],
    undefined,
    signal,
  );
  const title =
    result.markdown
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)[0] ?? heading;
  return { title, usage: result.usage };
}

/** 展开正文内容：LINE_BASE_PROMPT + 本条符号要求 + 正文。 */
async function expandContent(
  node: ForgeNode,
  ancestorTexts: string[],
  config: ApiClientConfig,
  signal: AbortSignal | undefined,
  extraRequirement: string | undefined,
): Promise<{ content: string; usage?: Usage }> {
  const prompt = buildContentPrompt(
    node,
    ancestorTexts,
    extraRequirement,
  );
  const result = await chatCompletionStream(
    config,
    [{ role: "user", content: prompt }],
    undefined,
    signal,
  );
  return { content: result.markdown.trim(), usage: result.usage };
}

/** 拼正文展开 prompt：只交代「本条要求」，不塞整张符号表。 */
function buildContentPrompt(
  node: ForgeNode,
  ancestorTexts: string[],
  extraRequirement?: string,
): string {
  const contextLine =
    ancestorTexts.length > 0
      ? `\n# 上下文（你属于这条主题链下的子条目，只展开你这一条，不要重复父条目已讲的内容）\n主题链：${ancestorTexts.join(" → ")}\n`
      : "";
  const extra = extraRequirement?.trim()
    ? `\n# 附加要求（用户指定，必须遵守）\n${extraRequirement.trim()}\n`
    : "";
  return [
    LINE_BASE_PROMPT,
    contextLine,
    extra,
    "# 本条要求",
    buildSymbolDirective(node.symbol),
    "# 待展开的速记",
    "```text",
    node.rawLine,
    "```",
  ]
    .filter((s) => s !== "")
    .join("\n");
}
/**
 * .md 拼装：把树 + 逐节点内容拼成 Markdown（缩进树 = 结构，代码实现）。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 *
 * 标题规则：
 * - 顶层节点 → 一级标题 #（编号 1、2、3…）。
 * - 符号为 #（标题）的节点、符号为 $（定义）的节点、或有子节点的节点 → 子标题 ##/###/…（编号 N.M / N.M.K）。
 * - 其余叶子内容节点（例 / 代码 / 对比表 / 深挖等）→ 直接作为内容放在所属标题下。
 *
 * 批注规则（% 思考 / ? 疑问）：
 * - 批注是「结构性附庸」，不是正文主体，也永不升级成标题。
 * - 批注节点（含其整棵子树）→ 用 Markdown 引用块 `>` 包裹，作为所属标题下的旁注输出。
 */

import { ForgeNode } from "./forgeTree";

/** 是否为批注类节点（% 思考 / ? 疑问）——批注是结构性附庸，永不升级成标题。 */
function isAnnotation(node: ForgeNode): boolean {
  return node.symbol.includes("%") || node.symbol.includes("?");
}

/**
 * 把树和逐节点内容拼成 Markdown。
 * contents 以节点 path 为键。
 */
export function assembleMarkdown(
  roots: ForgeNode[],
  contents: Record<string, string>,
): string {
  const blocks: string[] = [];
  const counters: number[] = [];

  const isHeading = (node: ForgeNode, depth: number): boolean =>
    !isAnnotation(node) &&
    (node.children.length > 0 ||
      node.symbol.includes("#") ||
      node.symbol.includes("$") ||
      (depth === 0 && node.symbol === ""));

  /** 递归收集节点（含子树）的文本行，用于把批注子树平铺成引用块。 */
  const collectText = (node: ForgeNode): string[] => {
    const own = (contents[node.path] ?? "").trim();
    const subs = node.children.flatMap(collectText);
    return [own, ...subs].filter((s) => s.length > 0);
  };

  const emit = (node: ForgeNode, depth: number) => {
    if (isAnnotation(node)) {
      // 批注节点：整棵子树平铺成「引用块」旁注，不参与标题层级，也不再递归 emit。
      const lines = collectText(node);
      if (lines.length > 0) {
        blocks.push(lines.map((s) => `> ${s}`).join("\n>\n"));
      }
      return;
    }

    const content = (contents[node.path] ?? "").trim();

    if (isHeading(node, depth)) {
      counters[depth] = (counters[depth] ?? 0) + 1;
      counters.length = depth + 1;
      const level = Math.min(depth + 1, 6);
      const hashes = "#".repeat(level);
      blocks.push(`${hashes} ${counters.join(".")} ${node.text}`);
      if (content) {
        blocks.push(content);
      }
    } else if (content) {
      blocks.push(content);
    }

    for (const child of node.children) {
      emit(child, depth + 1);
    }
  };

  for (const root of roots) {
    emit(root, 0);
  }

  return blocks.join("\n\n") + "\n";
}

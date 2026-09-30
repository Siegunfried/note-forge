/**
 * .md 拼装：把树 + 逐节点内容拼成 Markdown（缩进树 = 结构，代码实现）。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 *
 * 标题规则：
 * - 顶层节点 → 一级标题 #（编号 1、2、3…）。
 * - 符号为 #（深挖）的节点、或有子节点的节点 → 子标题 ##/###/…（编号 N.M / N.M.K）。
 * - 其余叶子内容节点（例 / 代码 / 对比表 / 疑问等）→ 直接作为内容放在所属标题下。
 */

import { ForgeNode } from "./forgeTree";

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
    node.children.length > 0 ||
    node.symbol.includes("#") ||
    (depth === 0 && node.symbol === "");

  const emit = (node: ForgeNode, depth: number) => {
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

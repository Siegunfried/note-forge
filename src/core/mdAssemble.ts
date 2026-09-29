/**
 * .md 拼装：把树 + 逐节点内容拼成 Markdown（缩进树 = 结构，代码实现）。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 */

import { ForgeNode } from "./forgeTree";

/**
 * 把树和逐节点内容拼成 Markdown。
 * contents 以节点 path 为键；顶层节点 → 一级标题（标题取 node.text），
 * 子节点 → 按深度缩进的子条。
 */
export function assembleMarkdown(
  roots: ForgeNode[],
  contents: Record<string, string>,
): string {
  const blocks: string[] = [];
  let sectionNumber = 0;

  const emit = (node: ForgeNode, depth: number) => {
    const content = (contents[node.path] ?? "").trim();
    if (depth === 0) {
      sectionNumber++;
      blocks.push(`# ${sectionNumber} ${node.text}`);
      if (content) {
        blocks.push(content);
      }
    } else if (content) {
      const pad = "  ".repeat(depth - 1);
      blocks.push(indentLines(content, pad));
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

/** 给多行文本统一加前缀缩进（空行不加）。 */
function indentLines(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l))
    .join("\n");
}

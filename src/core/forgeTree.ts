/**
 * .forge 树：把缩进速记解析成树结构。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 */

import { SYMBOL_CHARS } from "./symbols";

/** 一个 .forge 节点（一行 + 它的子行）。 */
export interface ForgeNode {
  /** 节点路径，如 "0"、"0.1"、"0.1.0"，用作内容库索引。 */
  path: string;
  /** 行首缩进（空格/制表符数）。 */
  indent: number;
  /** 行首标记符号（如 "#"、"!?"），无则为空串。 */
  symbol: string;
  /** 符号之后的正文（trim）。 */
  text: string;
  /** 原始行（trim，含符号）。 */
  rawLine: string;
  /** 子节点。 */
  children: ForgeNode[];
}

/** 解析 .forge 文本为顶层节点数组（缩进即层级）。 */
export function parseForgeTree(text: string): ForgeNode[] {
  const roots: ForgeNode[] = [];
  const stack: ForgeNode[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") {
      continue; // 跳过空行
    }
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    const content = line.trim();
    const symbolMatch = content.match(new RegExp(`^[${SYMBOL_CHARS}]+`));
    const symbol = symbolMatch ? symbolMatch[0] : "";
    // @ 引用指令（@ 后必须空格）不是内容节点，由 references 单独处理；
    // 不带空格的 @xxx 视为普通内容行，避免静默丢弃。
    if (/^@\s/.test(content)) {
      continue;
    }
    const nodeText = symbol ? content.slice(symbol.length).trim() : content;

    const node: ForgeNode = {
      path: "",
      indent,
      symbol,
      text: nodeText,
      rawLine: content,
      children: [],
    };

    // 弹栈直到栈顶缩进 < 当前缩进。
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      node.path = String(roots.length);
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      node.path = `${parent.path}.${parent.children.length}`;
      parent.children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

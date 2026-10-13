/**
 * .forge 树：把缩进速记解析成树结构。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 */

import { SYMBOL_CHARS } from "./symbols";

/** 纯章节标题标记：行首连续 ## 后接空白/行尾，仅用于结构层级，不生成正文内容。 */
export const PURE_HEADING_MARK = "##";

/** 一个 .forge 节点（一行 + 它的子行）。 */
export interface ForgeNode {
  /** 节点路径，如 "0"、"0.1"、"0.1.0"，用作内容库索引。 */
  path: string;
  /** 行首缩进（空格/制表符数）。 */
  indent: number;
  /** 行首标记符号（如 "#"、"!?"、"##"），无则为空串。 */
  symbol: string;
  /** 符号之后的正文（trim）。 */
  text: string;
  /** 原始行（trim，含符号）。 */
  rawLine: string;
  /** 节点在原文中的 0-based 行号（用于光标定位）。 */
  line: number;
  /** 是否为纯章节标题（## 标记）：不触发 AI 内容生成，仅保留章节名。 */
  pureHeading: boolean;
  /** 子节点。 */
  children: ForgeNode[];
}

/** 是否为批注类节点（% 思考 / ? 疑问）——批注是结构性附庸，永不升级成标题。 */
export function isAnnotationNode(node: ForgeNode): boolean {
  return node.symbol.includes("%") || node.symbol.includes("?");
}

/** 是否为「标题」节点（产出章节标题，需做书面化）。 */
export function isHeadingNode(node: ForgeNode, depth: number): boolean {
  return (
    !isAnnotationNode(node) &&
    (node.pureHeading ||
      node.children.length > 0 ||
      node.symbol.includes("#") ||
      node.symbol.includes("$") ||
      (depth === 0 && node.symbol === ""))
  );
}

/** 节点是否带「没听懂」标注（符号含 +）。 */
export function isUnclear(node: ForgeNode): boolean {
  return node.symbol.includes("+");
}

/** 节点或其子树是否含「没听懂」标注（供章节树在父章节上注明）。 */
export function subtreeHasUnclear(node: ForgeNode): boolean {
  return isUnclear(node) || node.children.some(subtreeHasUnclear);
}

/** 解析 .forge 文本为顶层节点数组（缩进即层级，跳过空行）。 */
export function parseForgeTree(text: string): ForgeNode[] {
  const roots: ForgeNode[] = [];
  const stack: ForgeNode[] = [];
  let lineNo = 0;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const currentLine = lineNo++;
    if (line.trim() === "") {
      continue; // 跳过空行（行号仍递增，保证定位准确）
    }
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    const content = line.trim();

    // 纯章节标题：行首 ## 后接空白或行尾。
    const pureHeading = new RegExp(`^${PURE_HEADING_MARK}(?=\\s|$)`).test(content);
    const symbolMatch = pureHeading
      ? null
      : content.match(new RegExp(`^[${SYMBOL_CHARS}]+`));
    const symbol = pureHeading
      ? PURE_HEADING_MARK
      : symbolMatch
        ? symbolMatch[0]
        : "";
    const nodeText = pureHeading
      ? content.slice(PURE_HEADING_MARK.length).trim()
      : symbol
        ? content.slice(symbol.length).trim()
        : content;

    const node: ForgeNode = {
      path: "",
      indent,
      symbol,
      text: nodeText,
      rawLine: content,
      line: currentLine,
      pureHeading,
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
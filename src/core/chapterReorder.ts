/**
 * 章节树智能重构：调用 AI 重排 .forge 树上节点（章节 + 内容叶子）的层级与顺序。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 *
 * 硬约束：只改「层级」（父归属/缩进）与「顺序」，绝不改动任何节点的符号与内容文字。
 * 保证方式：AI 只输出「路径 + 新层级」的重排方案；落盘前做两道校验——
 *   1. validateReorderPlan：方案里路径集合与子树节点集合完全一致（无重复/缺漏/越界）、层级合法（不跳级）。
 *   2. ensureNoContentLoss：重排前后整篇 (符号 + 文本) 多重集完全一致，任一不满足即放弃写入。
 */

import { ForgeNode, parseForgeTree } from "./forgeTree";

/** 单个节点的重排指令：原路径 + 新层级（0-based，顶级为 0）。 */
export interface ReorderEntry {
  path: string;
  depth: number;
}

/** 重排方案输出格式说明（写进 prompt，供 AI 遵守）。 */
const REORDER_PROMPT = `# 角色
你是课程知识体系结构整理助手。

# 任务
下面是一棵课程笔记的树（缩进表示父子层级，每层缩进 2 个空格）。当前各条目的顺序或层级可能不符合知识本身的科学逻辑。请按知识本身的现实逻辑（先总后分、先定义后应用、先基础后进阶、先原因后结论、相关主题就近聚合等）重新组织这些条目的「层级」与「先后顺序」。

# 铁律（必守）
1. 只调整「层级」与「顺序」，绝不修改任何条目的「内容文字」与「标记符号」。
2. 每个条目以「路径」作为唯一标识（形如 0、0.1、0.1.0），输出时原样照抄路径，不要改动路径本身。
3. 输出格式：每行输出一个条目，格式为「行首缩进 + 路径」。行首空格数 = 新层级 × 2（顶级 0 个空格、子级 2 个空格、孙级 4 个空格……）。路径紧跟缩进之后，一行只写缩进和路径，不要任何额外文字、编号、解释、列表符号或代码围栏。
4. 必须且只能用到下方给定的全部条目路径：一个不多、一个不少、绝不重复。
5. 层级要合法：子条目只能比其父条目深一层（不能凭空跳级），且必须存在父条目。

# 待重构的树（每行「路径 | 标记符号 + 内容」）`;

/** 收集节点及其整棵子树（含自身），DFS 前序。 */
export function subtreeNodes(root: ForgeNode): ForgeNode[] {
  const out: ForgeNode[] = [root];
  for (const c of root.children) {
    out.push(...subtreeNodes(c));
  }
  return out;
}

/** 把子树描述成给 AI 看的树状文本（每行「缩进 + 路径 | 原始行」）。 */
export function buildReorderPrompt(root: ForgeNode): string {
  const lines: string[] = [];
  const walk = (n: ForgeNode, depth: number) => {
    const label = n.rawLine === "" ? "（空）" : n.rawLine;
    lines.push(`${"  ".repeat(depth)}${n.path} | ${label}`);
    for (const c of n.children) {
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return `${REORDER_PROMPT}\n\n\`\`\`text\n${lines.join("\n")}\n\`\`\`\n\n# 请输出重排后的路径列表`;
}

/** 计算行首空白对应的「列数」（空格记 1、制表符记 2）。 */
function indentColumns(s: string): number {
  let n = 0;
  for (const ch of s) {
    n += ch === "\t" ? 2 : 1;
  }
  return n;
}

/**
 * 解析 AI 输出的重排方案。
 * 每行取「行首空白数 → 层级（floor(列数/2)）」+ 首个形如「0.1」的 token 作为路径；
 * 无法识别为路径的行（解释、代码围栏等）忽略。
 */
export function parseReorderPlan(text: string): ReorderEntry[] {
  const entries: ReorderEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") {
      continue;
    }
    if (/^\s*```/.test(line)) {
      continue;
    }
    const ws = line.match(/^\s*/)?.[0] ?? "";
    const content = line
      .trim()
      .replace(/^`+|`+$/g, "")
      .trim();
    const m = content.match(/^(\d+(?:\.\d+)*)\b/);
    if (!m) {
      continue;
    }
    entries.push({ path: m[1], depth: Math.floor(indentColumns(ws) / 2) });
  }
  return entries;
}

/**
 * 校验重排方案的合法性，返回错误描述（合法返回 null）。
 * 约束：路径集合与子树节点集合完全一致、根节点居首且层级为 0、后续节点层级 ≥1 且不跳级（≤ 前一层 +1）。
 */
export function validateReorderPlan(
  plan: ReorderEntry[],
  atomPaths: ReadonlySet<string>,
  rootPath: string,
): string | null {
  if (plan.length === 0) {
    return "重排结果为空";
  }
  if (plan.length !== atomPaths.size) {
    return `节点数量不一致（应有 ${atomPaths.size} 个，实际 ${plan.length} 个）`;
  }
  if (plan[0].path !== rootPath || plan[0].depth !== 0) {
    return "根节点必须位于最前且层级为 0";
  }

  const seen = new Set<string>();
  let prevDepth = 0;
  for (let i = 0; i < plan.length; i++) {
    const e = plan[i];
    if (seen.has(e.path)) {
      return `节点路径重复：${e.path}`;
    }
    seen.add(e.path);
    if (!atomPaths.has(e.path)) {
      return `出现了不在范围内的节点：${e.path}`;
    }
    if (i > 0) {
      if (e.depth < 1) {
        return `节点 ${e.path} 层级至少为 1`;
      }
      if (e.depth > prevDepth + 1) {
        return `节点 ${e.path} 层级跳级（前一层级 ${prevDepth}，不应超过 ${prevDepth + 1}）`;
      }
    }
    prevDepth = e.depth;
  }
  if (seen.size !== atomPaths.size) {
    return "有节点缺失";
  }
  return null;
}

/**
 * 把重排方案应用到原文：解析整棵树 → 按 path 定位子树节点 → 只替换该子树占用的行范围，
 * 每行输出「2 空格 × 新层级 + 原始行（含符号，原样保留）」。子树之外的行保持字节不变。
 */
export function applyReorder(rawText: string, plan: ReorderEntry[]): string {
  if (plan.length === 0) {
    return rawText;
  }

  const roots = parseForgeTree(rawText);
  const byPath = new Map<string, ForgeNode>();
  const flatten = (nodes: ForgeNode[]) => {
    for (const n of nodes) {
      byPath.set(n.path, n);
      flatten(n.children);
    }
  };
  flatten(roots);

  const atoms = plan.map((e) => {
    const node = byPath.get(e.path);
    if (!node) {
      throw new Error(`重排方案引用了不存在的节点：${e.path}`);
    }
    return node;
  });

  const minLine = Math.min(...atoms.map((n) => n.line));
  const maxLine = Math.max(...atoms.map((n) => n.line));

  const newline = rawText.includes("\r\n") ? "\r\n" : "\n";
  const lines = rawText.split(/\r\n|\n/);
  const outLines = plan.map(
    (e) => "  ".repeat(e.depth) + byPath.get(e.path)!.rawLine,
  );

  const result = [
    ...lines.slice(0, minLine),
    ...outLines,
    ...lines.slice(maxLine + 1),
  ];
  return result.join(newline);
}

/**
 * 校验重排前后「整篇」节点的 (符号 + 文本) 多重集是否完全一致（零内容丢失）。
 * 一致返回 null，否则返回错误描述。
 */
export function ensureNoContentLoss(before: string, after: string): string | null {
  const keyOf = (text: string): string[] => {
    const out: string[] = [];
    const flatten = (nodes: ForgeNode[]) => {
      for (const n of nodes) {
        out.push(n.rawLine);
        flatten(n.children);
      }
    };
    flatten(parseForgeTree(text));
    return out.sort();
  };

  const a = keyOf(before);
  const b = keyOf(after);
  if (a.length !== b.length) {
    return "节点数量发生变化";
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return `内容发生改动：原「${a[i]}」→「${b[i]}」`;
    }
  }
  return null;
}
/**
 * 增量整理：diff 判断纯追加、提取标题大纲、拼增量 prompt、解析 AI 返回、插入合并。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 */

import { Reference, buildReferenceSection } from "./references";

/** 行级 diff 结果。 */
export interface AppendDiff {
  /** 是否纯追加（旧行全部保留在前缀）。 */
  isAppend: boolean;
  /** 新增的文本（原样保留换行）。 */
  added: string;
}

/** 归一化单行：忽略行尾 \r 与空白，避免 CRLF/LF 或 trim 导致整段失配。 */
function normalizeLine(line: string): string {
  return line.replace(/\r$/, "").replace(/[ \t]+$/, "");
}

/** 比较两次原文：判断是否「纯追加」，并取出新增部分。 */
export function diffAppend(prev: string, current: string): AppendDiff {
  if (prev.trim() === "") {
    return { isAppend: true, added: current };
  }
  const prevLines = prev.split("\n");
  const currLines = current.split("\n");
  let i = 0;
  while (
    i < prevLines.length &&
    i < currLines.length &&
    normalizeLine(prevLines[i]) === normalizeLine(currLines[i])
  ) {
    i++;
  }
  const isAppend = i === prevLines.length;
  const added = currLines.slice(i).join("\n");
  return { isAppend, added };
}

/** 更通用的增量 diff：用 LCS 识别「纯新增」（追加 / 中间插入），
 *  返回新增文本；一旦检测到删改已有行（含改写缩进子层、换序），返回 null 回退整篇。 */
export function diffIncremental(prev: string, current: string): string | null {
  if (prev.trim() === "") {
    return current;
  }
  const { added, removed } = lcsDiff(prev.split("\n"), current.split("\n"));
  if (removed.length > 0) {
    return null; // 删 / 改了已有行，无法增量
  }
  const addedText = added.join("\n");
  return addedText.trim() ? addedText : null;
}

/** 行级 LCS diff：返回 curr 相对 prev 新增的行、被删改的行（按归一化文本匹配）。
 *  按序列匹配（非集合），对重复行也稳健；纯逻辑、无副作用。 */
function lcsDiff(
  prevLines: string[],
  currLines: string[],
): { added: string[]; removed: string[] } {
  const n = prevLines.length;
  const m = currLines.length;
  const prevNorm = prevLines.map(normalizeLine);
  const currNorm = currLines.map(normalizeLine);

  // dp[i][j] = prevNorm[0..i) 与 currNorm[0..j) 的 LCS 长度。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (prevNorm[i - 1] === currNorm[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const prevInLcs = new Array(n).fill(false);
  const currInLcs = new Array(m).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (prevNorm[i - 1] === currNorm[j - 1]) {
      prevInLcs[i - 1] = true;
      currInLcs[j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return {
    added: currLines.filter((_, idx) => !currInLcs[idx]),
    removed: prevLines.filter((_, idx) => !prevInLcs[idx]),
  };
}

/** 提取 markdown 的标题行（# ~ ######），拼成大纲文本。 */
export function extractOutline(markdown: string): string {
  return markdown
    .split("\n")
    .filter((l) => /^#{1,6}\s/.test(l))
    .join("\n");
}

/** 拼增量 prompt：规则 + 已有大纲 + 新增速记 + 输出 JSON 要求。 */
export function buildIncrementalPrompt(
  promptText: string,
  outline: string,
  added: string,
  references?: Reference[],
): string {
  return [
    promptText,
    "",
    "# 已有笔记结构（标题大纲）",
    outline,
    "",
    "# 新增速记（只整理以下内容，不要重写已有部分）",
    "```text",
    added,
    "```",
    buildReferenceSection(references),
    "# 任务",
    "把上面的新增速记整理成笔记片段，判断它应插入到「已有笔记结构」的哪个标题下面。",
    "只输出一个 JSON（不要任何解释、不要代码围栏）：",
    '{"anchor":"已有大纲里的某个标题（如 ## 队列；没有合适的就填 END）","content":"整理好的 markdown 片段（用 ### 及以下标题 + 无序列表）"}',
  ]
    .filter((s) => s !== "")
    .join("\n");
}

/** 增量结果。 */
export interface IncrementalResult {
  anchor: string;
  content: string;
}

/** 解析 AI 返回的 JSON；失败返回 null。 */
export function parseIncrementalResult(raw: string): IncrementalResult | null {
  const text = raw.trim();
  const candidates: string[] = [
    text,
    text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim(),
  ];
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    candidates.push(m[0]);
  }

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (
        obj &&
        typeof obj.anchor === "string" &&
        typeof obj.content === "string" &&
        obj.content.trim()
      ) {
        return { anchor: obj.anchor.trim(), content: obj.content.trim() };
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
}

/** 归一化标题文本：去 markdown 强调/代码、空白、大小写差异，用于 anchor 降级匹配。 */
function normalizeHeading(s: string): string {
  return s
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 在 markdown 行里定位 anchor 标题，三级降级：精确 → 归一化 → 互相包含。
 *  anchor 可带 `##` 前缀（AI 可能原样返回）；找不到返回 -1。 */
function findAnchorIndex(lines: string[], anchor: string): number {
  const a = anchor.trim().replace(/^#{1,6}\s*/, "").trim();
  if (!a) {
    return -1;
  }
  const headings = lines
    .map((l, idx) => ({ idx, text: l.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim() ?? "" }))
    .filter((h) => h.text !== "");

  // 1) 精确匹配
  let hit = headings.find((h) => h.text === a);
  if (hit) return hit.idx;

  // 2) 归一化匹配
  const na = normalizeHeading(a);
  hit = headings.find((h) => normalizeHeading(h.text) === na);
  if (hit) return hit.idx;

  // 3) 互相包含（较短一侧至少 2 字符，避免过短误匹配）
  if (na.length >= 2) {
    hit = headings.find((h) => {
      const hn = normalizeHeading(h.text);
      return hn.length >= 2 && (hn.includes(na) || na.includes(hn));
    });
    if (hit) return hit.idx;
  }

  return -1;
}

/** 把 content 插入到 anchor 标题所在小节末尾；anchor 找不到 / 为 END 则追加文末。 */
export function insertIntoMarkdown(
  markdown: string,
  anchor: string,
  content: string,
): string {
  const a = anchor.trim();
  const trimmed = markdown.replace(/\s+$/, "");
  const body = content.trim();

  if (!a || a === "END") {
    return `${trimmed}\n\n${body}\n`;
  }

  const lines = trimmed.split("\n");
  const anchorIdx = findAnchorIndex(lines, a);

  if (anchorIdx === -1) {
    return `${trimmed}\n\n${body}\n`;
  }

  const anchorLevel = countHashes(lines[anchorIdx]);

  // 小节末尾 = 下一个「同层级或更高层级」标题之前。
  let insertIdx = lines.length;
  for (let j = anchorIdx + 1; j < lines.length; j++) {
    if (/^#{1,6}\s/.test(lines[j]) && countHashes(lines[j]) <= anchorLevel) {
      insertIdx = j;
      break;
    }
  }

  const before = lines.slice(0, insertIdx).join("\n").trimEnd();
  const after = lines.slice(insertIdx).join("\n").trimStart();
  return [before, body, after].filter((s) => s !== "").join("\n\n") + "\n";
}

/** 行首 # 数量（标题层级）。 */
function countHashes(line: string): number {
  const m = line.match(/^#+/);
  return m ? m[0].length : 0;
}

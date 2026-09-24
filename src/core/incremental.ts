/**
 * 增量整理：diff 判断纯追加、提取标题大纲、拼增量 prompt、解析 AI 返回、插入合并。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 */

/** 行级 diff 结果。 */
export interface AppendDiff {
  /** 是否纯追加（旧行全部保留在前缀）。 */
  isAppend: boolean;
  /** 新增的文本（原样保留换行）。 */
  added: string;
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
    prevLines[i] === currLines[i]
  ) {
    i++;
  }
  const isAppend = i === prevLines.length;
  const added = currLines.slice(i).join("\n");
  return { isAppend, added };
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
    "",
    "# 任务",
    "把上面的新增速记整理成笔记片段，判断它应插入到「已有笔记结构」的哪个标题下面。",
    "只输出一个 JSON（不要任何解释、不要代码围栏）：",
    '{"anchor":"已有大纲里的某个标题（如 ## 队列；没有合适的就填 END）","content":"整理好的 markdown 片段（用 ### 及以下标题 + 无序列表）"}',
  ].join("\n");
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
  const anchorIdx = lines.findIndex((l) => {
    const m = l.match(/^#{1,6}\s+(.+)$/);
    return m ? m[1].trim() === a : false;
  });

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

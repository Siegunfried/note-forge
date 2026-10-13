/**
 * PDF 导入：把 PDF 提取出的文本块（带字号/坐标）结构化成行 → 识别标题层级 → 映射为 .forge。
 * 纯逻辑、无 VSCode 依赖，便于单测。pdfjs-dist 的实际提取在 pdfExtractor.ts，这里只吃 DocBlock[]。
 *
 * 双通道：
 * - 文本型 PDF：有字号信息，规则初筛（标题按字号）+ AI 精加工映射 Forge 符号。
 * - 扫描型 PDF：几乎无文本/字号，需走视觉 OCR 通道（第二期），由 isScannedPdf 探测拦截。
 */

import { SYMBOLS } from "./symbols";

/** 一个文本块（来自 pdfjs 文本项）。 */
export interface DocBlock {
  /** 文本内容。 */
  text: string;
  /** 字号（pt）；扫描版可能为 undefined。 */
  fontSize?: number;
  /** 页面内 Y 坐标（大 = 靠上）。 */
  y?: number;
  /** 页面内 X 坐标（左 → 右）。 */
  x?: number;
  /** 页码（0-based）。 */
  page: number;
  /** 是否粗体。 */
  bold?: boolean;
}

/** 合并后的一行文本（同页同基线相邻的块拼成一行）。 */
export interface TextLine {
  text: string;
  /** 行内最大字号（代表性字号）。 */
  fontSize: number;
  /** 行基线 Y（用首块）。 */
  y: number;
  /** 页码（0-based）。 */
  page: number;
  bold: boolean;
}

/** 结构化后的一行（带标题层级/正文角色）。 */
export interface StructuredLine {
  text: string;
  /** 标题深度（0 起）；正文为 -1。 */
  level: number;
  kind: "heading" | "body";
  fontSize: number;
  page: number;
}

/** 同一行合并的 Y 容差（pt）。 */
const LINE_Y_TOLERANCE = 3;

/** 把文本块按 (页, 行) 合并成行：先按页、再按 Y 降序（从上到下）、X 升序（从左到右）。 */
export function blocksToLines(blocks: DocBlock[]): TextLine[] {
  const sorted = [...blocks].sort((a, b) => {
    if (a.page !== b.page) {
      return a.page - b.page;
    }
    if ((a.y ?? 0) !== (b.y ?? 0)) {
      return (b.y ?? 0) - (a.y ?? 0);
    }
    return (a.x ?? 0) - (b.x ?? 0);
  });

  const lines: TextLine[] = [];
  for (const b of sorted) {
    const text = b.text ?? "";
    const fontSize = b.fontSize ?? 0;
    const y = b.y ?? 0;
    const last = lines[lines.length - 1];
    // 仅当同页、Y 接近时并入上一行；否则开新行。
    if (last && last.page === b.page && Math.abs(y - last.y) <= LINE_Y_TOLERANCE) {
      last.text = last.text ? `${last.text} ${text}`.trim() : text;
      last.fontSize = Math.max(last.fontSize, fontSize);
      last.bold = last.bold || !!b.bold;
    } else {
      lines.push({ text, fontSize, y, page: b.page, bold: !!b.bold });
    }
  }
  return lines;
}

/** 中位数。 */
function median(xs: number[]): number {
  if (xs.length === 0) {
    return 0;
  }
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 规则初筛结构：以「正文中位字号」为基准，显著更大的字号判为标题并按字号降序分档定级。
 * 字号信息缺省或全一致时退化为「全文正文」（交给 AI 精加工）。
 */
export function detectStructure(lines: TextLine[]): StructuredLine[] {
  const nonEmpty = lines.filter((l) => l.text.trim() !== "");
  if (nonEmpty.length === 0) {
    return [];
  }
  const sizes = nonEmpty.map((l) => l.fontSize).filter((s) => s > 0);
  const body = median(sizes);

  // 标题字号档位（显著大于正文），降序排序即层级 0、1、2…
  const headingSizes = Array.from(
    new Set(sizes.filter((s) => s >= body * 1.1)),
  ).sort((a, b) => b - a);
  const levelOfSize = new Map<number, number>();
  headingSizes.forEach((s, i) => levelOfSize.set(s, i));

  return lines.map((l) => {
    const size = l.fontSize > 0 ? l.fontSize : body;
    const isHeading =
      l.text.trim() !== "" && sizes.length > 0 && levelOfSize.has(size);
    return {
      text: l.text.trim(),
      level: isHeading ? (levelOfSize.get(size) as number) : -1,
      kind: isHeading ? "heading" : "body",
      fontSize: size,
      page: l.page,
    };
  });
}

/** 疑似扫描版：无任何文本，或仅有极少数块带可靠字号（需走 OCR 视觉通道）。 */
export function isScannedPdf(blocks: DocBlock[]): boolean {
  const meaningful = blocks.filter((b) => (b.text ?? "").trim() !== "");
  if (meaningful.length === 0) {
    return true;
  }
  const withSize = meaningful.filter((b) => (b.fontSize ?? 0) > 0);
  return withSize.length < meaningful.length * 0.5;
}

/** 生成符号表（与 symbols.ts 单一事实来源一致，精简版）。 */
function symbolTable(): string {
  return SYMBOLS.map((s) => `\`${s.char}\` ${s.name}：${s.meaning}`).join("\n");
}

/**
 * 构建「规则初筛 → AI 精加工映射 Forge 符号」的 prompt。
 * 输入是带角色标注的结构化行，输出是符合 .forge 语法的缩进速记。
 */
export function buildForgePrompt(lines: StructuredLine[]): string {
  const content = lines
    .map((l) => {
      const role = l.kind === "heading" ? `[H${l.level + 1}]` : "[正文]";
      return `${role} ${l.text}`;
    })
    .join("\n");

  return `# 角色
你是文档结构化助手，把文档的层级内容转换为 Note Forge 速记（.forge）。

# 输入说明
下面是从文档提取的内容行，每行开头的方括号标注层级角色：[H1] 一级标题、[H2] 二级标题、[H3] 三级标题…；[正文] 普通段落内容。

# 符号表（用这些符号标注你的输出）
${symbolTable()}

# 任务与规则
1. 把输入整理成符合 .forge 语法的缩进树：缩进 = 层级（2 空格一层），章节标题用 \`# 标题\`，其下内容缩进一层。
2. 保留核心论点、关键概念、层级关系、重要数据与结论；去掉冗余语气词、重复段落、页眉页脚页码、目录。
3. 合理选用符号：概念下定义用 \`$ 术语\`、举例用 \`= 例子\`、重点用 \`!\`、公式用 \`~\`、存疑用 \`?\`、自己的思考用 \`%\` 等；仅结构划分可用 \`## 章节名\`。不要编造原文没有的内容。
4. 严格只使用符号表里的符号，绝不夹带任何符号表以外的标记；每一行一条速记（符号 + 内容）。

# 输出
直接输出 .forge 文本（每行一个速记条目，缩进表层级），不要代码围栏、不要解释、不要任何前言后语。

# 待结构化的内容
\`\`\`text
${content}
\`\`\``;
}

/**
 * 构建扫描版 PDF 的「视觉 OCR → 直接产出 .forge」prompt。
 * 输入是页面图片，视觉模型负责识别 + 结构化 + 符号映射，一步到位。
 */
export function buildOcrPrompt(pageCount: number): string {
  return `# 角色
你是 OCR 结构化助手，把扫描版文档的页面图片识别并转换为 Note Forge 速记（.forge）。

# 符号表（用这些符号标注你的输出）
${symbolTable()}

# 任务与规则
1. 依据页面图片的排版，识别标题层级（字号大小、编号、加粗等）与正文，整理成 .forge 缩进树（2 空格一层），章节/主题起点用 \`# 标题\`。
2. 保留核心论点、关键概念、层级关系、重要数据与结论；去掉页眉页脚、页码、冗余语气词。
3. 合理选用符号：概念下定义用 \`$ 术语\`、举例用 \`= 例子\`、重点用 \`!\`、公式用 \`~\`、存疑用 \`?\`、自己的思考用 \`%\`；仅结构划分可用 \`## 章节名\`。不要编造原文没有的内容。
4. 严格只使用符号表里的符号，绝不夹带符号表以外的标记；每一行一条速记（符号 + 内容）。

# 输出
直接输出 .forge 文本（把多页内容合并为一个 .forge，按页面前后顺序组织章节），不要代码围栏、不要解释、不要任何前言后语。

# 页面
共 ${pageCount} 张页面图片，请逐页识别。`;
}

/**
 * 规则初筛后直接生成一份 .forge 草稿（无 AI 的确定性回退，供离线/预览）。
 * 标题用 \`#\`，正文挂在最近标题下缩进一层。
 */
export function forgeSketch(lines: StructuredLine[]): string {
  const out: string[] = [];
  let lastLevel = -1;
  for (const l of lines) {
    if (l.text === "") {
      continue;
    }
    if (l.kind === "heading") {
      lastLevel = l.level;
      out.push(`${"  ".repeat(l.level)}# ${l.text}`);
    } else {
      out.push(`${"  ".repeat(Math.max(lastLevel + 1, 0))}${l.text}`);
    }
  }
  return out.join("\n") + "\n";
}
/**
 * 行解析：把一行速记拆成「符号标记 / 用户要求 / 实际内容」。
 * 从符号库（symbols.ts）匹配预设处理模板，供 AI prompt 拼接。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 */

import { SymbolDef, SYMBOL_BY_CHAR } from "./symbols";
import { PURE_HEADING_MARK } from "./forgeTree";

/** 是否为纯章节标题标记（##）：不生成正文，仅作为结构标题。 */
export function isPureHeadingMark(symbol: string): boolean {
  return symbol === PURE_HEADING_MARK;
}

/** 把符号串拆成按顺序的 SymbolDef（未知/非法字符跳过）。 */
export function resolveSymbols(symbol: string): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const ch of symbol) {
    const d = SYMBOL_BY_CHAR.get(ch);
    if (d) {
      defs.push(d);
    }
  }
  return defs;
}

/** 根据行首符号生成「本条要求」文本（仅含本条命中的符号的预设处理模板）。 */
export function buildSymbolDirective(symbol: string): string {
  if (isPureHeadingMark(symbol)) {
    return "本条是纯章节标题，仅用于结构层级，不生成任何正文内容。";
  }
  const defs = resolveSymbols(symbol);
  if (defs.length === 0) {
    return "无标记：按常规补全、展开、结构化这一条内容。";
  }
  return defs.map((d) => `- \`${d.char}\` ${d.name}：${d.action}`).join("\n");
}
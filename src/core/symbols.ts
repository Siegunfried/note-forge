/**
 * 9 个标记符号的唯一定义（单一事实来源）。
 * 语法高亮由 syntaxes/notes.tmLanguage.json 单独声明，
 * 但符号的「含义 / 处理 / 标注」以这里为准，README 与内置 prompt 均与之对齐。
 */

export interface SymbolDef {
  /** 符号字符（单字符）。 */
  char: string;
  /** 中文名。 */
  name: string;
  /** 含义。 */
  meaning: string;
  /** 助手的处理方式。 */
  action: string;
  /** 成品中的标注。 */
  annotation: string;
  /** 主题色建议（仅供 UI 参考；实际高亮色由主题决定）。 */
  color: string;
}

export const SYMBOLS: SymbolDef[] = [
  { char: "_", name: "补全",   meaning: "没记完 / 没记全",     action: "按常规结构补全",         annotation: "【补】",       color: "#9a9a9a" },
  { char: "?", name: "疑问",   meaning: "有疑问 / 拿不准",     action: "详细解答 + 注明依据",     annotation: "【答】/【待确认】", color: "#ce9178" },
  { char: "!", name: "重点",   meaning: "重点",                 action: "加粗突出，不得丢失",     annotation: "【重点】",     color: "#c586c0" },
  { char: "~", name: "公式化", meaning: "大概意思 / 粗略记法", action: "转写成严格公式",         annotation: "【公式化】",   color: "#b5cea8" },
  { char: "%", name: "思考",   meaning: "自己的思考 / 批注",   action: "转成注释（引用块）",     annotation: "【思考】",     color: "#6a9955" },
  { char: "#", name: "详解",   meaning: "需要进一步解释",       action: "补充背景/原理/举例",     annotation: "【详解】",     color: "#569cd6" },
  { char: "@", name: "联网",   meaning: "联网扩展",             action: "联网检索补充 + 来源",    annotation: "【外查】",     color: "#4ec9b0" },
  { char: "=", name: "原文",   meaning: "原文 / 逐字保留",     action: "原样保留不改写",         annotation: "【原文】",     color: "#9cdcfe" },
  { char: "&", name: "对比",   meaning: "易混淆 / 需对比",     action: "生成对比表",             annotation: "【对比】",     color: "#dcdcaa" },
];

/** 所有符号字符连成串，用于构造正则（这些字符在字符类里均为字面量，无需转义）。 */
export const SYMBOL_CHARS = SYMBOLS.map((s) => s.char).join("");

/** 判断某字符是否为标记符号。 */
export function isSymbolChar(ch: string): boolean {
  return SYMBOL_CHARS.includes(ch);
}

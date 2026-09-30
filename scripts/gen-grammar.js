#!/usr/bin/env node
/**
 * 从 symbols.ts（编译产物 out/core/symbols.js）生成两份语法高亮文件：
 *   - syntaxes/forge.tmLanguage.json  （.forge 语言，scopeName source.forge）
 *   - syntaxes/notes.tmLanguage.json  （注入 markdown / plaintext，scopeName inline.note-forge）
 * 加新符号只需改 src/core/symbols.ts，跑 `npm run compile` 即自动同步。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const symbols = require(path.join(ROOT, "out", "core", "symbols.js")).SYMBOLS;

/** 转义正则元字符（用于单个字符的 inner match，如 ? $）。 */
function escapeRegExp(ch) {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch;
}

// 字符类里的这些符号均为字面量，无需转义。
const charClass = symbols.map((s) => s.char).join("");

const innerPatterns = symbols.map((s) => ({
  name: s.scope,
  match: escapeRegExp(s.char),
}));

function buildGrammar(scopeName) {
  return {
    scopeName,
    patterns: [
      {
        match: `^[ \\t]*([${charClass}]+)(?=\\s|\\{|$)`,
        captures: { "1": { patterns: innerPatterns } },
      },
    ],
  };
}

fs.mkdirSync(path.join(ROOT, "syntaxes"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "syntaxes", "forge.tmLanguage.json"),
  JSON.stringify(buildGrammar("source.forge"), null, 2) + "\n",
);
fs.writeFileSync(
  path.join(ROOT, "syntaxes", "notes.tmLanguage.json"),
  JSON.stringify(buildGrammar("inline.note-forge"), null, 2) + "\n",
);

console.log(`gen-grammar: 已生成语法高亮（${symbols.length} 个符号）`);

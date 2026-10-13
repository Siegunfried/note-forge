import { test } from "node:test";
import { equal } from "node:assert/strict";
import { parseForgeTree, isUnclear, subtreeHasUnclear } from "./forgeTree";

test("按缩进解析成树，符号与正文分离", () => {
  const roots = parseForgeTree("# 序列\n  = an=n^2\n# 函数");
  equal(roots.length, 2);
  equal(roots[0].path, "0");
  equal(roots[0].symbol, "#");
  equal(roots[0].text, "序列");
  equal(roots[0].children.length, 1);
  equal(roots[0].children[0].path, "0.0");
  equal(roots[0].children[0].symbol, "=");
  equal(roots[0].children[0].text, "an=n^2");
  equal(roots[1].path, "1");
});

test("叠加符号整体保留在 symbol", () => {
  const roots = parseForgeTree("!? 重点且存疑");
  equal(roots[0].symbol, "!?");
  equal(roots[0].text, "重点且存疑");
});

test("@ 是链接内容符号：带或不带空格都落成内容节点", () => {
  const roots = parseForgeTree("@ https://example.com\n@ 示意图.png");
  equal(roots.length, 2);
  equal(roots[0].symbol, "@");
  equal(roots[0].text, "https://example.com");
  equal(roots[1].symbol, "@");
  equal(roots[1].text, "示意图.png");
});

test("+ 是没听懂标注符，剥离为 symbol，正文保留", () => {
  const roots = parseForgeTree("+ 泰勒展开");
  equal(roots[0].symbol, "+");
  equal(roots[0].text, "泰勒展开");
});

test("isUnclear / subtreeHasUnclear：子树含 + 时父章节也标注", () => {
  const roots = parseForgeTree("# 主题\n  + 子点\n  = 普通点");
  equal(roots[0].children[0].symbol, "+");
  equal(isUnclear(roots[0].children[0]), true);
  equal(isUnclear(roots[0]), false);
  equal(subtreeHasUnclear(roots[0]), true);
});

test("## 连续标记识别为纯章节标题，剥离 symbol 与正文", () => {
  const roots = parseForgeTree("## 序列\n  = an=n^2");
  equal(roots.length, 1);
  equal(roots[0].symbol, "##");
  equal(roots[0].text, "序列");
  equal(roots[0].pureHeading, true);
  equal(roots[0].children.length, 1);
});

test("## 后接行尾（无正文）也是纯章节标题", () => {
  const roots = parseForgeTree("##");
  equal(roots[0].symbol, "##");
  equal(roots[0].pureHeading, true);
  equal(roots[0].text, "");
});

test("# 单符号标题节点是普通标题，不是纯章节", () => {
  const roots = parseForgeTree("# 函数");
  equal(roots[0].symbol, "#");
  equal(roots[0].pureHeading, false);
});

test("## 后紧邻文字（无空白）不是纯章节标题", () => {
  const roots = parseForgeTree("##abc");
  equal(roots[0].pureHeading, false);
});

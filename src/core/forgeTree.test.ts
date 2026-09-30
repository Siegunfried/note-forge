import { test } from "node:test";
import { equal } from "node:assert/strict";
import { parseForgeTree } from "./forgeTree";

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

test("@ 带空格是引用被跳过；不带空格落成内容节点", () => {
  const roots = parseForgeTree("@ file.md\n@file.md\n主题");
  equal(roots.length, 2);
  equal(roots[0].symbol, "@");
  equal(roots[0].text, "file.md");
  equal(roots[1].text, "主题");
});

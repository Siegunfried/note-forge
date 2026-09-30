import { test } from "node:test";
import { ok, equal } from "node:assert/strict";
import { parseForgeTree } from "./forgeTree";
import { assembleMarkdown } from "./mdAssemble";

test("顶层叶子内容行不生成标题", () => {
  const roots = parseForgeTree("= 一个例子");
  const md = assembleMarkdown(roots, { "0": "- 例：这是例子" });
  ok(!md.includes("# "), "顶层 = 例 不应有 # 标题");
  ok(md.includes("- 例：这是例子"));
});

test("顶层话题节点生成标题且编号递增", () => {
  const roots = parseForgeTree("$ 序列\n  = an=n^2\n# 函数");
  const md = assembleMarkdown(roots, {
    "0": "定义内容",
    "0.0": "- 例：an=n^2",
    "1": "深挖内容",
  });
  ok(md.includes("# 1 序列"));
  ok(md.includes("# 2 函数"));
  ok(md.includes("- 例：an=n^2"));
});

test("空内容不产生空标题", () => {
  const roots = parseForgeTree("# 快排");
  const md = assembleMarkdown(roots, { "0": "" });
  equal(md.trim(), "# 1 快排");
});

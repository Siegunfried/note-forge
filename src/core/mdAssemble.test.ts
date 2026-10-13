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
    "1": "标题内容",
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

test("顶层 $ 定义（无子节点）也生成标题", () => {
  const roots = parseForgeTree("$ 群的定义");
  const md = assembleMarkdown(roots, { "0": "定义内容" });
  ok(md.includes("# 1 群的定义"));
});

test("疑问（?）作为批注用引用块包裹，不升级成标题", () => {
  const roots = parseForgeTree("$ 集合\n  ? 怎么证单射满射");
  const md = assembleMarkdown(roots, {
    "0": "集合的定义",
    "0.0": "> 单射满射的证明如下……",
  });
  ok(md.includes("# 1 集合"), "集合应是标题");
  ok(md.includes("> 单射满射的证明如下……"), "疑问应以引用块输出");
  ok(!md.includes("# 1.1"), "疑问不应生成子标题");
});

test("思考（%）作为批注用引用块包裹，不升级成标题", () => {
  const roots = parseForgeTree("# 算法\n  % 我觉得复杂度是 O(n^2)");
  const md = assembleMarkdown(roots, {
    "0": "算法概述",
    "0.0": "> 我推测复杂度是 O(n^2)……",
  });
  ok(md.includes("# 1 算法"));
  ok(md.includes("> 我推测复杂度是 O(n^2)……"));
  ok(!md.includes("# 1.1"), "思考不应生成子标题");
});

test("批注节点带子内容也整体归入引用块，不升级", () => {
  const roots = parseForgeTree("$ 集合\n  ? 为什么\n    % 我的猜测");
  const md = assembleMarkdown(roots, {
    "0": "集合的定义",
    "0.0": "> 为什么这样……",
    "0.0.0": "> 我的猜测是……",
  });
  ok(md.includes("# 1 集合"));
  ok(md.includes("> 为什么这样……"), "疑问应进引用块");
  ok(md.includes("> 我的猜测是……"), "思考子内容也应进引用块");
  ok(!md.includes("# 1.1"), "批注及其子树都不应生成标题");
});

test("纯章节标题（##）生成标题，使用书面化标题而非原文并跳过正文", () => {
  const roots = parseForgeTree("## 序列的性质\n  = an=n^2");
  const md = assembleMarkdown(
    roots,
    { "0.0": "- 例：an=n^2" },
    { "0": "数列基本性质" },
  );
  ok(md.includes("# 1 数列基本性质"), "纯章节应使用书面化标题");
  ok(!md.includes("序列的性质"), "原文速记标题不应直接出现在成品里");
  ok(md.includes("- 例：an=n^2"));
});

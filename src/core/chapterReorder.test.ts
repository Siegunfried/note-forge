import { test } from "node:test";
import { equal, ok, match } from "node:assert/strict";
import { parseForgeTree } from "./forgeTree";
import {
  subtreeNodes,
  buildReorderPrompt,
  parseReorderPlan,
  validateReorderPlan,
  applyReorder,
  ensureNoContentLoss,
} from "./chapterReorder";

test("subtreeNodes 按 DFS 前序收集含自身的整棵子树", () => {
  const roots = parseForgeTree("# 主题\n  # 应用\n    = 例子\n  # 定义");
  const node = roots[0];
  const paths = subtreeNodes(node).map((n) => n.path);
  equal(paths.join(","), "0,0.0,0.0.0,0.1");
});

test("buildReorderPrompt 包含子树全部路径与原始行", () => {
  const roots = parseForgeTree("# 主题\n  # 应用\n  = 例子");
  const prompt = buildReorderPrompt(roots[0]);
  match(prompt, /0 \| # 主题/);
  match(prompt, /0\.0 \| # 应用/);
  match(prompt, /0\.1 \| = 例子/);
});

test("parseReorderPlan 解析缩进路径，忽略围栏与解释行", () => {
  const text = "这里是重排结果：\n```\n0\n  0.1\n  0.2\n```";
  const plan = parseReorderPlan(text);
  equal(plan.length, 3);
  equal(plan[0].path, "0");
  equal(plan[0].depth, 0);
  equal(plan[1].path, "0.1");
  equal(plan[1].depth, 1);
  equal(plan[2].path, "0.2");
  equal(plan[2].depth, 1);
});

test("parseReorderPlan 容错：行首空格按层级(floor(列/2))解析", () => {
  const plan = parseReorderPlan("0\n  0.0\n    0.1"); // 0 空格 / 2 空格 / 4 空格
  equal(plan[0].depth, 0);
  equal(plan[1].depth, 1);
  equal(plan[2].depth, 2);
});

test("validateReorderPlan：合法方案通过；根节点居首层级 0", () => {
  const atomPaths = new Set(["0", "0.0", "0.1"]);
  const plan = parseReorderPlan("0\n  0.1\n  0.0");
  equal(validateReorderPlan(plan, atomPaths, "0"), null);
});

test("validateReorderPlan：缺漏节点报错", () => {
  const atomPaths = new Set(["0", "0.0", "0.1"]);
  const plan = parseReorderPlan("0\n  0.1");
  const err = validateReorderPlan(plan, atomPaths, "0");
  ok(err !== null);
  match(err!, /数量不一致/);
});

test("validateReorderPlan：重复路径报错", () => {
  const atomPaths = new Set(["0", "0.0", "0.1"]);
  const plan = parseReorderPlan("0\n  0.1\n  0.1");
  const err = validateReorderPlan(plan, atomPaths, "0");
  ok(err !== null);
  match(err!, /重复/);
});

test("validateReorderPlan：越界节点报错", () => {
  const atomPaths = new Set(["0", "0.0", "0.1"]);
  const plan = parseReorderPlan("0\n  0.0\n  9.9");
  const err = validateReorderPlan(plan, atomPaths, "0");
  ok(err !== null);
  match(err!, /不在范围内/);
});

test("validateReorderPlan：层级跳级报错", () => {
  const atomPaths = new Set(["0", "0.0"]);
  const plan = parseReorderPlan("0\n    0.0");
  const err = validateReorderPlan(plan, atomPaths, "0");
  ok(err !== null);
  match(err!, /跳级/);
});

test("validateReorderPlan：根节点不在最前或层级不为 0 报错", () => {
  const atomPaths = new Set(["0", "0.0"]);
  const plan = parseReorderPlan("0.0\n  0");
  let err = validateReorderPlan(plan, atomPaths, "0");
  ok(err !== null);
  const plan2 = [{ path: "0", depth: 1 }, { path: "0.0", depth: 2 }];
  err = validateReorderPlan(plan2, atomPaths, "0");
  ok(err !== null);
});

test("applyReorder：重排顺序 + 层级均生效，内容与符号原样保留", () => {
  const raw = "# 主题\n  # 应用\n    = 例子\n  # 定义\n  # 基础\n";
  const plan = parseReorderPlan("0\n  0.1\n  0.2\n  0.0\n    0.0.0");
  equal(
    applyReorder(raw, plan),
    "# 主题\n  # 定义\n  # 基础\n  # 应用\n    = 例子\n",
  );
});

test("applyReorder：支持改变父归属（重挂父节点）", () => {
  const raw = "# A\n  # B\n  # C\n";
  const plan = parseReorderPlan("0\n  0.0\n    0.1");
  equal(applyReorder(raw, plan), "# A\n  # B\n    # C\n");
});

test("applyReorder：子树之外的行保持字节不变", () => {
  const raw = "# 前置\n  = 保留内容\n# 主题\n  # A\n  # B\n# 后置\n";
  // 选中「# 主题」子树（path 1：1 → 1.0 → 1.1），把 B 提到 A 之前。
  const plan = parseReorderPlan("1\n  1.1\n  1.0");
  const out = applyReorder(raw, plan);
  equal(
    out,
    "# 前置\n  = 保留内容\n# 主题\n  # B\n  # A\n# 后置\n",
  );
});

test("ensureNoContentLoss：重排前后零丢失（含子树外节点）", () => {
  const before = "# 主题\n  # 应用\n    = 例子\n  # 定义\n";
  const plan = parseReorderPlan("0\n  0.1\n  0.0\n    0.0.0");
  const after = applyReorder(before, plan);
  equal(ensureNoContentLoss(before, after), null);
});

test("ensureNoContentLoss：缺失节点被检出", () => {
  const before = "# 主题\n  # 应用\n";
  const after = "# 主题\n";
  const err = ensureNoContentLoss(before, after);
  ok(err !== null);
  match(err!, /数量发生变化/);
});

test("ensureNoContentLoss：内容被改动时被检出", () => {
  const before = "# 主题\n  = 例子\n";
  const after = "# 主题\n  = 偷换\n";
  const err = ensureNoContentLoss(before, after);
  ok(err !== null);
  match(err!, /内容发生改动/);
});
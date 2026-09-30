import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { parseForgeTree, ForgeNode } from "./forgeTree";
import { diffTrees } from "./treeDiff";

function contentsOf(roots: ForgeNode[]): Record<string, string> {
  const c: Record<string, string> = {};
  const walk = (nodes: ForgeNode[]) => {
    for (const n of nodes) {
      c[n.path] = `内容:${n.rawLine}`;
      walk(n.children);
    }
  };
  walk(roots);
  return c;
}

test("移动到不同父节点 → 不复用旧内容（重新展开）", () => {
  const oldRoots = parseForgeTree("# 序列\n  = an=n^2\n# 函数");
  const newRoots = parseForgeTree("# 函数\n  = an=n^2\n# 序列");
  const { changed, reused } = diffTrees(oldRoots, contentsOf(oldRoots), newRoots);

  ok(changed.map((n) => n.rawLine).includes("= an=n^2"), "移动的节点应重新展开");
  ok(
    ![...reused.values()].some((c) => c.includes("an=n^2")),
    "移动的节点不应复用旧内容",
  );
});

test("整棵子树改缩进 → 父文本不变的子节点复用", () => {
  const oldRoots = parseForgeTree("# 快排\n  = 例子\n  & 对比");
  const newRoots = parseForgeTree("父\n  # 快排\n    = 例子\n    & 对比");
  const { changed, reused } = diffTrees(oldRoots, contentsOf(oldRoots), newRoots);

  const reusedValues = [...reused.values()];
  ok(reusedValues.includes("内容:= 例子"), "= 例子 应复用");
  ok(reusedValues.includes("内容:& 对比"), "& 对比 应复用");
  ok(changed.map((n) => n.rawLine).includes("父"));
  ok(changed.map((n) => n.rawLine).includes("# 快排"));
});

test("完全未变 → 全部复用", () => {
  const text = "# 序列\n  = an=n^2\n  & 对比";
  const { changed, reused } = diffTrees(
    parseForgeTree(text),
    contentsOf(parseForgeTree(text)),
    parseForgeTree(text),
  );
  equal(changed.length, 0);
  equal(reused.size, 3);
});

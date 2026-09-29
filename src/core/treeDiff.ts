/**
 * 树级 diff：对齐旧新树，产出需要重新展开的节点 + 复用的内容。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 */

import { ForgeNode, flattenNodes } from "./forgeTree";

/** 树 diff 结果。 */
export interface TreeDiffResult {
  /** 新树中需要重新展开的节点。 */
  changed: ForgeNode[];
  /** 复用的内容：新路径 → 旧内容。 */
  reused: Map<string, string>;
}

/** 对齐旧新树：按「缩进 + 原始行」做 LCS 对齐，未变节点复用旧内容，其余重新展开。 */
export function diffTrees(
  oldRoots: ForgeNode[],
  oldContents: Record<string, string>,
  newRoots: ForgeNode[],
): TreeDiffResult {
  const oldFlat = flattenNodes(oldRoots);
  const newFlat = flattenNodes(newRoots);
  const oldKeys = oldFlat.map((n) => `${n.indent}:${n.rawLine}`);
  const newKeys = newFlat.map((n) => `${n.indent}:${n.rawLine}`);
  const pairs = lcsPairs(oldKeys, newKeys);

  const reused = new Map<string, string>();
  const reusedNewIdx = new Set<number>();
  for (const [oi, ni] of pairs) {
    const content = oldContents[oldFlat[oi].path];
    if (content !== undefined) {
      reused.set(newFlat[ni].path, content);
      reusedNewIdx.add(ni);
    }
  }

  const changed = newFlat.filter((_, i) => !reusedNewIdx.has(i));
  return { changed, reused };
}

/** LCS 对齐，返回匹配的下标对 [oldIdx, newIdx]。 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs.reverse();
}

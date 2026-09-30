/**
 * 树级 diff：对齐旧新树，产出需要重新展开的节点 + 复用的内容。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 *
 * 节点身份 = 「直接父节点文本 + 自身原始行」，不包含绝对缩进：
 * - 移动到不同父节点 → 父文本变 → 身份变 → 失效重排（防止复用错内容）。
 * - 整棵子树改缩进（父文本不变）→ 子节点身份不变 → 复用（避免白烧 token）。
 */

import { ForgeNode } from "./forgeTree";

/** 树 diff 结果。 */
export interface TreeDiffResult {
  /** 新树中需要重新展开的节点。 */
  changed: ForgeNode[];
  /** 复用的内容：新路径 → 旧内容。 */
  reused: Map<string, string>;
}

/** 扁平化条目：节点 + 直接父节点文本。 */
interface FlatEntry {
  node: ForgeNode;
  parentRaw: string | null;
}

/** 深度优先扁平化，附带直接父节点文本（顶层为 null）。 */
function flattenWithParent(roots: ForgeNode[]): FlatEntry[] {
  const out: FlatEntry[] = [];
  const walk = (nodes: ForgeNode[], parentRaw: string | null) => {
    for (const n of nodes) {
      out.push({ node: n, parentRaw });
      walk(n.children, n.rawLine);
    }
  };
  walk(roots, null);
  return out;
}

/** 身份键：父文本 + 自身原始行（用换行分隔，行文本内不会出现换行）。 */
function keyOf(entry: FlatEntry): string {
  return `${entry.parentRaw ?? ""}\n${entry.node.rawLine}`;
}

/** 对齐旧新树：按「父文本 + 原始行」做 LCS 对齐，未变节点复用旧内容，其余重新展开。 */
export function diffTrees(
  oldRoots: ForgeNode[],
  oldContents: Record<string, string>,
  newRoots: ForgeNode[],
): TreeDiffResult {
  const oldFlat = flattenWithParent(oldRoots);
  const newFlat = flattenWithParent(newRoots);
  const oldKeys = oldFlat.map(keyOf);
  const newKeys = newFlat.map(keyOf);
  const pairs =
    oldKeys.length * newKeys.length > MAX_LCS_CELLS
      ? greedyPairs(oldKeys, newKeys)
      : lcsPairs(oldKeys, newKeys);

  const reused = new Map<string, string>();
  const reusedNewIdx = new Set<number>();
  for (const [oi, ni] of pairs) {
    const content = oldContents[oldFlat[oi].node.path];
    if (content !== undefined) {
      reused.set(newFlat[ni].node.path, content);
      reusedNewIdx.add(ni);
    }
  }

  const changed = newFlat
    .filter((_, i) => !reusedNewIdx.has(i))
    .map((e) => e.node);
  return { changed, reused };
}

/** 规模阈值：超过则改用哈希贪心匹配，避免 O(n·m) 时空爆掉。 */
const MAX_LCS_CELLS = 1_000_000;

/** 超大输入时的哈希贪心匹配（近似 LCS，O(n+m)）。 */
function greedyPairs(oldKeys: string[], newKeys: string[]): Array<[number, number]> {
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < oldKeys.length; i++) {
    const arr = byKey.get(oldKeys[i]);
    if (arr) {
      arr.push(i);
    } else {
      byKey.set(oldKeys[i], [i]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let lastOld = -1;
  for (let j = 0; j < newKeys.length; j++) {
    const arr = byKey.get(newKeys[j]);
    if (!arr || arr.length === 0) {
      continue;
    }
    let idx = -1;
    for (let p = 0; p < arr.length; p++) {
      if (arr[p] > lastOld) {
        idx = p;
        break;
      }
    }
    if (idx === -1) {
      continue;
    }
    pairs.push([arr[idx], j]);
    lastOld = arr[idx];
    arr.splice(idx, 1);
  }
  return pairs;
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

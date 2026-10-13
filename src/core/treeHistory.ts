/**
 * 章节/节点树的历史快照（回退 + 前进，保留三步）。
 * 纯逻辑、无 VSCode 依赖，便于单测；持久化由调用方（organize.ts）负责。
 */

/** 单个快照：某次修改前/后的 .forge 全文 + 记录时刻。 */
export interface TreeSnapshot {
  content: string;
  at: number;
}

/** 某文件的树历史：undo / redo 两个栈，栈顶为最近一步。 */
export interface TreeHistory {
  undo: TreeSnapshot[];
  redo: TreeSnapshot[];
}

/** 每侧最多保留的历史步数。 */
export const TREE_HISTORY_LIMIT = 3;

/** 空历史。 */
export function emptyHistory(): TreeHistory {
  return { undo: [], redo: [] };
}

/**
 * 记录一次会改变树的新操作：把「修改前」的内容压入 undo 栈，
 * 并清空 redo 栈（新改动使之前的前进路径失效）。栈上限 LIMIT，超出丢弃最旧。
 */
export function recordChange(
  history: TreeHistory,
  beforeContent: string,
  at: number,
): TreeHistory {
  return {
    undo: pushCapped(history.undo, { content: beforeContent, at }),
    redo: [],
  };
}

/**
 * 回退一步：从 undo 栈顶取出「修改前」内容作为要恢复的结果，
 * 同时把「当前内容」压入 redo 栈以供前进。无栈可退时 restored 为 undefined。
 */
export function undoChange(
  history: TreeHistory,
  currentContent: string,
  at: number,
): { history: TreeHistory; restored?: string } {
  const snap = history.undo[history.undo.length - 1];
  if (!snap) {
    return { history, restored: undefined };
  }
  return {
    history: {
      undo: history.undo.slice(0, -1),
      redo: pushCapped(history.redo, { content: currentContent, at }),
    },
    restored: snap.content,
  };
}

/**
 * 前进一步：从 redo 栈顶取出内容作为要恢复的结果，
 * 同时把「当前内容」压回 undo 栈。无栈可进时 restored 为 undefined。
 */
export function redoChange(
  history: TreeHistory,
  currentContent: string,
  at: number,
): { history: TreeHistory; restored?: string } {
  const snap = history.redo[history.redo.length - 1];
  if (!snap) {
    return { history, restored: undefined };
  }
  return {
    history: {
      undo: pushCapped(history.undo, { content: currentContent, at }),
      redo: history.redo.slice(0, -1),
    },
    restored: snap.content,
  };
}

/** 压栈并限制长度：超过 LIMIT 时丢弃最旧（栈底）。 */
function pushCapped<T>(stack: T[], item: T): T[] {
  const next = [...stack, item];
  while (next.length > TREE_HISTORY_LIMIT) {
    next.shift();
  }
  return next;
}
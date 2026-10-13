import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyHistory,
  recordChange,
  undoChange,
  redoChange,
  TREE_HISTORY_LIMIT,
} from "./treeHistory";

test("recordChange 压入 undo 并清空 redo", () => {
  const h0 = recordChange(emptyHistory(), "v0", 1);
  assert.equal(h0.undo.length, 1);
  assert.equal(h0.undo[0].content, "v0");
  assert.equal(h0.redo.length, 0);
});

test("recordChange 上限三步：超出时丢弃最旧", () => {
  let h = emptyHistory();
  for (const v of ["v0", "v1", "v2", "v3"]) {
    h = recordChange(h, v, 1);
  }
  assert.equal(h.undo.length, TREE_HISTORY_LIMIT);
  assert.deepEqual(
    h.undo.map((s) => s.content),
    ["v1", "v2", "v3"],
  );
});

test("undo 恢复最近快照并把当前压入 redo", () => {
  let h = recordChange(emptyHistory(), "before", 1);
  const r = undoChange(h, "after", 2);
  assert.equal(r.restored, "before");
  assert.equal(r.history.undo.length, 0);
  assert.deepEqual(
    r.history.redo.map((s) => s.content),
    ["after"],
  );
});

test("undo 空栈返回 undefined 且历史不变", () => {
  const r = undoChange(emptyHistory(), "cur", 1);
  assert.equal(r.restored, undefined);
  assert.equal(r.history.undo.length, 0);
});

test("redo 恢复最近快照并把当前压回 undo", () => {
  let h = emptyHistory();
  h = recordChange(h, "v0", 1);
  const u = undoChange(h, "v1", 2); // 回退：v1 → v0，redo 压入 v1
  const r = redoChange(u.history, "v0", 3); // 前进：当前 v0 → 恢复 v1，undo 压回 v0
  assert.equal(r.restored, "v1");
  assert.deepEqual(
    r.history.undo.map((s) => s.content),
    ["v0"],
  );
  assert.equal(r.history.redo.length, 0);
});

test("redo 空栈返回 undefined", () => {
  const r = redoChange(emptyHistory(), "cur", 1);
  assert.equal(r.restored, undefined);
});

test("多次回退/前进往返保持正确", () => {
  let h = emptyHistory();
  h = recordChange(h, "A", 1);
  h = recordChange(h, "B", 2);
  h = recordChange(h, "C", 3); // undo: [A,B,C]

  const u1 = undoChange(h, "D", 4);
  assert.equal(u1.restored, "C");
  const u2 = undoChange(u1.history, "C", 5);
  assert.equal(u2.restored, "B");

  const r1 = redoChange(u2.history, "B", 6);
  assert.equal(r1.restored, "C");
  const r2 = redoChange(r1.history, "C", 7);
  assert.equal(r2.restored, "D");
  assert.equal(r2.history.redo.length, 0);
});
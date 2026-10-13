import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { validateSyntax } from "./validateSyntax";

test("合法：无符号行（# 简写）不报错", () => {
  const issues = validateSyntax("这是标题\n  子内容\n\n");
  equal(issues.length, 0);
});

test("合法：单个结构符", () => {
  equal(validateSyntax("# 标题\n% 思考\n? 疑问\n").length, 0);
});

test("合法：内容 + 形式（~= 公式化+举例）", () => {
  equal(validateSyntax("~= 证明有理数可数\n").length, 0);
});

test("合法：内容 + 结构（*? 深挖+疑问）", () => {
  equal(validateSyntax("*? 为什么这样\n").length, 0);
});

test("合法：修饰 + 内容（!$ 重点+定义）", () => {
  equal(validateSyntax("!$ 可数集\n").length, 0);
});

test("合法：修饰 + 结构（!# 重点+标题）", () => {
  equal(validateSyntax("!# 复习\n").length, 0);
});

test("合法：完整组合（结构+内容+形式+修饰）", () => {
  equal(validateSyntax("#$=! 完整组合\n").length, 0);
});

test("非法：两个结构符（?#）", () => {
  const issues = validateSyntax("?# 疑问+标题\n");
  equal(issues.length, 1);
  equal(issues[0].line, 0);
  equal(issues[0].symbols, "?#");
  ok(issues[0].message.includes("结构"));
});

test("非法：两个结构符（%#）", () => {
  equal(validateSyntax("%# 思考+标题\n").length, 1);
});

test("非法：两个内容符（~$）", () => {
  const issues = validateSyntax("~$ 公式化+定义\n");
  equal(issues.length, 1);
  ok(issues[0].message.includes("内容"));
});

test("非法：两个形式符（=&）", () => {
  const issues = validateSyntax("=& 举例+对比\n");
  equal(issues.length, 1);
  ok(issues[0].message.includes("形式"));
});

test("非法：三个结构符（%#?）", () => {
  equal(validateSyntax("%#? 思考+标题+疑问\n").length, 1);
});

test("非法：两个修饰符（!!）", () => {
  equal(validateSyntax("!! 重点重点\n").length, 1);
});

test("@ 链接行合法，不再跳过", () => {
  equal(validateSyntax("@ 课件.pdf\n").length, 0);
});

test("+ 没听懂标注合法：单独或用叠加内容符", () => {
  equal(validateSyntax("+ 泰勒展开\n").length, 0);
  equal(validateSyntax("+$ 泰勒展开\n").length, 0);
});

test("非法：两个标注符（++）", () => {
  const issues = validateSyntax("++ 没听懂没听懂\n");
  equal(issues.length, 1);
  ok(issues[0].message.includes("标注"));
});

test("非法：两个内容符（@@ 两个链接）", () => {
  const issues = validateSyntax("@@ 两个链接\n");
  equal(issues.length, 1);
  ok(issues[0].message.includes("内容"));
});

test("纯章节标题（##）合法，跳过结构符组合校验", () => {
  equal(validateSyntax("## 序列\n##\n  = an=n^2\n").length, 0);
});

test("多个错误分别定位到行", () => {
  const issues = validateSyntax("# 好\n?# 错1\n~$ 错2\n");
  equal(issues.length, 2);
  equal(issues[0].line, 1);
  equal(issues[1].line, 2);
});

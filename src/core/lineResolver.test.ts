import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import {
  isPureHeadingMark,
  resolveSymbols,
  buildSymbolDirective,
} from "./lineResolver";

test("isPureHeadingMark 只认 ##", () => {
  equal(isPureHeadingMark("##"), true);
  equal(isPureHeadingMark("#"), false);
  equal(isPureHeadingMark(""), false);
  equal(isPureHeadingMark("!?"), false);
});

test("resolveSymbols 按顺序拆出符号定义（未知字符跳过）", () => {
  equal(resolveSymbols("!?").map((d) => d.name).join(","), "重点,疑问");
  equal(resolveSymbols("#").map((d) => d.name).join(","), "标题");
  equal(resolveSymbols("").length, 0);
});

test("resolveSymbols 认出新符号 @ 链接 / + 没听懂", () => {
  equal(resolveSymbols("@").map((d) => d.name).join(","), "链接");
  equal(resolveSymbols("+").map((d) => d.name).join(","), "没听懂");
});

test("buildSymbolDirective 对纯标题给出结构提示，不含符号模板", () => {
  const d = buildSymbolDirective("##");
  ok(d.includes("纯章节标题"), "纯标题应给出结构提示");
  ok(!d.includes("重点"), "纯标题不应注入普通符号处理模板");
});

test("buildSymbolDirective 只注入本条命中的符号模板", () => {
  const d = buildSymbolDirective("!");
  ok(d.includes("重点"), "应注入 ! 重点模板");
  ok(!d.includes("公式化"), "不应注入未命中的 ~ 模板");
});

test("buildSymbolDirective 无标记给常规补全提示", () => {
  const d = buildSymbolDirective("");
  ok(d.includes("无标记"));
});
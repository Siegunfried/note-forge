import { test } from "node:test";
import { equal, ok, match } from "node:assert/strict";
import {
  blocksToLines,
  detectStructure,
  buildForgePrompt,
  forgeSketch,
  isScannedPdf,
} from "./pdfImport";

test("blocksToLines：同页同基线的块合并为一行", () => {
  const lines = blocksToLines([
    { text: "序列是", fontSize: 12, y: 100, x: 10, page: 0 },
    { text: "一种函数", fontSize: 12, y: 100, x: 30, page: 0 },
  ]);
  equal(lines.length, 1);
  equal(lines[0].text, "序列是 一种函数");
  equal(lines[0].fontSize, 12);
});

test("blocksToLines：不同页或 Y 差距超过容差则分行为不同行", () => {
  const lines = blocksToLines([
    { text: "标题", fontSize: 18, y: 100, x: 10, page: 0 },
    { text: "正文", fontSize: 12, y: 90, x: 10, page: 0 },
    { text: "下一页", fontSize: 12, y: 100, x: 10, page: 1 },
  ]);
  equal(lines.length, 3);
  equal(lines.map((l) => l.text).join(","), "标题,正文,下一页");
});

test("blocksToLines：行内字号取最大，粗体任一命中即粗体", () => {
  const lines = blocksToLines([
    { text: "加粗", fontSize: 12, y: 100, x: 10, page: 0, bold: true },
    { text: "小字", fontSize: 8, y: 100, x: 30, page: 0, bold: false },
  ]);
  equal(lines[0].fontSize, 12);
  equal(lines[0].bold, true);
});

test("detectStructure：显著更大的字号判为标题，更大者层级更浅", () => {
  const lines = blocksToLines([
    { text: "第一章", fontSize: 20, y: 130, x: 10, page: 0 },
    { text: "1.1 节", fontSize: 16, y: 120, x: 10, page: 0 },
    { text: "普通正文", fontSize: 12, y: 110, x: 10, page: 0 },
    { text: "更多正文", fontSize: 12, y: 100, x: 10, page: 0 },
    { text: "更多正文", fontSize: 12, y: 90, x: 10, page: 0 },
  ]);
  const structured = detectStructure(lines);
  equal(structured[0].kind, "heading");
  equal(structured[0].level, 0);
  equal(structured[1].kind, "heading");
  equal(structured[1].level, 1);
  equal(structured[2].kind, "body");
  equal(structured[2].level, -1);
});

test("detectStructure：字号全一致时退化为全文正文", () => {
  const lines = blocksToLines([
    { text: "行一", fontSize: 12, y: 120, x: 10, page: 0 },
    { text: "行二", fontSize: 12, y: 110, x: 10, page: 0 },
  ]);
  const structured = detectStructure(lines);
  equal(structured.every((l) => l.kind === "body"), true);
});

test("buildForgePrompt：含符号表与角色标注", () => {
  const structured = detectStructure(
    blocksToLines([
      { text: "第一章", fontSize: 20, y: 120, x: 10, page: 0 },
      { text: "正文", fontSize: 12, y: 100, x: 10, page: 0 },
    ]),
  );
  const prompt = buildForgePrompt(structured);
  match(prompt, /`#` 标题/);
  match(prompt, /\[H1\] 第一章/);
  match(prompt, /\[正文\] 正文/);
});

test("forgeSketch：标题用 #，正文挂在最近标题下缩进一层", () => {
  const structured = detectStructure(
    blocksToLines([
      { text: "第一章", fontSize: 20, y: 130, x: 10, page: 0 },
      { text: "正文一行", fontSize: 12, y: 110, x: 10, page: 0 },
      { text: "正文二行", fontSize: 12, y: 100, x: 10, page: 0 },
      { text: "下一章", fontSize: 20, y: 80, x: 10, page: 0 },
    ]),
  );
  equal(
    forgeSketch(structured),
    "# 第一章\n  正文一行\n  正文二行\n# 下一章\n",
  );
});

test("isScannedPdf：无文本判为扫描版", () => {
  equal(isScannedPdf([]), true);
  equal(isScannedPdf([{ text: "", page: 0 }]), true);
});

test("isScannedPdf：仅有少数块带字号则疑似扫描版", () => {
  const blocks = [
    { text: "a", page: 0 },
    { text: "b", page: 0 },
    { text: "c", page: 0 },
    { text: "d", fontSize: 12, page: 0 },
  ];
  equal(isScannedPdf(blocks), true);
});

test("isScannedPdf：多数块带字号则判为文本型", () => {
  const blocks = [
    { text: "a", fontSize: 12, page: 0 },
    { text: "b", fontSize: 12, page: 0 },
  ];
  equal(isScannedPdf(blocks), false);
});

test("buildForgePrompt 输出标注稳定：空行输入不报错", () => {
  const prompt = buildForgePrompt([]);
  ok(prompt.includes("待结构化的内容"));
});
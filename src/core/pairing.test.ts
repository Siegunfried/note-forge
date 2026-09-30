import { test } from "node:test";
import { equal } from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolvePairing } from "./pairing";

test(".forge 文件 → forge 模式，成品为同名 .md", () => {
  const p = resolvePairing("/a/b/笔记.forge");
  equal(p.mode, "forge");
  equal(p.targetPath, "/a/b/笔记.md");
});

test("无同名 .forge 的 .md → inline 模式", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-"));
  try {
    const p = resolvePairing(path.join(dir, "笔记.md"));
    equal(p.mode, "inline");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("有同名 .forge 的 .md → md-linked 模式", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-"));
  try {
    const forgePath = path.join(dir, "笔记.forge");
    const mdPath = path.join(dir, "笔记.md");
    fs.writeFileSync(forgePath, "");
    const p = resolvePairing(mdPath);
    equal(p.mode, "md-linked");
    equal(p.sourcePath, forgePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

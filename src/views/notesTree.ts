/**
 * 笔记列表视图：扫描工作区的 .forge 文件，按目录分组展示「源 → 成品」两条数据流。
 * 顶部常驻「9 符号速查」作为速记参考。
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { resolvePairing } from "../core/pairing";
import { SYMBOLS } from "../core/symbols";

export type NoteNode =
  | { kind: "dir"; path: string; name: string; children: NoteNode[] }
  | { kind: "forge"; path: string; name: string; targetPath: string; hasTarget: boolean }
  | { kind: "md"; path: string; name: string }
  | { kind: "welcome"; message: string }
  | { kind: "symbols"; children: NoteNode[] }
  | { kind: "symbol"; char: string; name: string; description: string };

export class NotesTreeProvider implements vscode.TreeDataProvider<NoteNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    NoteNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NoteNode): vscode.TreeItem {
    if (element.kind === "dir") {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon("folder");
      item.contextValue = "noteForge.dir";
      return item;
    }

    if (element.kind === "forge") {
      const item = new vscode.TreeItem(
        element.name,
        element.hasTarget
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("note");
      item.contextValue = "noteForge.forge";
      item.command = {
        command: "vscode.open",
        title: "打开",
        arguments: [vscode.Uri.file(element.path)],
      };
      return item;
    }

    if (element.kind === "md") {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("markdown");
      item.contextValue = "noteForge.md";
      item.command = {
        command: "vscode.open",
        title: "打开",
        arguments: [vscode.Uri.file(element.path)],
      };
      return item;
    }

    if (element.kind === "symbols") {
      const item = new vscode.TreeItem(
        "📋 10 符号速查",
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon("book");
      return item;
    }

    if (element.kind === "symbol") {
      const item = new vscode.TreeItem(
        `${element.char}  ${element.name}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = element.description;
      item.tooltip = element.description;
      return item;
    }

    // welcome：纯提示，不可点击（避免误触新建）。
    const item = new vscode.TreeItem(
      element.message,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("info");
    return item;
  }

  async getChildren(element?: NoteNode): Promise<NoteNode[]> {
    if (!element) {
      return scanWorkspace();
    }
    if (element.kind === "dir") {
      return element.children;
    }
    if (element.kind === "forge") {
      return element.hasTarget
        ? [
            {
              kind: "md",
              path: element.targetPath,
              name: path.basename(element.targetPath),
            },
          ]
        : [];
    }
    if (element.kind === "symbols") {
      return element.children;
    }
    return [];
  }
}

/** 顶部常驻的符号速查分组。 */
function buildSymbolsNode(): NoteNode {
  return {
    kind: "symbols",
    children: SYMBOLS.map((s) => ({
      kind: "symbol",
      char: s.char,
      name: s.name,
      description: s.action,
    })),
  };
}

/** 扫描工作区所有 .forge，按目录分组；顶部常驻符号速查。 */
async function scanWorkspace(): Promise<NoteNode[]> {
  const symbols = buildSymbolsNode();

  if (!vscode.workspace.workspaceFolders?.length) {
    return [
      symbols,
      {
        kind: "welcome",
        message: "还没有打开任何文件夹——点标题栏的文件夹按钮，把课程目录加进来",
      },
    ];
  }

  const forgeUris = await vscode.workspace.findFiles("**/*.forge");
  if (forgeUris.length === 0) {
    return [
      symbols,
      {
        kind: "welcome",
        message: "还没有速记——用 ＋ 新建，或用文件夹按钮添加另一门课程的目录",
      },
    ];
  }

  const byDir = new Map<string, vscode.Uri[]>();
  for (const uri of forgeUris) {
    const dir = path.dirname(uri.fsPath);
    const list = byDir.get(dir) ?? [];
    list.push(uri);
    byDir.set(dir, list);
  }

  const dirs = [...byDir.entries()].map(([dir, uris]) => {
    const children = uris.map((u) => {
      const pairing = resolvePairing(u.fsPath);
      return {
        kind: "forge" as const,
        path: u.fsPath,
        name: path.basename(u.fsPath),
        targetPath: pairing.targetPath,
        hasTarget: fs.existsSync(pairing.targetPath),
      };
    });
    children.sort((a, b) => a.name.localeCompare(b.name));
    return {
      kind: "dir" as const,
      path: dir,
      name: path.basename(dir) || dir,
      children,
    };
  });
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return [symbols, ...dirs];
}

/**
 * 符号速查视图：按五类（结构 / 内容 / 形式 / 修饰 / 标注）分组展示标记符号。
 * 侧边栏不再承担文件管理（交给 Explorer），只做「查符号」这一件事。
 */

import * as vscode from "vscode";
import { SYMBOLS, SymbolKind } from "../core/symbols";

export type NoteNode =
  | { kind: "category"; key: SymbolKind; label: string; children: NoteNode[] }
  | { kind: "symbol"; char: string; name: string; description: string };

/** 五类符号的分组标签与顺序。 */
const CATEGORIES: { key: SymbolKind; label: string }[] = [
  { key: "structure", label: "结构" },
  { key: "content", label: "内容" },
  { key: "form", label: "形式" },
  { key: "emphasis", label: "修饰" },
  { key: "flag", label: "标注" },
];

export class NotesTreeProvider implements vscode.TreeDataProvider<NoteNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    NoteNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NoteNode): vscode.TreeItem {
    if (element.kind === "category") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon("symbol-class");
      return item;
    }

    // symbol
    const item = new vscode.TreeItem(
      `${element.char}  ${element.name}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = element.description;
    item.tooltip = element.description;
    return item;
  }

  getChildren(element?: NoteNode): NoteNode[] {
    if (!element) {
      return buildCategoryNodes();
    }
    if (element.kind === "category") {
      return element.children;
    }
    return [];
  }
}

/** 按五类分组，构建顶层分类节点。 */
function buildCategoryNodes(): NoteNode[] {
  return CATEGORIES.map(({ key, label }) => ({
    kind: "category" as const,
    key,
    label,
    children: SYMBOLS.filter((s) => s.kind === key).map((s) => ({
      kind: "symbol" as const,
      char: s.char,
      name: s.name,
      description: s.action,
    })),
  }));
}

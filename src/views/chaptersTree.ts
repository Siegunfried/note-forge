/**
 * 章节树视图：展示当前 .forge 的章节（标题）层级，供「重新生成」时范围选中。
 * 只展示标题节点（isHeadingNode），叶子内容节点不显示。
 */

import * as vscode from "vscode";
import { ForgeNode, isHeadingNode, subtreeHasUnclear } from "../core/forgeTree";

/** 章节树节点。 */
export interface ChapterItem {
  path: string;
  text: string;
  depth: number;
  /** 本节点或其子树是否带「没听懂」（+）标注。 */
  unclear: boolean;
  children: ChapterItem[];
}

/** 从 .forge 树提取章节（标题）层级（纯逻辑，便于单测）。 */
export function buildChapterItems(roots: ForgeNode[]): ChapterItem[] {
  const build = (nodes: ForgeNode[], depth: number): ChapterItem[] => {
    const out: ChapterItem[] = [];
    for (const n of nodes) {
      if (!isHeadingNode(n, depth)) {
        continue;
      }
      out.push({
        path: n.path,
        text: n.text || n.rawLine,
        depth,
        unclear: subtreeHasUnclear(n),
        children: build(n.children, depth + 1),
      });
    }
    return out;
  };
  return build(roots, 0);
}

export class ChaptersTreeProvider implements vscode.TreeDataProvider<ChapterItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ChapterItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: ChapterItem[] = [];
  private parentOf = new Map<string, ChapterItem>();
  /** 当前章节树对应的原文 .forge 路径。 */
  sourcePath: string | undefined;
  /** 当前选中（供「重新生成」读取）。 */
  selectedPath: string | undefined;

  /** 更新章节树内容（sourcePath 为空表示无可用章节）。 */
  setContent(sourcePath: string | undefined, items: ChapterItem[]): void {
    this.sourcePath = sourcePath;
    this.items = items;
    this.parentOf.clear();
    const index = (list: ChapterItem[], parent?: ChapterItem) => {
      for (const it of list) {
        if (parent) {
          this.parentOf.set(it.path, parent);
        }
        index(it.children, it);
      }
    };
    index(items);
    if (
      this.selectedPath &&
      !this.parentOf.has(this.selectedPath) &&
      !items.some((i) => i.path === this.selectedPath)
    ) {
      this.selectedPath = undefined;
    }
    this._onDidChangeTreeData.fire();
  }

  select(path: string | undefined): void {
    this.selectedPath = path;
  }

  getTreeItem(element: ChapterItem): vscode.TreeItem {
    const collapsible =
      element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(
      element.text || "(未命名章节)",
      collapsible,
    );
    item.id = element.path;
    item.description = "#".repeat(element.depth + 1);
    item.tooltip = `章节路径 ${element.path}`;
    if (element.unclear) {
      item.description += "  ＋没听懂";
      item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.red"));
      item.tooltip += "\n（含「没听懂」标注）";
    }
    return item;
  }

  getChildren(element?: ChapterItem): ChapterItem[] {
    return element ? element.children : this.items;
  }

  getParent(element: ChapterItem): ChapterItem | undefined {
    return this.parentOf.get(element.path);
  }
}
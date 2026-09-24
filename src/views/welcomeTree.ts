/**
 * 欢迎视图：静态说明，告诉用户「两条数据流」怎么用。
 * 纯展示、无交互；后续可升级成真正的笔记列表 TreeView。
 */

import * as vscode from "vscode";
import { SYMBOLS } from "../core/symbols";

interface Group {
  label: string;
  collapsible: vscode.TreeItemCollapsibleState;
  children: vscode.TreeItem[];
}

/** 生成一个叶子节点。 */
function leaf(label: string, description?: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  if (description) {
    item.description = description;
  }
  return item;
}

/** 构建三个静态分组。 */
function buildGroups(): Group[] {
  const quickStart = [
    leaf("1️⃣ 新建 xxx.forge，写速记"),
    leaf("2️⃣ 按 Ctrl+Enter"),
    leaf("3️⃣ 生成同名 xxx.md，原文不覆盖"),
  ];

  const symbols = SYMBOLS.map((s) => leaf(`${s.char}  ${s.name}`, s.meaning));

  const config = [
    (() => {
      const item = leaf("🔑 设置 API Key（或 DEEPSEEK_API_KEY）");
      item.command = {
        command: "workbench.action.openSettings",
        title: "打开设置",
        arguments: ["noteForge.apiKey"],
      };
      return item;
    })(),
    leaf("🌐 可换任意 OpenAI 兼容接口"),
  ];

  return [
    {
      label: "🚀 快速开始",
      collapsible: vscode.TreeItemCollapsibleState.Expanded,
      children: quickStart,
    },
    {
      label: "📋 9 符号速查",
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: symbols,
    },
    {
      label: "⚙️ 配置",
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: config,
    },
  ];
}

export class WelcomeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly groups: Group[] = buildGroups();

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      return [
        this.createAction(),
        ...this.groups.map((g) => new vscode.TreeItem(g.label, g.collapsible)),
      ];
    }
    const group = this.groups.find((g) => g.label === element.label);
    return group ? group.children : [];
  }

  /** 顶部「新建速记」入口。 */
  private createAction(): vscode.TreeItem {
    const item = new vscode.TreeItem("新建速记");
    item.iconPath = new vscode.ThemeIcon("add");
    item.description = "创建 .forge，成品 .md 自动同名同目录";
    item.command = { command: "noteForge.create", title: "新建速记" };
    return item;
  }
}

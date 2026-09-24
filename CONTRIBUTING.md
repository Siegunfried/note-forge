# 贡献指南

欢迎 PR。几个约定：

- **分层**：纯逻辑放 `src/core/`（保持无 VSCode 依赖，便于单测）；VSCode 交互放 `src/commands/`、`src/config/`。
- **符号单一来源**：9 个符号的定义只改 `src/core/symbols.ts` 一处；内置 prompt 会自动对齐，但 `syntaxes/notes.tmLanguage.json` 需手动同步。
- **提交前**：`npm run compile` 确认无类型错误。

## 本地开发

```bash
npm install
npm run compile   # 或 npm run watch 增量编译
```

在 VSCode 里按 F5 启动「扩展开发宿主」，即可实时调试。

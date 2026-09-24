# Note Forge — 速记整理助手

> 用符号标记课堂速记，AI 自动补全成完整结构化笔记。VSCode 插件版。

## 这是什么

上课时你只需要用**关键词 + 9 个符号**记下要点，按 `Ctrl+Enter`，插件会：

1. 找到这门课的 `笔记整理prompt.md`（从笔记目录逐级向上查找）
2. 把速记文本交给 DeepSeek（或任意 OpenAI 兼容接口）
3. 返回结构完整、标注清晰的 Markdown 笔记，写到同名的 `.md` 成品（你的 `.forge` 原样保留）

整理出的成品里，AI 补的内容都用 `【补】【详解】【原文】` 等标注区分，绝不和你的原文混充。

## 特性

- 🎨 **符号高亮**：9 个标记符号在行首自动着色（颜色跟随当前主题）
- 🔀 **两条数据流**：速记存 `.forge`，成品生成到同名 `.md`，两者永不互相覆盖
- 📁 **自动定位课程 prompt**：无需配置课程，从笔记路径向上找 `笔记整理prompt.md`
- 🔌 **可换模型**：默认 DeepSeek，也可指向任意 OpenAI 兼容接口

## 两条数据流

`.forge` 是你的**原文速记**（只读），`.md` 是**成品笔记**（只写），按 `Ctrl+Enter` 时：

| 你在哪个文件按 | 原文读哪 | 成品写到哪 |
|---|---|---|
| `xxx.forge` | `xxx.forge` 全文 | 同名 `xxx.md`（新建/覆盖），`.forge` 分毫不动 |
| `xxx.md`（旁边有同名 `.forge`） | 同名 `.forge` 全文 | 覆盖当前 `xxx.md` |
| 普通 `.md`/txt（无 `.forge`） | 选区 / 全文 | 就地整理（兼容） |

这样写和生成走两路，永不串。

## 9 个符号

| 符号 | 含义 | 助手处理 |
|------|------|---------|
| `_` | 没记完 / 没记全 | 按常规结构补全，标【补】 |
| `?` | 有疑问 / 拿不准 | 详细解答【答】+依据；查不到【待确认】 |
| `!` | 重点 | 加粗【重点】，汇总重点清单 |
| `~` | 大概意思 | 转写严格公式【公式化】 |
| `%` | 自己的思考 | 转成注释【思考】 |
| `#` | 需进一步解释 | 补充详解【详解】 |
| `@` | 联网扩展 | 联网检索【外查】+来源 |
| `=` | 原文逐字保留 | 原样不改写【原文】 |
| `&` | 易混淆 / 对比 | 生成对比表【对比】 |

**规则**：标记只在**行首**生效；多行用 `符号{ ... }` 包裹；可叠加（`!?`）；`\X` 转义字面符号。

## 安装（开发）

```bash
npm install
npm run compile
# 然后在 VSCode 里按 F5 启动扩展开发宿主，
# 新建一个 .forge 速记文件，Ctrl+Enter 试试
```

## 配置

在设置（或 `settings.json`）里：

| 项 | 默认 | 说明 |
|----|------|------|
| `noteForge.apiKey` | （空） | API Key；留空时读环境变量 `DEEPSEEK_API_KEY` |
| `noteForge.apiBaseUrl` | `https://api.deepseek.com/chat/completions` | OpenAI 兼容地址 |
| `noteForge.model` | `deepseek-chat` | 模型名 |
| `noteForge.maxTokens` | `8192` | 单次输出 token 上限 |
| `noteForge.temperature` | `0.3` | 采样温度 |

## 项目结构（模块分层）

```
src/
├─ extension.ts           # 入口：注册命令
├─ types.ts               # 共享类型
├─ config/settings.ts     # 配置读取
├─ core/                  # 纯逻辑，无 VSCode 依赖，可单测
│  ├─ symbols.ts          # 9 符号唯一定义（单一事实来源）
│  ├─ promptLoader.ts     # 定位/读取课程 prompt
│  ├─ apiClient.ts        # HTTP 客户端
│  ├─ organizer.ts        # 编排：拼提示词 → 调 API
│  └─ pairing.ts          # 判定源 .forge / 成品 .md 配对
└─ commands/organize.ts   # VSCode 命令粘合层
syntaxes/
└─ notes.tmLanguage.json  # 符号高亮
```

## 已知边界

- `@` 联网目前**未接检索**：模型会基于已有课件/教材补充并标注「未联网」，真正的联网检索在 Roadmap。
- 高亮色由主题决定（用的是通用 TextMate 作用域）；自定义 9 色见 Roadmap。
- 打开「整理后」的 Markdown 时，行首 `#` 标题也会被当作「详解」高亮——这是行首约定的固有权衡。

## Roadmap

- [ ] 课件/教材 RAG 检索（让补全更准）
- [ ] `@` 联网检索
- [ ] 素材面板 / 双栏预览（Webview）
- [ ] 语义级着色（自定义 9 色，摆脱主题依赖）

## License

[MIT](./LICENSE)

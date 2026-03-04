# GitButler 零侵入 i18n 实施任务清单

> 基于 [V3 架构方案](file:///Users/wpy/project/gitbutler/docs/i18n-architecture-scheme.md) 和 [可行性评估](file:///Users/wpy/project/gitbutler/docs/i18n-scheme-evaluation.md)

---

## P0 核心可用（1-2 天）

### P0-1 包骨架搭建

- [ ] 新建 `packages/i18n-preprocessor/` workspace 包
- [ ] 初始化 `package.json`（name: `@gitbutler/i18n-preprocessor`）
- [ ] 创建 `src/index.ts` 入口，导出 `svelteI18nPreprocessor()` 函数
- [ ] 复用 [`svelte-comment-injector`](file:///Users/wpy/project/gitbutler/packages/svelte-comment-injector/src/index.ts) 的 `markup()` 接口模式
- [ ] 创建 `src/vite-plugin.ts` 入口，导出 `viteI18nPlugin()` 函数（P0 阶段仅占位，P3 实装）

### P0-2 字典加载与开关

- [ ] 创建 `locales/zh-CN.json` 初始空字典文件
- [ ] 实现字典加载器：启动时一次性读取 JSON，转为 `Map<string, string>` 缓存在内存
- [ ] 支持 `enabled` 配置项（默认 `true`，可通过环境变量 `VITE_I18N_DISABLED=1` 关闭）
- [ ] 字典文件变更时支持 HMR 热重载（**仅 dev 模式**，build 时禁用文件监听避免引入开销）

### P0-3 静态文本替换

> **识别范围**：仅处理纯文本节点 + 白名单属性值。不碰 `<script>` / `<style>` 块内字符串，不碰 HTML 注释。

- [ ] 在 `markup()` hook 中，解析 Svelte 模板的纯文本节点
- [ ] 提取文本内容，去字典 Map 中查找匹配
- [ ] 命中则替换，未命中则跳过（不报错）
- [ ] 处理多行文本、首尾空白保留
- [ ] 编写单元测试：覆盖基础替换、无匹配跳过、空文本跳过
- [ ] 编写单元测试：前后空白/换行保留一致，避免 UI 布局被破坏

### P0-4 属性替换

- [ ] 扩展 `markup()` 逻辑，识别 HTML 属性中的文本
- [ ] 白名单属性：`title`, `placeholder`, `aria-label`, `alt`
- [ ] 仅替换白名单属性的值，其他属性（`class`, `id`, `href` 等）绝不触碰
- [ ] 编写单元测试：覆盖属性替换 + 非白名单属性不受影响

### P0-5 missing-en.log 记录

- [ ] preprocessor 运行时，将未命中字典的英文文本记录到 `locales/missing-en.log`
- [ ] **仅 dev 模式写入**，build 模式禁用，避免构建产物受环境影响
- [ ] 去重：同一文本只记录一次（用 Set 内存缓冲）
- [ ] **写入时机**：进程退出时（`process.on('exit')`）一次性写入，避免频繁 IO 影响 HMR 性能
- [ ] 记录格式：`[文件路径] 原始文本`，方便定位来源
- [ ] `.gitignore` 中添加 `locales/missing-en.log`

### P0-6 挂载到构建链

- [ ] `apps/desktop/svelte.config.js` 的 `preprocess` 数组中追加 `svelteI18nPreprocessor()`
- [ ] 确认 `vitePreprocess()` → `svelteI18nPreprocessor()` → `svelteInjectComment()` 顺序正确
- [ ] 确认 `pnpm dev:desktop` 正常启动、HMR 正常
- [ ] 确认 `pnpm build:desktop` 构建产物正常（build 模式下 missing-en.log 不产生、HMR 监听不启动）

**P0 验收标准**：preprocessor 骨架完整、字典加载/开关/替换/日志机制全跑通，构建/运行零报错

---

## P1 动态轻量（1 天）

### P1-1 单变量插值替换

- [ ] 字典 key 支持变量名占位符：`"Found {commitCount} commits"` → `"发现 {commitCount} 个提交"`
- [ ] preprocessor 识别文本节点中混杂 Svelte 表达式 `{xxx}` 的场景
- [ ] 将模板文本拆分为 `[静态段, 变量名, 静态段, ...]` 序列
- [ ] 拼接为模式串后去字典匹配，命中则按变量名重新组装翻译文本
- [ ] 无法识别的复杂表达式（三元、链式调用等）直接跳过，不崩溃

### P1-2 测试与边界保护

- [ ] 单元测试：单变量、多变量、变量顺序与原文不同
- [ ] 单元测试：嵌套表达式跳过、`{#if}` 块内文本仍可替换
- [ ] 集成测试：选取 3-5 个典型组件手动验证渲染结果

**P1 验收标准**：常见插值文本可翻译，复杂表达式静默跳过，不影响构建

---

## P2 辅助流程（0.5-1 天）

### P2-1 种子字典生成（从 P0 迁入）

- [ ] 跑一遍 `pnpm dev:desktop`，收集 `missing-en.log`
- [ ] 使用 LLM + Git 官方 `zh_CN.po` 术语表批量翻译
- [ ] 产出初始 `locales/zh-CN.json`
- [ ] 人工校验高频词条（菜单/按钮/对话框标题）
- [ ] 验收：70%+ UI 静态文本已汉化（此处兑现覆盖率指标）

### P2-2 missing-en.log diff 脚本

- [ ] 创建 `scripts/i18n-diff.js`
- [ ] 对比当前 `missing-en.log` 与上次快照，输出新增条目列表
- [ ] 输出可直接喂给 LLM 的格式（JSON 数组或文本清单）
- [ ] 可选：接入 `package.json` scripts（如 `pnpm i18n:diff`）

### P2-3 字典废弃条目检测

- [ ] 扫描 `zh-CN.json` 中所有 key
- [ ] 引入 `locales/matched-en.log`：preprocessor 在 dev 模式下同时记录**命中的** key（与 missing-en.log 同机制，Set 缓冲 + 进程退出写入）
- [ ] 对比 `matched-en.log` 与 `zh-CN.json` 的 key 集合，差集即为 stale 条目
- [ ] 输出 stale 列表，防止字典无限膨胀

### P2-4 字典合并流程约定

- [ ] 文档化：LLM 翻译产出 → 人工校验 → 合并到 `zh-CN.json` 的 SOP
- [ ] 约定 JSON key 排序规则（按字母序），避免合并冲突
- [ ] 预留多语言扩展：目录结构 `locales/{lang}.json`

**P2 验收标准**：拉取上游更新后，一条命令即可发现缺失/过期翻译

---

## P3 TS/JS 白名单替换（可选）（1 天）

### P3-1 Vite Plugin 实装

- [ ] 在 `vite-plugin.ts` 中实现 `transform()` hook
- [ ] 仅拦截 `apps/desktop/src/**/*.ts` 和 `packages/ui/src/**/*.ts`
- [ ] 仅替换白名单场景中的字符串字面量

### P3-2 白名单规则

- [ ] 对象属性值：`label: "Merge"` → `label: "合并"`
- [ ] 特定函数参数：`showError("Failed to ...")` → `showError("...失败")`
- [ ] **排除规则**：`===` 比较、变量名、import 路径、console.log/debug 日志、API 路径

### P3-3 误伤防护

- [ ] 替换前后生成 diff 预览日志
- [ ] dry-run 模式：仅输出将要替换的内容，不实际修改
- [ ] 单元测试：确认 `if (method === "merge")` 不被替换

**P3 验收标准**：不会误替换逻辑字符串、API 参数、比较条件

---

## 文件变更清单总览

| 操作 | 文件 |
|:----:|------|
| NEW | `packages/i18n-preprocessor/package.json` |
| NEW | `packages/i18n-preprocessor/src/index.ts` |
| NEW | `packages/i18n-preprocessor/src/vite-plugin.ts` |
| NEW | `packages/i18n-preprocessor/src/__tests__/` |
| NEW | `locales/zh-CN.json` |
| NEW | `scripts/i18n-diff.js` |
| MODIFY | `apps/desktop/svelte.config.js`（追加 preprocessor） |
| MODIFY | `apps/desktop/vite.config.ts`（追加 Vite plugin，P3 阶段） |
| MODIFY | `pnpm-workspace.yaml`（已包含 `packages/*`，无需改） |
| MODIFY | `.gitignore`（追加 `missing-en.log`） |

# GitButler i18n V3 方案（零侵入 AST 编译期注入）可行性评估

> 评估对象：[i18n-architecture-scheme.md](file:///Users/wpy/project/gitbutler/docs/i18n-architecture-scheme.md) V3 版本
> 评估背景：不向上游贡献 i18n，仅做民间汉化分发，需永久跟踪上游更新

## 📊 总体结论

> [!IMPORTANT]
> **方向完全正确。** 在"不贡献上游、仅自用/民间分发"的前提下，零侵入编译期注入是**唯一合理的架构选择**。
> 方案存在 **4 个需要注意的落地风险点和 2 个可优化项**，但均有成熟解法。

---

## ✅ 方案合理性确认

### 为什么不做 Paraglide（V2）是对的

| 维度 | 结论 |
|------|------|
| **上游合并** | GitButler 是活跃项目（每天有大量 commit），改写 600+ 组件后将永远无法 `git pull` |
| **投入产出** | Git 工具用户本身英文能力强，完整 i18n 的收益远低于成本 |
| **项目立场** | 官方未表达 i18n 意愿，强行提 PR 可能被拒 |
| **维护债务** | Paraglide 方案需要维护 `m.xxx()` 调用和 JSON 字典同步，一个人难以持续 |

### V3 方案的核心技术验证

| 技术点 | 可行性 | 依据 |
|--------|:------:|------|
| **Svelte Preprocessor 链** | ✅ | 项目已有 [`svelte-comment-injector`](file:///Users/wpy/project/gitbutler/packages/svelte-comment-injector/src/index.ts) 先例，`markup()` hook 模式完全一致 |
| **Preprocessor 数组注入** | ✅ | `svelte.config.js` 已使用数组 `preprocess: [vitePreprocess(), svelteInjectComment()]`，加第三个零成本 |
| **Vite Plugin 拦截 TS** | ✅ | Vite `transform` hook 是标准 API，项目已有自定义 `debounceReload` 插件先例 |
| **源码零修改** | ✅ | 仅新增脚本文件 + 修改 `svelte.config.js` 和 `vite.config.ts`，git diff 仅几行 |
| **上游同步** | ✅ | 冲突面仅限 config 文件，可通过 `git stash` / 分支策略轻松管理 |

---

## ⚠️ 需注意的 4 个落地风险

### 1. 动态插值替换是最大挑战

方案提到了 `{commitCount}` 这类动态场景，但低估了实际复杂度：

```svelte
<!-- 简单场景：方案可覆盖 -->
<p>Found {commitCount} commits</p>

<!-- 实际场景：嵌套表达式 + 条件渲染 -->
<p>{isAhead ? `${ahead} ahead` : ''}{isBehind ? `, ${behind} behind` : ''}</p>

<!-- 复杂场景：跨行模板 + snippet -->
{#if commits.length > 0}
  Showing {commits.length} of {total} commits
{/if}
```

**建议**：
- 第一阶段只做**纯静态文本替换**（已能覆盖 70%+ 的 UI 文本）
- 动态插值留到第二阶段，且采用 AST 解析而非正则（用 Svelte 自身的 `parse()` API）
- 对于过于复杂的模板表达式，接受"不翻译"而非写出脆弱的正则

### 2. JS/TS 中的字符串文本比模板更棘手

```typescript
// 明确的 UI 文本 — 可安全替换
const labels = {
  [MergeMethod.Merge]: "Merge",
  [MergeMethod.Rebase]: "Rebase and merge",
};

// 不可替换的 — key/enum/API 参数
if (method === "merge") { ... }
fetch("/api/merge")
console.log("merge completed")
```

**建议**：
- Vite plugin 中需要**白名单机制**：仅替换特定函数调用参数中的字符串（如 `showError("...")`, `label=`, `title=`）
- **绝不能**盲目全局替换 `.ts` 文件中所有匹配的英文字符串
- 或者更保守：TS 层面不做自动替换，用 `missing-en.log` 人工审核后手动指定

### 3. HMR 性能影响

每次文件变更都触发 preprocessor 全量扫描 + 字典查找。GitButler 有 600+ 组件。

**建议**：
- 字典在启动时一次性加载到内存，用 `Map` 而非每次 `JSON.parse`
- preprocessor 中做路径缓存：未变更的文件跳过处理
- 开发时可加 `enable` 开关，不需要汉化调试时直接关闭

### 4. 上游更新改变文本后的字典失效

上游 `"Push to Remote"` 改为 `"Push to Origin"` 后，字典中的旧 key 将静默失效（不报错，只是不翻译了）。

**建议**：
- `missing-en.log` 机制（方案已提到）是关键——每次拉取上游后运行一遍 dev，检查新增的未翻译项
- 可以写一个简单的 CI 脚本：对比两次 `missing-en.log` 的 diff，自动生成"需要更新的翻译"列表

---

## 💡 2 个优化建议

### 1. 直接复用 `packages/svelte-comment-injector` 的模式

项目已有一个完全同构的 preprocessor 包。建议：
- 新建 `packages/i18n-preprocessor/` 作为 workspace 包
- 复用 [`svelteInjectComment`](file:///Users/wpy/project/gitbutler/packages/svelte-comment-injector/src/index.ts) 的 `markup()` 接口模式
- 这样可以享受 monorepo 的 TS 类型检查和自动构建

### 2. 术语表采用 Git 官方 `zh_CN.po`

已确认直接采用 [Git 官方中文术语表](https://github.com/git/git/blob/master/po/zh_CN.po)。落地时从 `.po` 文件提取术语映射，作为字典的种子数据和 LLM 翻译的硬约束。

---

## 📋 推荐的落地优先级

| 阶段 | 内容 | 预期覆盖率 | 工作量 |
|:----:|------|:----------:|:------:|
| **P0** | Svelte 模板纯静态文本替换 | ~70% | 1-2 天 |
| **P1** | HTML 属性替换（title, placeholder, aria-label） | +10% | 半天 |
| **P2** | 简单动态插值（单变量模式） | +10% | 1 天 |
| **P3** | TS 文件白名单替换 | +5% | 1 天 |
| **P4** | 复杂模板表达式 | +3-5% | 按需 |

> [!TIP]
> P0 阶段就能让 70% 的界面变成中文，足够日常使用。建议先把 P0 做到极致稳定，再考虑后续阶段。

---

## 🎯 最终评价

**V3 方案是在你的约束条件下（不贡献上游、独立维护、跟踪上游更新）的最优解。**

核心优势在于把"翻译"从代码问题降维成了配置问题——一个 JSON 字典 + 两个编译插件，源码完全不动。这比在 600+ 组件里写 `m.xxx()` 然后永远无法合并上游要务实得多。

关键是**控制好替换的边界**：宁可少翻几个动态文本，也不要写出脆弱的正则导致构建崩溃。

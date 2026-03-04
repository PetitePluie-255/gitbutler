# i18n 字典合并 SOP（P2-4）

## 目标

建立可重复的翻译流程：从缺失日志 → 批量翻译 → 人工校验 → 合并到字典。

---

## 一、生成翻译输入

1. 启动并退出开发：
   - `pnpm dev:desktop`
   - 退出后生成 `locales/missing-en.log`
2. 生成 diff（可选但推荐）：
   - `pnpm i18n:diff`
   - 输出 `locales/missing-en.diff.json`

**推荐翻译输入**：`locales/missing-en.diff.json`  
**首次翻译**：可直接使用 `locales/missing-en.log`

---

## 二、术语约束

使用 Git 官方术语表 `zh_CN.po` 作为硬约束。  
本地文件路径：`locales/zh_CN.po`

如需快速种子：
```
node scripts/i18n-seed.js
```

---

## 三、LLM 提示词模板

```
你将收到一个 JSON 数组，里面是英文 UI 文本。请输出一个 JSON 对象，格式为：
{
  "英文原文": "中文翻译",
  ...
}

规则：
1. 仅输出 JSON 对象，不要任何解释或代码块。
2. 保持原文中的占位符不变（如 {count}, {branchName}），且保留在中文里。
3. 不要改动标点、大小写、空白或引号结构（仅翻译英文部分）。
4. 遇到专有名词或 Git 术语，优先使用 Git 官方中文术语。
5. 输出按 key 的字母序排序。
```

---

## 四、人工校验清单

- 菜单/按钮/对话框标题优先检查
- Git 相关术语与官方中文保持一致
- 占位符 `{}` 不被破坏
- 不翻译纯符号、快捷键、代码片段

---

## 五、合并流程

1. 将 LLM 输出保存为临时文件（如 `locales/zh-CN.patch.json`）
2. 与现有 `locales/zh-CN.json` 合并
3. 对 key 排序（字母序）
4. 重新启动 `pnpm dev:desktop` 验证

---

## 六、维护

- 定期运行 `pnpm i18n:diff` 获取新增条目
- 定期运行 `pnpm i18n:stale` 清理长期未命中的条目

import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, afterEach } from "vitest";
import svelteI18nPreprocessor from "../index";

const tempDirs: string[] = [];

function createTempDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-preprocessor-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

function createPreprocessor(dict: Record<string, string>) {
	const dir = createTempDir();
	const dictionaryPath = path.join(dir, "zh-CN.json");
	fs.writeFileSync(dictionaryPath, JSON.stringify(dict));

	return svelteI18nPreprocessor({
		dictionaryPath,
		missingLogPath: path.join(dir, "missing.log"),
		matchedLogPath: path.join(dir, "matched.log"),
		dev: false,
		watch: false,
	});
}

describe("svelteI18nPreprocessor", () => {
	it("replaces static text nodes from the dictionary", () => {
		const preprocessor = createPreprocessor({ "Push to Remote": "推送到远端" });
		const result = preprocessor.markup({
			content: "<p>Push to Remote</p>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("<p>推送到远端</p>");
	});

	it("preserves leading and trailing whitespace", () => {
		const preprocessor = createPreprocessor({ "Push to Remote": "推送到远端" });
		const result = preprocessor.markup({
			content: "<p>  Push to Remote  </p>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("<p>  推送到远端  </p>");
	});

	it("replaces whitelisted attribute values", () => {
		const preprocessor = createPreprocessor({ "Push to Remote": "推送到远端" });
		const result = preprocessor.markup({
			content: '<input placeholder="Push to Remote" />',
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe('<input placeholder="推送到远端" />');
	});

	it("does not touch non-whitelisted attributes", () => {
		const preprocessor = createPreprocessor({ "Push to Remote": "推送到远端" });
		const result = preprocessor.markup({
			content: '<div class="Push to Remote"></div>',
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe('<div class="Push to Remote"></div>');
	});

	it("leaves unmatched text untouched", () => {
		const preprocessor = createPreprocessor({ "Push to Remote": "推送到远端" });
		const result = preprocessor.markup({
			content: "<p>No Match</p>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("<p>No Match</p>");
	});

	it("ignores pure whitespace text nodes", () => {
		const preprocessor = createPreprocessor({ "Push to Remote": "推送到远端" });
		const result = preprocessor.markup({
			content: "<p>   </p>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("<p>   </p>");
	});

	it("replaces simple interpolated text with identifier placeholders", () => {
		const preprocessor = createPreprocessor({
			"Found {commitCount} commits": "发现 {commitCount} 个提交",
		});
		const result = preprocessor.markup({
			content: "<p>Found {commitCount} commits</p>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("<p>发现 {commitCount} 个提交</p>");
	});

	it("allows variable reordering in translations", () => {
		const preprocessor = createPreprocessor({
			"Found {count} commits for {branch}": "分支 {branch} 有 {count} 个提交",
		});
		const result = preprocessor.markup({
			content: "<p>Found {count} commits for {branch}</p>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("<p>分支 {branch} 有 {count} 个提交</p>");
	});

	it("skips complex expressions inside interpolations", () => {
		const preprocessor = createPreprocessor({
			"Found {count} commits": "发现 {count} 个提交",
		});
		const result = preprocessor.markup({
			content: "<p>Found {count + 1} commits</p>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("<p>Found {count + 1} commits</p>");
	});

	it("replaces text inside if blocks", () => {
		const preprocessor = createPreprocessor({ "No changes": "没有变更" });
		const result = preprocessor.markup({
			content: "{#if hasChanges}<p>No changes</p>{/if}",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("{#if hasChanges}<p>没有变更</p>{/if}");
	});

	it("replaces string literals inside const expressions with whitelisted keys", () => {
		const preprocessor = createPreprocessor({ "Leftmost lane": "最左泳道" });
		const result = preprocessor.markup({
			content: "{@const opts = [{ label: 'Leftmost lane', value: 'x' }]}",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("{@const opts = [{ label: '最左泳道', value: 'x' }]}");
	});

	it("normalizes multiline text nodes for lookup", () => {
		const preprocessor = createPreprocessor({ "Enable Husky hooks": "启用 Husky 钩子" });
		const result = preprocessor.markup({
			content: "<p>\n  Enable Husky hooks\n</p>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe("<p>\n  启用 Husky 钩子\n</p>");
	});

	it("replaces string literals inside tooltip expressions", () => {
		const preprocessor = createPreprocessor({
			"Read-only mode": "只读模式",
			"Create new branch": "创建新分支",
		});
		const result = preprocessor.markup({
			content:
				'<Button tooltip={isReadOnly ? "Read-only mode" : "Create new branch"} />',
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe(
			'<Button tooltip={isReadOnly ? "只读模式" : "创建新分支"} />',
		);
	});

	it("replaces string literals inside mustache ternary expressions", () => {
		const preprocessor = createPreprocessor({
			Push: "推送",
			"Force push": "强制推送",
		});
		const result = preprocessor.markup({
			content: "<Button>{isGerritMode ? \"Push\" : withForce ? \"Force push\" : \"Push\"}</Button>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe(
			"<Button>{isGerritMode ? \"推送\" : withForce ? \"强制推送\" : \"推送\"}</Button>",
		);
	});

	it("replaces string literals inside script object values with whitelisted keys", () => {
		const preprocessor = createPreprocessor({
			All: "全部",
			PRs: "拉取请求",
			Local: "本地",
		});
		const result = preprocessor.markup({
			content: "<script>const filterOptions = { all: \"All\", pullRequest: \"PRs\", local: \"Local\" };</script>",
			filename: "/tmp/Component.svelte",
		});
		expect(result.code).toBe(
			"<script>const filterOptions = { all: \"全部\", pullRequest: \"拉取请求\", local: \"本地\" };</script>",
		);
	});
});

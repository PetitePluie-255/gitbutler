import fs from "fs";
import path from "path";
import { createRequire } from "module";
import MagicString from "magic-string";

let cachedRepoRoot: string | null = null;

function findRepoRoot(startDir: string): string {
	if (cachedRepoRoot) return cachedRepoRoot;
	let current = startDir;
	while (true) {
		if (
			fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
			fs.existsSync(path.join(current, ".git"))
		) {
			cachedRepoRoot = current;
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	cachedRepoRoot = startDir;
	return startDir;
}

function isDisabledByEnv(): boolean {
	const raw = process.env.VITE_I18N_DISABLED;
	if (!raw) return false;
	return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function loadDictionary(dictionaryPath: string): Map<string, string> {
	try {
		const json = fs.readFileSync(dictionaryPath, "utf-8");
		const data = JSON.parse(json) as Record<string, string>;
		return new Map(Object.entries(data));
	} catch {
		return new Map();
	}
}

function escapeForQuote(value: string, quote: string) {
	const escaped = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
	if (quote === "'") return escaped.replace(/'/g, "\\'");
	if (quote === '"') return escaped.replace(/"/g, '\\"');
	return escaped;
}

function replacementForLiteral(original: string, translated: string) {
	const quote = original[0] === "'" ? "'" : original[0] === '"' ? '"' : '"';
	return `${quote}${escapeForQuote(translated, quote)}${quote}`;
}

export type ViteI18nPluginOptions = {
	enabled?: boolean;
	dictionaryPath?: string;
	attributeKeys?: string[];
	functionNames?: string[];
};

export default function viteI18nPlugin(options: ViteI18nPluginOptions = {}) {
	const enabled = options.enabled ?? !isDisabledByEnv();
	if (!enabled) {
		return {
			name: "gitbutler-i18n-ts-disabled",
		};
	}

	const repoRoot = findRepoRoot(process.cwd());
	const dictionaryPath =
		options.dictionaryPath ?? path.resolve(repoRoot, "locales/zh-CN.json");
	const attributeKeys = new Set(options.attributeKeys ?? ["label", "title", "placeholder"]);
	const functionNames = new Set(options.functionNames ?? ["showError"]);

	let dictionary = loadDictionary(dictionaryPath);
	let typescript: typeof import("typescript") | null = null;
	let warned = false;
	const require = createRequire(import.meta.url);

	function ensureTypescript() {
		if (typescript) return typescript;
		try {
			typescript = require("typescript");
			return typescript;
		} catch {
			if (!warned) {
				warned = true;
				console.warn(
					"[i18n-preprocessor] Typescript not available; TS/JS translation disabled.",
				);
			}
			return null;
		}
	}

	function isTargetFile(id: string) {
		if (id.includes("node_modules")) return false;
		if (!id.endsWith(".ts") && !id.endsWith(".tsx")) return false;
		const normalized = id.split(path.sep).join("/");
		return (
			normalized.includes("apps/desktop/src/") ||
			normalized.includes("packages/ui/src/")
		);
	}

	return {
		name: "gitbutler-i18n-ts",
		enforce: "pre",
		configureServer(
			server: {
				watcher: { add: (file: string) => void; on: (event: "change", cb: (file: string) => void) => void };
			},
		) {
			server.watcher.add(dictionaryPath);
			server.watcher.on("change", (changed: string) => {
				if (path.resolve(changed) === dictionaryPath) {
					dictionary = loadDictionary(dictionaryPath);
				}
			});
		},
		transform(code: string, id: string) {
			if (!isTargetFile(id)) return null;
			const ts = ensureTypescript();
			if (!ts) return null;

			const sourceFile = ts.createSourceFile(
				id,
				code,
				ts.ScriptTarget.ESNext,
				true,
				id.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
			);

			const edits: Array<{ start: number; end: number; replacement: string }> = [];

			const visit = (node: import("typescript").Node) => {
				if (ts.isPropertyAssignment(node)) {
					let key: string | null = null;
					if (ts.isIdentifier(node.name)) key = node.name.text;
					if (ts.isStringLiteral(node.name)) key = node.name.text;
					if (key && attributeKeys.has(key)) {
						const initializer = node.initializer;
						if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
							const original = initializer.text;
							const translated = dictionary.get(original);
							if (translated && translated !== original) {
								const start = initializer.getStart(sourceFile);
								const end = initializer.getEnd();
								const originalText = code.slice(start, end);
								edits.push({
									start,
									end,
									replacement: replacementForLiteral(originalText, translated),
								});
							}
						}
					}
				}

				if (ts.isCallExpression(node)) {
					if (ts.isIdentifier(node.expression) && functionNames.has(node.expression.text)) {
						const first = node.arguments[0];
						if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
							const original = first.text;
							const translated = dictionary.get(original);
							if (translated && translated !== original) {
								const start = first.getStart(sourceFile);
								const end = first.getEnd();
								const originalText = code.slice(start, end);
								edits.push({
									start,
									end,
									replacement: replacementForLiteral(originalText, translated),
								});
							}
						}
					}
				}

				ts.forEachChild(node, visit);
			};

			visit(sourceFile);

			if (edits.length === 0) return null;
			const magic = new MagicString(code);
			for (const edit of edits) {
				magic.overwrite(edit.start, edit.end, edit.replacement);
			}
			return {
				code: magic.toString(),
				map: magic.generateMap({ hires: true }),
			};
		},
	};
}

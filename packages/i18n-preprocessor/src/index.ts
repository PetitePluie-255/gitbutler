import fs from "fs";
import path from "path";
import MagicString from "magic-string";
import { parse } from "svelte/compiler";

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

const repoRoot = findRepoRoot(process.cwd());
const DEFAULT_DICT_PATH = path.resolve(repoRoot, "locales/zh-CN.json");
const DEFAULT_MISSING_LOG = path.resolve(repoRoot, "locales/missing-en.log");
const DEFAULT_MATCHED_LOG = path.resolve(repoRoot, "locales/matched-en.log");
const DEFAULT_DEBUG_LOG = path.resolve(repoRoot, "locales/i18n-preprocessor.debug.log");
const DEFAULT_DRY_RUN_LOG = path.resolve(repoRoot, "locales/i18n-dry-run.log");

type I18nPreprocessorOptions = {
	enabled?: boolean;
	dev?: boolean;
	dictionaryPath?: string;
	missingLogPath?: string;
	matchedLogPath?: string;
	watch?: boolean;
	debug?: boolean;
	dryRun?: boolean;
};

type DictionaryState = {
	map: Map<string, string>;
};

const dictionaryCache = new Map<string, DictionaryState>();
const watchers = new Map<string, fs.FSWatcher>();
const missingLogs = new Map<string, Set<string>>();
const matchedLogs = new Map<string, Set<string>>();
const dryRunLogs = new Map<string, Set<string>>();
let exitHookRegistered = false;
let debugLogged = false;
let moduleDebugLogged = false;

function isDebugEnabled(explicit?: boolean): boolean {
	if (explicit !== undefined) return explicit;
	const raw = process.env.VITE_I18N_DEBUG_LOG;
	if (!raw) return false;
	return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function isDryRunEnabled(explicit?: boolean): boolean {
	if (explicit !== undefined) return explicit;
	const raw = process.env.VITE_I18N_DRY_RUN;
	if (!raw) return false;
	return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function writeDebugOnce(message: string) {
	if (moduleDebugLogged) return;
	moduleDebugLogged = true;
	try {
		fs.mkdirSync(path.dirname(DEFAULT_DEBUG_LOG), { recursive: true });
		fs.writeFileSync(DEFAULT_DEBUG_LOG, `${message}\n`);
	} catch {
		// ignore debug log failures
	}
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

function ensureDictionary(dictionaryPath: string, watch: boolean, dev: boolean): DictionaryState {
	let state = dictionaryCache.get(dictionaryPath);
	if (!state) {
		state = { map: loadDictionary(dictionaryPath) };
		dictionaryCache.set(dictionaryPath, state);
	}

	if (dev && watch && !watchers.has(dictionaryPath) && fs.existsSync(dictionaryPath)) {
		let timer: NodeJS.Timeout | null = null;
		const watcher = fs.watch(dictionaryPath, () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				state!.map = loadDictionary(dictionaryPath);
			}, 50);
		});
		watchers.set(dictionaryPath, watcher);
	}

	return state;
}

function registerExitHook() {
	if (exitHookRegistered) return;
	exitHookRegistered = true;

	const flush = () => {
		writeLogs(missingLogs);
		writeLogs(matchedLogs);
		writeLogs(dryRunLogs);
	};

	process.on("exit", flush);
	process.on("beforeExit", flush);
	process.on("SIGINT", flush);
	process.on("SIGTERM", flush);
}

function writeLogs(logs: Map<string, Set<string>>) {
	for (const [logPath, entries] of logs) {
		const payload = Array.from(entries).sort().join("\n");
		fs.mkdirSync(path.dirname(logPath), { recursive: true });
		fs.writeFileSync(logPath, payload.length > 0 ? `${payload}\n` : "");
	}
}

function addLogEntry(logs: Map<string, Set<string>>, logPath: string, entry: string) {
	let set = logs.get(logPath);
	if (!set) {
		set = new Set();
		logs.set(logPath, set);
	}
	set.add(entry);
}

function splitText(raw: string) {
	const leadingMatch = raw.match(/^\s*/);
	const trailingMatch = raw.match(/\s*$/);
	const leading = leadingMatch ? leadingMatch[0] : "";
	const trailing = trailingMatch ? trailingMatch[0] : "";
	const core = raw.slice(leading.length, raw.length - trailing.length);
	return { leading, core, trailing };
}

function normalizeCore(core: string): string {
	return core.replace(/\s+/g, " ").trim();
}

function shouldSkipTranslation(core: string): boolean {
	if (!core) return true;
	// Skip obvious URLs
	if (core.includes("://")) return true;
	// Skip absolute or relative paths without spaces
	if (/^\/\S+$/.test(core)) return true;
	if (/^\.\.?\/\S+$/.test(core)) return true;
	// Skip path-like tokens without spaces
	if ((core.includes("/") || core.includes("\\")) && !core.includes(" ")) return true;
	return false;
}

function isIdentifierExpression(node: any): node is { type: "Identifier"; name: string } {
	return node && node.type === "Identifier" && typeof node.name === "string";
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

function walkExpression(node: any, visit: (node: any, parent: any) => void, parent?: any) {
	if (!node || typeof node !== "object") return;
	visit(node, parent);
	for (const key of Object.keys(node)) {
		const value = (node as Record<string, unknown>)[key];
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item && typeof item === "object" && "type" in item) {
					walkExpression(item, visit, node);
				}
			}
		} else if (value && typeof value === "object" && "type" in value) {
			walkExpression(value, visit, node);
		}
	}
}

function walkHtml(node: any, visit: (node: any) => void) {
	if (!node) return;
	if (Array.isArray(node)) {
		for (const child of node) walkHtml(child, visit);
		return;
	}

	visit(node);

	switch (node.type) {
		case "Fragment":
		case "Element":
		case "InlineComponent":
		case "Component":
		case "Slot":
		case "SlotElement":
			if (node.attributes) walkHtml(node.attributes, visit);
			if (node.children) walkHtml(node.children, visit);
			return;
		case "IfBlock":
		case "EachBlock":
		case "KeyBlock":
			if (node.children) walkHtml(node.children, visit);
			if (node.else) walkHtml(node.else, visit);
			return;
		case "AwaitBlock":
			if (node.pending) walkHtml(node.pending, visit);
			if (node.then) walkHtml(node.then, visit);
			if (node.catch) walkHtml(node.catch, visit);
			return;
		case "ThenBlock":
		case "CatchBlock":
		case "PendingBlock":
			if (node.children) walkHtml(node.children, visit);
			return;
		case "Attribute":
			return;
		default:
			if (node.children) walkHtml(node.children, visit);
	}
}

const ATTRIBUTE_WHITELIST = new Set(["label", "title", "placeholder", "aria-label", "alt"]);
const MUSTACHE_TYPES = new Set(["MustacheTag", "ExpressionTag"]);
const EXPRESSION_PROPERTY_WHITELIST = new Set(["label", "title", "placeholder", "message"]);
const ATTRIBUTE_EXPRESSION_WHITELIST = new Set([
	"tooltip",
	"label",
	"title",
	"placeholder",
	"aria-label",
]);
const SCRIPT_VALUE_KEY_WHITELIST = new Set([
	"label",
	"title",
	"placeholder",
	"message",
	"tooltip",
	"caption",
	"text",
	"all",
	"local",
	"pullRequest",
]);

function shouldTranslateLiteral(node: any, parent: any) {
	if (!parent) return true;
	if (parent.type === "ConditionalExpression") {
		return parent.consequent === node || parent.alternate === node;
	}
	if (parent.type === "LogicalExpression") {
		return parent.right === node;
	}
	return false;
}

export default function svelteI18nPreprocessor(options: I18nPreprocessorOptions = {}) {
	const dev = options.dev ?? process.env.NODE_ENV !== "production";
	const enabled = options.enabled ?? !isDisabledByEnv();
	const dictionaryPath = options.dictionaryPath ?? DEFAULT_DICT_PATH;
	const missingLogPath = options.missingLogPath ?? DEFAULT_MISSING_LOG;
	const matchedLogPath = options.matchedLogPath ?? DEFAULT_MATCHED_LOG;
	const watch = options.watch ?? dev;
	const debug = isDebugEnabled(options.debug);
	const dryRun = isDryRunEnabled((options as { dryRun?: boolean }).dryRun);

	if (debug) {
		writeDebugOnce(`module loaded ${new Date().toISOString()}`);
	}

	if (!enabled) {
		return {
			markup({ content }: { content: string }): { code: string } {
				return { code: content };
			},
		};
	}

	if (dev) {
		registerExitHook();
		// Ensure log files are created on exit even if no entries were recorded.
		if (!missingLogs.has(missingLogPath)) missingLogs.set(missingLogPath, new Set());
		if (!matchedLogs.has(matchedLogPath)) matchedLogs.set(matchedLogPath, new Set());
		if (!dryRunLogs.has(DEFAULT_DRY_RUN_LOG)) dryRunLogs.set(DEFAULT_DRY_RUN_LOG, new Set());
	}

	const dictionaryState = ensureDictionary(dictionaryPath, watch, dev);

	return {
		markup({
			content,
			filename,
		}: {
			content: string;
			filename?: string;
		}): { code: string } {
			if (!enabled) return { code: content };

			const ast = parse(content, { filename });
			const replacements: Array<{ start: number; end: number; replacement: string }> = [];
			const skipTextNodes = new WeakSet<object>();

			const logEnabled = dev;
			const fileLabel = filename ? path.relative(process.cwd(), filename) : "unknown";

			if (debug && !debugLogged) {
				debugLogged = true;
				fs.mkdirSync(path.dirname(DEFAULT_DEBUG_LOG), { recursive: true });
				fs.writeFileSync(
					DEFAULT_DEBUG_LOG,
					`invoked ${new Date().toISOString()} file=${fileLabel}\n`,
				);
			}

			const consider = (raw: string, start: number | null, end: number | null) => {
				if (start === null || end === null) return;
				const { leading, core, trailing } = splitText(raw);
				if (!core) return;
				const normalized = normalizeCore(core);
				if (shouldSkipTranslation(normalized)) return;
				const translated =
					dictionaryState.map.get(core) ??
					(normalized ? dictionaryState.map.get(normalized) : undefined);
				const entryText = translated ? (dictionaryState.map.has(core) ? core : normalized) : normalized || core;
				const entry = `[${fileLabel}] ${entryText}`;

				if (translated) {
					if (!dryRun) {
						replacements.push({
							start,
							end,
							replacement: `${leading}${translated}${trailing}`,
						});
					} else if (logEnabled) {
						addLogEntry(
							dryRunLogs,
							DEFAULT_DRY_RUN_LOG,
							`[${fileLabel}] ${core} -> ${translated}`,
						);
					}
					if (logEnabled) addLogEntry(matchedLogs, matchedLogPath, entry);
				} else if (logEnabled) {
					addLogEntry(missingLogs, missingLogPath, entry);
				}
			};

			const considerInterpolated = (
				raw: string,
				start: number | null,
				end: number | null,
				availableVariables: Set<string>,
			) => {
				if (start === null || end === null) return;
				const { leading, core, trailing } = splitText(raw);
				if (!core) return;
				const normalized = normalizeCore(core);
				if (shouldSkipTranslation(normalized)) return;
				const translated =
					dictionaryState.map.get(core) ??
					(normalized ? dictionaryState.map.get(normalized) : undefined);
				const entryText = translated ? (dictionaryState.map.has(core) ? core : normalized) : normalized || core;
				const entry = `[${fileLabel}] ${entryText}`;

				if (translated) {
					const placeholders = Array.from(translated.matchAll(/\{([^}]+)\}/g)).map(
						(match) => match[1],
					);
					const allKnown = placeholders.every((name) => availableVariables.has(name));
					if (!allKnown) {
						if (logEnabled) addLogEntry(missingLogs, missingLogPath, entry);
						return;
					}
					if (!dryRun) {
						replacements.push({
							start,
							end,
							replacement: `${leading}${translated}${trailing}`,
						});
					} else if (logEnabled) {
						addLogEntry(
							dryRunLogs,
							DEFAULT_DRY_RUN_LOG,
							`[${fileLabel}] ${core} -> ${translated}`,
						);
					}
					if (logEnabled) addLogEntry(matchedLogs, matchedLogPath, entry);
				} else if (logEnabled) {
					addLogEntry(missingLogs, missingLogPath, entry);
				}
			};

			const processExpression = (expression: any, source: string) => {
				walkExpression(expression, (node) => {
					if (node.type !== "Property") return;
					if (node.computed) return;
					let keyName: string | null = null;
					if (node.key?.type === "Identifier") keyName = node.key.name;
					if (node.key?.type === "Literal" && typeof node.key.value === "string") {
						keyName = node.key.value;
					}
					if (!keyName || !EXPRESSION_PROPERTY_WHITELIST.has(keyName)) return;
					const value = node.value;
					if (!value || value.type !== "Literal" || typeof value.value !== "string") return;
					const originalValue = value.value;
					const start = value.start ?? null;
					const end = value.end ?? null;
					const originalText = source.slice(start ?? 0, end ?? 0);
					if (!originalText) return;
					const translated = dictionaryState.map.get(originalValue);
					const entry = `[${fileLabel}] ${originalValue}`;
					if (translated) {
						replacements.push({
							start: start!,
							end: end!,
							replacement: replacementForLiteral(originalText, translated),
						});
						if (logEnabled) addLogEntry(matchedLogs, matchedLogPath, entry);
					} else if (logEnabled) {
						addLogEntry(missingLogs, missingLogPath, entry);
					}
				});
			};

			const processExpressionStringLiterals = (expression: any, source: string) => {
				walkExpression(expression, (node, parent) => {
					if (node.type !== "Literal" || typeof node.value !== "string") return;
					if (parent?.type === "Property" && parent.key === node) return;
					if (!shouldTranslateLiteral(node, parent)) return;
					const originalValue = node.value;
					const start = node.start ?? null;
					const end = node.end ?? null;
					if (start === null || end === null) return;
					const originalText = source.slice(start, end);
					if (!originalText) return;
					const normalized = normalizeCore(originalValue);
					if (shouldSkipTranslation(normalized)) return;
					const translated =
						dictionaryState.map.get(originalValue) ??
						(normalized ? dictionaryState.map.get(normalized) : undefined);
					const entryText = translated
						? dictionaryState.map.has(originalValue)
							? originalValue
							: normalized
						: normalized || originalValue;
					const entry = `[${fileLabel}] ${entryText}`;
					if (translated) {
						if (!dryRun) {
							replacements.push({
								start,
								end,
								replacement: replacementForLiteral(originalText, translated),
							});
						} else if (logEnabled) {
							addLogEntry(
								dryRunLogs,
								DEFAULT_DRY_RUN_LOG,
								`[${fileLabel}] ${originalValue} -> ${translated}`,
							);
						}
						if (logEnabled) addLogEntry(matchedLogs, matchedLogPath, entry);
					} else if (logEnabled) {
						addLogEntry(missingLogs, missingLogPath, entry);
					}
				});
			};

			const processScriptContent = (program: any, source: string) => {
				if (!program) return;
				walkExpression(program, (node) => {
					if (node.type !== "Property") return;
					if (node.computed) return;
					let keyName: string | null = null;
					if (node.key?.type === "Identifier") keyName = node.key.name;
					if (node.key?.type === "Literal" && typeof node.key.value === "string") {
						keyName = node.key.value;
					}
					if (!keyName || !SCRIPT_VALUE_KEY_WHITELIST.has(keyName)) return;
					const value = node.value;
					if (!value || value.type !== "Literal" || typeof value.value !== "string") return;
					const originalValue = value.value;
					const start = value.start ?? null;
					const end = value.end ?? null;
					if (start === null || end === null) return;
					const originalText = source.slice(start, end);
					if (!originalText) return;
					const normalized = normalizeCore(originalValue);
					if (shouldSkipTranslation(normalized)) return;
					const translated =
						dictionaryState.map.get(originalValue) ??
						(normalized ? dictionaryState.map.get(normalized) : undefined);
					const entryText = translated
						? dictionaryState.map.has(originalValue)
							? originalValue
							: normalized
						: normalized || originalValue;
					const entry = `[${fileLabel}] ${entryText}`;
					if (translated) {
						if (!dryRun) {
							replacements.push({
								start,
								end,
								replacement: replacementForLiteral(originalText, translated),
							});
						} else if (logEnabled) {
							addLogEntry(
								dryRunLogs,
								DEFAULT_DRY_RUN_LOG,
								`[${fileLabel}] ${originalValue} -> ${translated}`,
							);
						}
						if (logEnabled) addLogEntry(matchedLogs, matchedLogPath, entry);
					} else if (logEnabled) {
						addLogEntry(missingLogs, missingLogPath, entry);
					}
				});
			};

			const processChildSequences = (children: any[]) => {
				let index = 0;
				while (index < children.length) {
					const node = children[index];
					if (!node || (!MUSTACHE_TYPES.has(node.type) && node.type !== "Text")) {
						index += 1;
						continue;
					}

					let endIndex = index;
					let hasMustache = false;
					let hasText = false;
					const variables = new Set<string>();
					const textNodes: any[] = [];
					let raw = "";
					let sequenceValid = true;

					while (endIndex < children.length) {
						const current = children[endIndex];
						if (!current || (!MUSTACHE_TYPES.has(current.type) && current.type !== "Text")) {
							break;
						}
						if (current.type === "Text") {
							hasText = true;
							raw += current.data ?? "";
							textNodes.push(current);
						} else if (MUSTACHE_TYPES.has(current.type)) {
							const expression = current.expression;
							if (!isIdentifierExpression(expression)) {
								sequenceValid = false;
								break;
							}
							hasMustache = true;
							variables.add(expression.name);
							raw += `{${expression.name}}`;
						}
						endIndex += 1;
					}

					if (sequenceValid && raw && hasMustache && hasText) {
						const startNode = children[index];
						const endNode = children[endIndex - 1];
						considerInterpolated(raw, startNode.start, endNode.end, variables);
						for (const textNode of textNodes) {
							skipTextNodes.add(textNode);
						}
					}

					index = Math.max(endIndex, index + 1);
				}
			};

			const root = (ast as { html?: any; fragment?: any }).fragment ?? ast.html;
			if (ast.instance?.content) {
				processScriptContent(ast.instance.content, content);
			}
			if (ast.module?.content) {
				processScriptContent(ast.module.content, content);
			}
			walkHtml(root, (node) => {
				if (node.type === "Text" && typeof node.data === "string") {
					if (skipTextNodes.has(node)) return;
					consider(node.data, node.start, node.end);
				}

				if (node.type === "Attribute" && ATTRIBUTE_WHITELIST.has(node.name)) {
					if (Array.isArray(node.value) && node.value.length === 1) {
						const valueNode = node.value[0];
						if (valueNode.type === "Text" && typeof valueNode.data === "string") {
							consider(valueNode.data, valueNode.start, valueNode.end);
						}
					}
				}

				if (node.type === "Attribute" && ATTRIBUTE_EXPRESSION_WHITELIST.has(node.name)) {
					if (Array.isArray(node.value)) {
						for (const valueNode of node.value) {
							if (valueNode && MUSTACHE_TYPES.has(valueNode.type) && valueNode.expression) {
								processExpressionStringLiterals(valueNode.expression, content);
							}
						}
					}
				}

				if (MUSTACHE_TYPES.has(node.type) && node.expression) {
					processExpressionStringLiterals(node.expression, content);
				}

				if (node.expression) {
					processExpression(node.expression, content);
				}

				if (node.children && Array.isArray(node.children)) {
					processChildSequences(node.children);
				}
			});

			if (replacements.length === 0) return { code: content };

			const magic = new MagicString(content);
			for (const { start, end, replacement } of replacements) {
				magic.overwrite(start, end, replacement);
			}

			return { code: magic.toString() };
		},
	};
}

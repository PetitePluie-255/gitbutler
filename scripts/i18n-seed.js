import fs from "fs";
import path from "path";

const repoRoot = process.cwd();
const missingLogPath = path.resolve(repoRoot, "locales/missing-en.log");
const poPath =
	process.env.GIT_ZH_CN_PO_PATH ??
	path.resolve(repoRoot, "locales/zh_CN.po");
const seedOutputPath = path.resolve(repoRoot, "locales/zh-CN.seed.json");
const llmInputPath = path.resolve(repoRoot, "locales/llm-input.json");

function parseQuoted(line) {
	const start = line.indexOf('"');
	if (start === -1) return "";
	return JSON.parse(line.slice(start));
}

function parsePo(content) {
	const map = new Map();
	const lines = content.split(/\r?\n/);
	let msgid = null;
	let msgstr = null;
	let state = null;
	let fuzzy = false;

	const flush = () => {
		if (msgid && msgid !== "" && msgstr && msgstr !== "" && !fuzzy) {
			map.set(msgid, msgstr);
		}
		msgid = null;
		msgstr = null;
		state = null;
		fuzzy = false;
	};

	for (const line of lines) {
		if (line.startsWith("#,") && line.includes("fuzzy")) {
			fuzzy = true;
			continue;
		}

		if (line.startsWith("msgid ")) {
			flush();
			state = "msgid";
			msgid = parseQuoted(line);
			continue;
		}

		if (line.startsWith("msgstr ")) {
			state = "msgstr";
			msgstr = parseQuoted(line);
			continue;
		}

		if (line.startsWith('"')) {
			const value = parseQuoted(line);
			if (state === "msgid" && msgid !== null) {
				msgid += value;
			} else if (state === "msgstr" && msgstr !== null) {
				msgstr += value;
			}
			continue;
		}

		if (line.trim() === "") {
			flush();
		}
	}

	flush();
	return map;
}

function readMissingLines() {
	if (!fs.existsSync(missingLogPath)) {
		throw new Error(`missing log not found: ${missingLogPath}`);
	}
	const lines = fs.readFileSync(missingLogPath, "utf-8").split(/\r?\n/);
	const entries = new Set();
	for (const line of lines) {
		if (!line.trim()) continue;
		const marker = "] ";
		const idx = line.indexOf(marker);
		const filePath = idx === -1 ? "" : line.slice(1, idx);
		const text = idx === -1 ? line.trim() : line.slice(idx + marker.length);
		if (text) {
			const normalized = text.replace(/\s+/g, " ").trim();
			entries.add(JSON.stringify({ filePath, text: normalized }));
		}
	}
	return Array.from(entries).map((entry) => JSON.parse(entry));
}

function sortObject(obj) {
	return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

if (!fs.existsSync(poPath)) {
	console.error(
		`Git zh_CN.po not found at ${poPath}. Download it from the official Git repo and place it there.`,
	);
	process.exit(1);
}

const poContent = fs.readFileSync(poPath, "utf-8");
const poMap = parsePo(poContent);
const missingEntries = readMissingLines();
const filterEnabled = process.env.I18N_FILTER !== "0";

function normalizeToRepoRelative(filePath) {
	if (!filePath) return null;
	const normalized = filePath.split(path.sep).join("/");
	if (path.isAbsolute(filePath)) {
		const absolute = path.normalize(filePath);
		const relative = path.relative(repoRoot, absolute);
		return relative.split(path.sep).join("/");
	}

	// Handle paths like ../../packages/ui/src/...
	const cleaned = path
		.normalize(normalized)
		.split(path.sep)
		.join("/")
		.replace(/^(\.\.\/)+/, "");

	// If it already looks repo-relative, use it.
	if (cleaned.startsWith("apps/") || cleaned.startsWith("packages/")) {
		return cleaned;
	}

	// Handle paths that embed an absolute repo path (case-insensitive on macOS).
	const marker = "/gitbutler/";
	const idx = cleaned.toLowerCase().indexOf(marker);
	if (idx !== -1) {
		return cleaned.slice(idx + marker.length);
	}

	return cleaned;
}

function isProjectSource(filePath) {
	const relative = normalizeToRepoRelative(filePath);
	if (!relative) return false;
	if (relative.includes("node_modules/")) return false;
	if (relative.includes(".pnpm/")) return false;
	return relative.startsWith("apps/") || relative.startsWith("packages/");
}

const filteredEntries = filterEnabled
	? missingEntries.filter((entry) => isProjectSource(entry.filePath))
	: missingEntries;

const seed = {};
const remaining = [];

for (const entry of filteredEntries) {
	const translated = poMap.get(entry.text);
	if (translated) {
		seed[entry.text] = translated;
	} else {
		remaining.push(entry.text);
	}
}

fs.writeFileSync(seedOutputPath, JSON.stringify(sortObject(seed), null, 2) + "\n");
fs.writeFileSync(llmInputPath, JSON.stringify(remaining.sort(), null, 2) + "\n");

if (filterEnabled) {
	console.log(
		`Filtered ${filteredEntries.length} entries from ${missingEntries.length} missing log lines`,
	);
} else {
	console.log(`Filtering disabled. Using all ${missingEntries.length} missing log lines.`);
}
console.log(`Seeded ${Object.keys(seed).length} entries from Git official zh_CN.po`);
console.log(`Remaining ${remaining.length} entries for LLM translation`);
console.log(`Wrote: ${seedOutputPath}`);
console.log(`Wrote: ${llmInputPath}`);

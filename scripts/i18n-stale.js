import fs from "fs";
import path from "path";

const repoRoot = process.cwd();
const matchedLogPath = path.resolve(repoRoot, "locales/matched-en.log");
const dictionaryPath = path.resolve(repoRoot, "locales/zh-CN.json");
const outputPath = path.resolve(repoRoot, "locales/zh-CN.stale.json");

function readLines(filePath) {
	if (!fs.existsSync(filePath)) return [];
	return fs
		.readFileSync(filePath, "utf-8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function normalize(line) {
	const marker = "] ";
	const idx = line.indexOf(marker);
	if (idx === -1) return line;
	return line.slice(idx + marker.length);
}

if (!fs.existsSync(dictionaryPath)) {
	console.error(`Dictionary not found: ${dictionaryPath}`);
	process.exit(1);
}

const matchedEntries = readLines(matchedLogPath).map(normalize);
const matchedSet = new Set(matchedEntries);
const dictionary = JSON.parse(fs.readFileSync(dictionaryPath, "utf-8"));
const keys = Object.keys(dictionary);

const stale = keys.filter((key) => !matchedSet.has(key));
fs.writeFileSync(outputPath, JSON.stringify(stale.sort(), null, 2) + "\n");

console.log(`Found ${stale.length} stale dictionary entries`);
console.log(`Wrote: ${outputPath}`);

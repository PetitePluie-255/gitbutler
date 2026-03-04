import fs from "fs";
import path from "path";

const repoRoot = process.cwd();
const missingLogPath = path.resolve(repoRoot, "locales/missing-en.log");
const snapshotPath = path.resolve(repoRoot, "locales/missing-en.snapshot.log");
const outputPath = path.resolve(repoRoot, "locales/missing-en.diff.json");

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
	return line.slice(idx + marker.length).replace(/\s+/g, " ").trim();
}

const current = readLines(missingLogPath);
if (current.length === 0) {
	console.error(`missing log not found or empty: ${missingLogPath}`);
	process.exit(1);
}

const previous = readLines(snapshotPath);
const currentSet = new Set(current.map(normalize));
const previousSet = new Set(previous.map(normalize));

const added = Array.from(currentSet).filter((entry) => !previousSet.has(entry));

fs.writeFileSync(outputPath, JSON.stringify(added.sort(), null, 2) + "\n");
fs.writeFileSync(snapshotPath, current.join("\n") + "\n");

console.log(`Added ${added.length} new entries`);
console.log(`Wrote diff: ${outputPath}`);
console.log(`Updated snapshot: ${snapshotPath}`);

import fs from "fs";
import path from "path";
import { parse } from "svelte/compiler";

const file = process.argv[2];
if (!file) {
	console.error("Usage: node packages/i18n-preprocessor/script/dump-svelte-ast.mjs <path-to-svelte>");
	process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), file);
const content = fs.readFileSync(absolutePath, "utf-8");
const ast = parse(content, { filename: absolutePath });

const root = ast.fragment ?? ast.html ?? null;

function summarize(node, depth = 0, maxDepth = 5) {
	if (!node || depth > maxDepth) return;
	const indent = "  ".repeat(depth);
	const name = node.type ?? "unknown";
	const extra = node.name
		? ` name=${node.name}`
		: node.tagName
			? ` tag=${node.tagName}`
			: "";
	console.log(`${indent}${name}${extra}`);

	const children = [];
	if (node.children) children.push(...node.children);
	if (node.attributes) children.push(...node.attributes);
	if (node.pending) children.push(...node.pending);
	if (node.then) children.push(...node.then);
	if (node.catch) children.push(...node.catch);
	if (node.else) children.push(...node.else);

	for (const child of children) {
		summarize(child, depth + 1, maxDepth);
	}
}

console.log("root:", root ? root.type ?? "(no type)" : "null");
summarize(root);

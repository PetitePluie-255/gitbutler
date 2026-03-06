import {
	SHORT_DEFAULT_BRANCH_TEMPLATE,
	SHORT_DEFAULT_COMMIT_TEMPLATE,
	SHORT_DEFAULT_PR_TEMPLATE,
} from "$lib/ai/prompts";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import OpenAI from "openai";
import type { AntigravityModelName, Prompt, AIClient, AIEvalOptions } from "$lib/ai/types";

const DEFAULT_MAX_TOKENS = 1024;

export class AntigravityClient implements AIClient {
	defaultCommitTemplate = SHORT_DEFAULT_COMMIT_TEMPLATE;
	defaultBranchTemplate = SHORT_DEFAULT_BRANCH_TEMPLATE;
	defaultPRTemplate = SHORT_DEFAULT_PR_TEMPLATE;

	private client: OpenAI;
	private key: string;
	private modelName: AntigravityModelName;

	constructor(key: string, modelName: AntigravityModelName, baseURL: string | undefined) {
		this.key = key;
		this.modelName = modelName;
		this.client = new OpenAI({
			apiKey: key,
			dangerouslyAllowBrowser: true,
			baseURL,
			fetch: tauriFetch as any,
			defaultHeaders: {
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 GitButler/1.0",
			},
		});
	}

	async evaluate(prompt: Prompt, options?: AIEvalOptions): Promise<string> {
		const response = await this.client.chat.completions.create({
			max_completion_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
			messages: prompt,
			model: this.modelName,
			stream: true,
		});

		const buffer: string[] = [];
		for await (const chunk of response) {
			const token = chunk.choices[0]?.delta.content ?? "";
			options?.onToken?.(token);
			buffer.push(token);
		}
		return buffer.join("");
	}
}

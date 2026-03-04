import svelteI18nPreprocessor from "@gitbutler/i18n-preprocessor";
import svelteInjectComment from "@gitbutler/svelte-comment-injector";
import staticAdapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
	preprocess: [
		vitePreprocess({ script: true }),
		svelteI18nPreprocessor(),
		svelteInjectComment(),
	],
	kit: {
		alias: {
			$components: "./src/components",
		},
		adapter: staticAdapter({
			pages: "build",
			assets: "build",
			fallback: "index.html",
			precompress: false,
			strict: false,
		}),
	},
	compilerOptions: {
		css: "external",
	},
};

export default config;

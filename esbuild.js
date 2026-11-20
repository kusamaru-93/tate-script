const esbuild = require("esbuild");
const { copyFile, mkdir } = require('node:fs/promises');
const { dirname, join } = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'));
	await mkdir('dist/pdfjs', { recursive: true });
	await Promise.all([
		copyFile(join(pdfjs, 'build/pdf.worker.min.mjs'), 'dist/pdfjs/pdf.worker.mjs'),
		copyFile(join(pdfjs, 'LICENSE'), 'dist/pdfjs/LICENSE'),
	]);
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', 'playwright-core'],
		alias: { 'jsonc-parser': 'jsonc-parser/lib/esm/main.js' },
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	const viewer = await esbuild.context({
		entryPoints: ['media/pdfPreview.js'],
		bundle: true,
		format: 'iife',
		outfile: 'dist/pdfjs/viewer.js',
		minify: production,
	});
	if (watch) {
		await viewer.watch();
		await ctx.watch();
	} else {
		await viewer.rebuild();
		await viewer.dispose();
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});

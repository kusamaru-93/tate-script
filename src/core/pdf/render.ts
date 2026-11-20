import { layoutScreenplay } from '../layout/screenplay';
import { findLineBreak, graphemes } from '../layout/lineBreak';
import { millimetersPerPoint, pageGeometry, papers } from '../layout/pageGeometry';
import type { PaperSize } from '../layout/pageGeometry';
import { parseScreenplay } from '../parser/screenplay';
import type { Character, ProjectSettings } from '../project/settings';

export interface SavedProject {
	settings: ProjectSettings;
	characters: Character[];
	source: string;
}

export interface RenderedPdf {
	bytes: Buffer;
	overflowPages: number[];
}

function escape(text: string): string {
	return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

const castLayout = { top: 20, side: 43, bottom: 22, minColumn: 10, descriptionIndent: 5 };

function characterPages(characters: Character[], paperSize: PaperSize, fontMm: number, columnMm: number): string {
	const { width, height } = papers[paperSize];
	const columnsPerPage = Math.floor((width - 2 * castLayout.side) / columnMm);
	// The bottom margin has room for the description's one hanging grapheme.
	const charactersPerColumn = Math.floor((height - castLayout.top - castLayout.descriptionIndent - castLayout.bottom) / fontMm);
	const pages: string[][] = [];
	let columns: string[] = [];
	function finishPage() {
		pages.push(columns);
		columns = [];
	}

	for (const { name, description } of characters) {
		const entry: string[] = [];
		for (const [style, text] of [['name', name], ['description', description]] as const) {
			if (!text) {
				continue;
			}
			for (const line of text.split(/\r\n|\r|\n/u)) {
				const cells = Array.from(graphemes.segment(line), ({ segment }) => ({ text: segment }));
				let start = 0;
				do {
					const end = style === 'description'
						? findLineBreak(cells, start, charactersPerColumn, { hangClosingBrackets: true }).end
						: Math.min(start + charactersPerColumn, cells.length);
					const content = cells.slice(start, end).map(cell => cell.text).join('');
					entry.push(`<div class="cast-column ${style}">${escape(content)}</div>`);
					start = end;
				} while (start < cells.length);
			}
		}

		if (columns.length) {
			if (columns.length + 1 + entry.length > columnsPerPage) {
				finishPage();
			} else {
				columns.push('<div class="cast-column" aria-hidden="true"></div>');
			}
		}
		for (const column of entry) {
			if (columns.length === columnsPerPage) {
				finishPage();
			}
			columns.push(column);
		}
	}
	if (columns.length) {
		finishPage();
	}
	return pages.map(page => `<section class="cast sheet"><h2>登場人物表</h2><div class="cast-columns">${page.join('')}</div></section>`).join('');
}

function printHtml(project: SavedProject): string {
	const { settings, characters, source } = project;
	const { paperSize } = settings.page;
	const paper = papers[paperSize];
	const geometry = pageGeometry(settings.page, paperSize);
	const castColumn = Math.max(castLayout.minColumn, geometry.font * 1.25);
	const pages = layoutScreenplay(parseScreenplay(source), settings.page);
	const body = pages.map(page => `<section class="body-page sheet" aria-label="本文 ${page.number}">
		<div class="columns">${page.lines.map(line => 'cells' in line ?
		`<div class="column indent-${line.indent}">${line.cells.map(cell => `<span>${escape(cell.text)}</span>`).join('')}</div>` :
		'<div class="column"></div>').join('')}</div>
		<footer>${page.number}/${pages.length}</footer>
	</section>`).join('');

	return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(settings.title)}</title>
<style>
@page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; color: #161616; font-family: "Yu Mincho", "MS Mincho", serif; }
.sheet { position: relative; width: ${paper.width}mm; height: ${paper.height - 0.1}mm; }
.sheet + .sheet { break-before: page; }
.cover h1, .cover p, .cast h2, .cast-column { writing-mode: vertical-rl; text-orientation: mixed; margin: 0; }
.cover h1, .cover p { position: absolute; font-weight: normal; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.cover h1 { top: calc(50% - 50mm); left: 50%; transform: translateX(-50%); inline-size: 100mm; font-size: 30pt; text-align: center; }
.cover p { bottom: 22mm; right: calc(50% + 16mm); max-inline-size: 43mm; font-size: 22pt; }
.cast h2 { position: absolute; top: ${castLayout.top}mm; right: 22mm; font-size: ${geometry.font + 2 * millimetersPerPoint}mm; font-weight: normal; }
.cast-columns { position: absolute; top: ${castLayout.top}mm; right: ${castLayout.side}mm; display: flex; flex-direction: row-reverse; }
.cast-column { flex: 0 0 ${castColumn}mm; width: ${castColumn}mm; font-size: ${geometry.font}mm; line-height: ${castColumn}mm; white-space: pre; }
.cast-column.name { font-weight: bold; }
.cast-column.description { padding-top: ${castLayout.descriptionIndent}mm; }
.columns { position: absolute; top: ${geometry.top}mm; right: ${geometry.right}mm; display: flex; flex-direction: row-reverse; font-size: ${geometry.font}mm; }
.column { flex: 0 0 ${geometry.line}mm; width: ${geometry.line}mm; }
.indent-1 { padding-top: ${geometry.cell}mm; }
.indent-3 { padding-top: ${3 * geometry.cell}mm; }
.column span { display: grid; place-items: center; writing-mode: vertical-rl; text-orientation: mixed; white-space: pre; line-height: 1; width: ${geometry.line}mm; height: ${geometry.cell}mm; }
footer { position: absolute; left: 13mm; bottom: 6mm; font-size: 10pt; }
</style></head><body><section class="cover sheet"><h1>${escape(settings.title)}</h1>${settings.author ? `<p>${escape(settings.author)}</p>` : ''}</section>${characterPages(characters, paperSize, geometry.font, castColumn)}${body}</body></html>`;
}

export async function renderPdf(project: SavedProject): Promise<RenderedPdf> {
	const { chromium } = await import('playwright-core');
	const browser = await chromium.launch({ channel: 'msedge', chromiumSandbox: true, timeout: 15_000 })
		.catch((error: unknown) => {
			throw new Error('PDF生成用のMicrosoft Edgeを起動できませんでした。Edgeのインストールと実行設定を確認してください。', { cause: error });
		});
	try {
		const page = await browser.newPage({ locale: 'ja-JP', offline: true });
		await page.emulateMedia({ media: 'print' });
		await page.setContent(printHtml(project), { timeout: 15_000 });
		const overflowPages = await page.evaluate(async () => {
			await document.fonts.ready;
			return Array.from(document.querySelectorAll('.body-page')).flatMap((page, index) => {
				const bounds = page.getBoundingClientRect();
				const range = document.createRange();
				const overflow = Array.from(page.querySelectorAll('.column span, footer')).some(cell => {
					range.selectNodeContents(cell);
					const rect = range.getBoundingClientRect();
					return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
						rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1);
				});
				return overflow ? [index + 1] : [];
			});
		});
		const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
		return { bytes, overflowPages };
	} finally {
		await browser.close();
	}
}

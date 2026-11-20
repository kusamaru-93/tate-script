import { standardPage } from './screenplay';
import type { PageSize } from './screenplay';

export const papers = {
	A4: { width: 297, height: 210 },
	B5: { width: 257, height: 182 },
} as const;
export type PaperSize = keyof typeof papers;
export const defaultPaperSize = 'A4';
export const millimetersPerPoint = 25.4 / 72;
const standardBodyPoints = { A4: 14, B5: 12 } satisfies Record<PaperSize, number>;

export function isPaperSize(value: unknown): value is PaperSize {
	return typeof value === 'string' && Object.hasOwn(papers, value);
}

export function pageGeometry(size: Readonly<PageSize>, paperSize: PaperSize) {
	const paper = papers[paperSize];
	const heightScale = paper.height / papers.A4.height;
	const widthScale = paper.width / papers.A4.width;
	const top = 28 * heightScale;
	const bottom = 19 * heightScale;
	const side = 31.5 * widthScale;
	const cellsPerLine = size.charactersPerLine + 1;
	const cell = (paper.height - top - bottom) / cellsPerLine;
	const line = (paper.width - 2 * side) / size.linesPerPage;
	const font = standardBodyPoints[paperSize] * millimetersPerPoint * ((standardPage.charactersPerLine + 1) / cellsPerLine);
	return {
		top,
		right: side,
		cell,
		line,
		font: Math.min(font, line * 0.87),
	};
}

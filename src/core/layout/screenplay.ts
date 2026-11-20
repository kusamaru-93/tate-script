import type { ScreenplayBlock, SourceLine, SourceRange } from '../parser/screenplay';
import { findLineBreak, graphemes } from './lineBreak';

export interface PageSize {
	charactersPerLine: number;
	linesPerPage: number;
}

export const standardPage: Readonly<PageSize> = { charactersPerLine: 20, linesPerPage: 20 };

interface LayoutCell {
	text: string;
	range: SourceRange;
}

export type LayoutLine =
	| { kind: 'heading' | 'action' | 'dialogue'; indent: 0 | 1 | 3; source: SourceLine; cells: LayoutCell[]; hanging: boolean }
	| { kind: 'blank'; source: SourceLine };

export interface LayoutPage {
	number: number;
	lines: LayoutLine[];
}

function wrapLine(source: SourceLine, kind: 'heading' | 'action' | 'dialogue', first: boolean, width: number): LayoutLine[] {
	const cells = Array.from(graphemes.segment(source.text), ({ segment, index }) => ({
		text: segment === '\t' ? ' ' : segment,
		range: { start: source.range.start + index, end: source.range.start + index + segment.length },
	}));
	const lines: LayoutLine[] = [];
	for (let start = 0; start < cells.length;) {
		const indent = kind === 'action' ? 3 : kind === 'dialogue' && !first ? 1 : 0;
		const { end, hanging } = findLineBreak(cells, start, width - indent);
		lines.push({ kind, indent, source, cells: cells.slice(start, end), hanging });
		start = end;
		first = false;
	}
	return lines;
}

export function layoutScreenplay(blocks: ScreenplayBlock[], size: Readonly<PageSize> = standardPage): LayoutPage[] {
	const { charactersPerLine, linesPerPage } = size;
	if (!Number.isSafeInteger(charactersPerLine) || charactersPerLine <= 3 ||
		!Number.isSafeInteger(linesPerPage) || linesPerPage <= 0) {
		throw new RangeError('Invalid screenplay page dimensions');
	}

	const pages: LayoutPage[] = [];
	let lines: LayoutLine[] = [];
	const finishPage = () => {
		if (lines.length) {
			pages.push({ number: pages.length + 1, lines });
			lines = [];
		}
	};
	const append = (line: LayoutLine) => {
		lines.push(line);
		if (lines.length === linesPerPage) {
			finishPage();
		}
	};

	for (const { kind, lines: sourceLines } of blocks) {
		if (kind === 'pageBreak') {
			finishPage();
		} else if (kind === 'blank') {
			for (const source of sourceLines) {
				append({ kind: 'blank', source });
			}
		} else {
			sourceLines.forEach((source, index) => {
				for (const line of wrapLine(source, kind, index === 0, charactersPerLine)) {
					append(line);
				}
			});
		}
	}
	finishPage();
	return pages;
}

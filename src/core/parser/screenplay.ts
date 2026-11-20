export interface SourceRange {
	start: number;
	end: number;
}

export interface SourceLine {
	text: string;
	range: SourceRange;
}

export interface ScreenplayBlock {
	kind: 'heading' | 'action' | 'dialogue' | 'blank' | 'pageBreak';
	lines: SourceLine[];
	speaker?: SourceRange;
}

function physicalLines(source: string): SourceLine[] {
	const lines: SourceLine[] = [];
	let start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
	for (const newline of source.matchAll(/\r?\n/g)) {
		const end = newline.index;
		lines.push({ text: source.slice(start, end), range: { start, end } });
		start = end + newline[0].length;
	}
	if (start < source.length) {
		lines.push({ text: source.slice(start), range: { start, end: source.length } });
	}
	return lines;
}

const heading = /^[○〇]/u;
export const pageBreak = '\f';

function dialogueOpening(text: string): number {
	const opening = text.indexOf('「');
	return opening < 0 || /[、。！？「」『』]/u.test(text.slice(0, opening)) ? -1 : opening;
}

function dialogueEnd(lines: SourceLine[], start: number, opening: number): number {
	let depth = 0;
	for (let row = start; row < lines.length; row++) {
		const { text } = lines[row];
		if (row > start && (!text.trim() || heading.test(text) || dialogueOpening(text) >= 0)) {
			break;
		}
		for (let column = row === start ? opening : 0; column < text.length; column++) {
			if (text[column] === '「') {
				depth++;
			} else if (text[column] === '」' && --depth === 0) {
				return text.slice(column + 1).trim() ? -1 : row;
			}
		}
	}
	return -1;
}

export function parseScreenplay(source: string): ScreenplayBlock[] {
	const lines = physicalLines(source);
	const blocks: ScreenplayBlock[] = [];
	for (let row = 0; row < lines.length; row++) {
		const line = lines[row];
		if (line.text === pageBreak) {
			blocks.push({ kind: 'pageBreak', lines: [line] });
			continue;
		}
		if (heading.test(line.text)) {
			blocks.push({ kind: 'heading', lines: [line] });
			continue;
		}
		if (!line.text.trim()) {
			blocks.push({ kind: 'blank', lines: [line] });
			continue;
		}

		const opening = dialogueOpening(line.text);
		const end = opening < 0 ? -1 : dialogueEnd(lines, row, opening);
		if (end >= row) {
			const block: ScreenplayBlock = { kind: 'dialogue', lines: lines.slice(row, end + 1) };
			const prefix = line.text.slice(0, opening);
			if (prefix.trim()) {
				block.speaker = {
					start: line.range.start + prefix.length - prefix.trimStart().length,
					end: line.range.start + prefix.trimEnd().length,
				};
			}
			blocks.push(block);
			row = end;
			continue;
		}

		const previous = blocks.at(-1);
		if (previous?.kind === 'action') {
			previous.lines.push(line);
		} else {
			blocks.push({ kind: 'action', lines: [line] });
		}
	}
	return blocks;
}

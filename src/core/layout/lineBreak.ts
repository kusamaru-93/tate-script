export const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });

const noLineEnd = /^[「『（［【]/u;
const noLineStart = /^[」』）］】、。]/u;
const hangingPunctuation = /^[、。]/u;

export function findLineBreak(
	cells: readonly { text: string }[], start: number, width: number, { hangClosingBrackets = false } = {},
) {
	const limit = Math.min(start + width, cells.length);
	if (limit === cells.length) {
		return { end: limit, hanging: false };
	}

	const canHang = hangClosingBrackets ? noLineStart : hangingPunctuation;
	if (!noLineEnd.test(cells[limit - 1].text) && canHang.test(cells[limit].text) &&
		(limit + 1 === cells.length || !noLineStart.test(cells[limit + 1].text))) {
		return { end: limit + 1, hanging: true };
	}

	let end = limit;
	while (end > start && (noLineEnd.test(cells[end - 1].text) || noLineStart.test(cells[end].text))) {
		end--;
	}
	return { end: end === start ? limit : end, hanging: false };
}

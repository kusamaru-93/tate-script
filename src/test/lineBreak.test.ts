import * as assert from 'node:assert/strict';
import { findLineBreak, graphemes } from '../core/layout/lineBreak';

suite('Line breaking', () => {
	const cells = (text: string) => Array.from(graphemes.segment(text), ({ segment }) => ({ text: segment }));
	const description = { hangClosingBrackets: true };

	test('allows punctuation and closing brackets to hang one cell in cast descriptions', () => {
		for (const [opening, hanging] of [['', '、'], ['', '。'], ['（', '）'], ['「', '」'], ['『', '』'], ['［', '］'], ['【', '】']]) {
			const prefix = opening ? `説明${opening}例` : '説明本文';
			assert.deepEqual(findLineBreak(cells(`${prefix}${hanging}続`), 0, 4, description), { end: 5, hanging: true });
		}
		assert.deepEqual(findLineBreak(cells('説明「例」続'), 0, 4), { end: 2, hanging: false });
	});

	test('moves the break back when an opening bracket would end a line or hanging would leave another closing mark', () => {
		assert.deepEqual(findLineBreak(cells('説明文「例」'), 0, 4, description), { end: 3, hanging: false });
		assert.deepEqual(findLineBreak(cells('説明「例」。続'), 0, 4, description), { end: 2, hanging: false });
	});
});

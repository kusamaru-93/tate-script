import * as assert from 'node:assert/strict';
import { layoutScreenplay } from '../core/layout/screenplay';
import { parseScreenplay } from '../core/parser/screenplay';

const layout = (source: string) => layoutScreenplay(parseScreenplay(source));

suite('Screenplay', () => {
	test('classifies both scene markers and quoted action, preserving CRLF source positions', () => {
		const source = '\ufeff○公園（夕）「柱」\r\n美咲は『約束』を思い出す。\r\n美咲、笑って「ありがとう」と言う。\r\n美咲「『約束』を守る」\r\n〇駅（夜）\r\n';
		const blocks = parseScreenplay(source);
		assert.deepEqual(blocks.map(block => block.kind), ['heading', 'action', 'dialogue', 'heading']);
		assert.deepEqual(blocks.flatMap(block => block.lines.map(line => source.slice(line.range.start, line.range.end))), [
			'○公園（夕）「柱」', '美咲は『約束』を思い出す。', '美咲、笑って「ありがとう」と言う。',
			'美咲「『約束』を守る」', '〇駅（夜）',
		]);
		const speaker = blocks[2].speaker;
		assert.ok(speaker);
		assert.equal(source.slice(speaker.start, speaker.end), '美咲');
	});

	test('uses closed multiline dialogue and recovers at the next dialogue if unclosed', () => {
		const blocks = parseScreenplay('美咲「未確定\n健太「今日は\nここまで」\n「また明日」');
		assert.deepEqual(blocks.map(block => [block.kind, block.lines.length]), [
			['action', 1], ['dialogue', 2], ['dialogue', 1],
		]);
		assert.equal(blocks[2].speaker, undefined);
		assert.deepEqual(layoutScreenplay(blocks)[0].lines.flatMap(line => 'indent' in line ? [line.indent] : []), [3, 0, 1, 0]);
	});

	test('preserves authored blanks and indents wrapped dialogue in the design fixture', () => {
		const source = '〇公園（夕）\n美咲が立ち止まる。\n\n美咲「きょうはここまで歩いてきたけれどもう少し先の景色も見てみたい」';
		const [{ lines }] = layout(source);
		assert.deepEqual(lines.map(line => [line.kind, 'indent' in line ? line.indent : null]), [
			['heading', 0], ['action', 3], ['blank', null], ['dialogue', 0], ['dialogue', 1],
		]);
		assert.deepEqual(lines.flatMap(line => 'cells' in line ? [line.cells.map(cell => cell.text).join('')] : []).slice(-2), [
			'美咲「きょうはここまで歩いてきたけれども', 'う少し先の景色も見てみたい」',
		]);
	});

	test('keeps adjacent blocks adjacent and preserves consecutive blanks', () => {
		const source = '○公園\r\n立ち止まる。\r\n美咲「おはよう」\r\n健太「うん」\r\n歩き出す。\r\n〇駅\r\n\r\n\r\n';
		const [{ lines }] = layout(source);
		assert.deepEqual(lines.map(line => line.kind), [
			'heading', 'action', 'dialogue', 'dialogue', 'action', 'heading', 'blank', 'blank',
		]);
		assert.deepEqual(lines.map(line => source.slice(line.source.range.start, line.source.range.end)),
			['○公園', '立ち止まる。', '美咲「おはよう」', '健太「うん」', '歩き出す。', '〇駅', '', '']);
	});

	test('paginates within a block and counts authored blanks across the page boundary', () => {
		const full = 'あ'.repeat(17 * 20);
		const pages = layout(`${full}あ\n〇駅`);
		assert.deepEqual(pages.map(page => [page.number, page.lines.length]), [[1, 20], [2, 2]]);
		assert.deepEqual(pages[1].lines.map(line => line.kind), ['action', 'heading']);
		const line = pages[1].lines[0];
		assert.ok('cells' in line);
		assert.equal(line.indent, 3);
		assert.equal(line.cells.length, 1);
		assert.equal(layout(full).length, 1);
		assert.deepEqual(layout(`${full}\n〇駅`)[1].lines.map(line => line.kind), ['heading']);
		assert.deepEqual(layout(`${full}\r\n\r\n〇駅`)[1].lines.map(line => line.kind), ['blank', 'heading']);
		const almostFull = 'あ'.repeat(17 * 19);
		const withoutGap = layout(`${almostFull}\n〇駅`);
		assert.equal(withoutGap.length, 1);
		assert.equal(withoutGap[0].lines.at(-1)?.kind, 'heading');
		const withGap = layout(`${almostFull}\n\n\n〇駅`);
		assert.equal(withGap[0].lines.at(-1)?.kind, 'blank');
		assert.deepEqual(withGap[1].lines.map(line => line.kind), ['blank', 'heading']);
		assert.deepEqual(layout(''), []);
	});

	test('keeps graphemes intact and applies punctuation hanging and bracket line breaks', () => {
		const grapheme = 'か\u3099';
		const [{ lines: [first, second] }] = layout(`${'あ'.repeat(16)}${grapheme}、続く`);
		assert.ok('cells' in first && 'cells' in second);
		assert.equal(first.cells[16].text, grapheme);
		assert.deepEqual(first.cells[16].range, { start: 16, end: 18 });
		assert.equal(first.cells.at(-1)?.text, '、');
		assert.equal(first.hanging, true);
		assert.equal(second.cells[0].text, '続');

		const [{ lines: [before, after] }] = layout(`${'あ'.repeat(16)}『句』`);
		assert.ok('cells' in before && 'cells' in after);
		assert.equal(before.cells.length, 16);
		assert.equal(after.cells[0].text, '『');
	});

	test('starts a new page at a manual break without introducing empty pages', () => {
		const pages = layout('\f\r\n○公園\r\n\f\r\n\f\r\n美咲「またね」\r\n\f');
		assert.deepEqual(pages.map(page => [page.number, ...page.lines.map(line => line.kind)]), [
			[1, 'heading'], [2, 'dialogue'],
		]);
		assert.deepEqual(layout('\f\n\f'), []);
		const blocks = parseScreenplay('美咲「未確定\n\f\nここまで」');
		assert.deepEqual(blocks.map(block => block.kind), ['action', 'pageBreak', 'action']);
	});
});

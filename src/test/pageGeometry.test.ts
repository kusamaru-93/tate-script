import * as assert from 'node:assert/strict';
import { millimetersPerPoint, pageGeometry, papers } from '../core/layout/pageGeometry';
import { standardPage } from '../core/layout/screenplay';

suite('Page geometry', () => {
	test('uses the specified point sizes for the standard 20 by 20 page', () => {
		assert.equal(pageGeometry(standardPage, 'A4').font, 14 * millimetersPerPoint);
		assert.equal(pageGeometry(standardPage, 'B5').font, 12 * millimetersPerPoint);
	});

	test('uses equal side margins of 31.5 mm on A4 and scales them for B5', () => {
		for (const size of ['A4', 'B5'] as const) {
			const geometry = pageGeometry(standardPage, size);
			const left = papers[size].width - geometry.right - geometry.line * standardPage.linesPerPage;
			assert.ok(Math.abs(left - geometry.right) < 1e-9);
			assert.equal(geometry.right, 31.5 * (papers[size].width / papers.A4.width));
		}
	});

	test('scales the font for denser pages and limits it to the available column width', () => {
		const standard = pageGeometry(standardPage, 'B5');
		const moreCharacters = pageGeometry({ ...standardPage, charactersPerLine: 40 }, 'B5');
		const moreLines = pageGeometry({ charactersPerLine: 10, linesPerPage: 40 }, 'B5');
		assert.equal(moreCharacters.font, standard.font * (21 / 41));
		assert.equal(moreLines.font, moreLines.line * 0.87);
	});
});

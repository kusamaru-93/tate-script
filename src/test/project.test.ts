import * as assert from 'node:assert/strict';
import { parseCharacters, parseProjectSettings, readProjectTitle } from '../core/project/settings';

suite('Project settings', () => {
	const settings = (columns: string, rows: string, paper = '') =>
		`{"schemaVersion":1,"page":{"charactersPerLine":${columns},"linesPerPage":${rows}${paper}}}`;
	test('accepts supported dimensions and resolves optional settings', () => {
		assert.deepEqual(parseProjectSettings(settings('10', '40'), 'project.json'), {
			title: 'screenplay.txt', author: undefined, page: { charactersPerLine: 10, linesPerPage: 40, paperSize: 'A4' },
		});
		assert.equal(readProjectTitle('{"title":"約束"}', 'project.json'), '約束');
		assert.equal(readProjectTitle('{"title":"　"}', 'project.json'), 'screenplay.txt');
	});

	test('accepts A4 and B5 and defaults unsupported paper sizes to A4', () => {
		for (const value of ['A4', 'B5', '', 'Letter', 'constructor', null, 5]) {
			const text = settings('20', '20', `,"paperSize":${JSON.stringify(value)}`);
			assert.equal(parseProjectSettings(text, 'project.json').page.paperSize, value === 'B5' ? 'B5' : 'A4');
		}
	});

	test('rejects missing settings, bad numeric tokens, invalid syntax, and duplicate keys', () => {
		for (const invalid of ['0', '41', '20.0', '2e1', '"20"', '"２０"', 'null', '-20']) {
			assert.throws(() => parseProjectSettings(settings('20', invalid), 'project.json'), /project\.json: page\.linesPerPage/u);
		}
		assert.throws(() => parseProjectSettings(settings('20', '２０'), 'project.json'), /1行 \d+列.*JSON構文エラー/u);
		assert.throws(() => parseProjectSettings('{"schemaVersion":2,"page":{}}', 'project.json'), /schemaVersion/u);
		assert.throws(() => parseProjectSettings('{"schemaVersion":1,"page":{"charactersPerLine":20}}', 'project.json'), /page\.linesPerPage/u);
		assert.throws(() => parseProjectSettings(
			'{"schemaVersion":1,"page":{"charactersPerLine":20,"linesPerPage":20,"linesPerPag\\u0065":2e1}}', 'project.json',
		), /page\.linesPerPage.*重複/u);
	});

	test('distinguishes an empty cast from a valid but unusable JSON document', () => {
		assert.deepEqual(parseCharacters('\r\n ', 'characters.json'), []);
		assert.deepEqual(parseCharacters('{"characters":[]}', 'characters.json'), []);
		assert.deepEqual(parseCharacters('{"characters":[{"name":"美咲"}]}', 'characters.json'), [{ name: '美咲', description: undefined }]);
		assert.throws(() => parseCharacters('{"characters":[{"name":"美咲"},null]}', 'characters.json'), /characters\.json: characters\[1\]/u);
		assert.throws(() => parseCharacters('{"characters":[{"name":"　"}]}', 'characters.json'), /characters\[0\]\.name/u);
		assert.throws(() => parseCharacters('{"characters":[{"name":"美咲","description":5}]}', 'characters.json'), /description/u);
		assert.throws(() => parseCharacters('{"characters":{}}', 'characters.json'), /配列/u);
	});
});

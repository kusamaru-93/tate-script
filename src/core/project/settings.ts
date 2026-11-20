import { findNodeAtLocation, getNodePath, parseTree, printParseErrorCode } from 'jsonc-parser';
import type { Node, ParseError } from 'jsonc-parser';
import type { PageSize } from '../layout/screenplay';
import { standardPage } from '../layout/screenplay';
import { defaultPaperSize, isPaperSize } from '../layout/pageGeometry';
import type { PaperSize } from '../layout/pageGeometry';

export interface ProjectSettings {
	title: string;
	author?: string;
	page: PageSize & { paperSize: PaperSize };
}

export const defaultPageSettings: Readonly<ProjectSettings['page']> = { ...standardPage, paperSize: defaultPaperSize };

export interface Character {
	name: string;
	description?: string;
}

function jsonTree(text: string, file: string): Node {
	const errors: ParseError[] = [];
	const root = parseTree(text, errors, { disallowComments: true });
	const error = errors[0];
	if (!root || error) {
		const preceding = text.slice(0, error?.offset ?? 0).split(/\r\n|\n|\r/u);
		throw new Error(`${file} (${preceding.length}行 ${preceding.at(-1)!.length + 1}列): JSON構文エラー (${error ? printParseErrorCode(error.error) : '空のファイル'})`);
	}
	return root;
}

function rejectDuplicateKeys(root: Node, file: string): void {
	if (root.type === 'object') {
		const names = new Set<string>();
		for (const property of root.children ?? []) {
			const key = property.children![0].value as string;
			if (names.has(key)) {
				throw new Error(`${file}: ${[...getNodePath(root), key].join('.')} のキーが重複しています。`);
			}
			names.add(key);
		}
	}
	for (const child of root.children ?? []) {
		rejectDuplicateKeys(child, file);
	}
}

function stringValue(node: Node | undefined): string | undefined {
	return node?.type === 'string' && node.value.trim() ? node.value : undefined;
}

export function readProjectTitle(text: string, file: string): string {
	const root = jsonTree(text, file);
	return stringValue(findNodeAtLocation(root, ['title'])) ?? 'screenplay.txt';
}

export function parseProjectSettings(text: string, file: string): ProjectSettings {
	const root = jsonTree(text, file);
	rejectDuplicateKeys(root, file);
	if (root.type !== 'object' || findNodeAtLocation(root, ['page'])?.type !== 'object') {
		throw new Error(`${file}: 設定のルートと page はJSONオブジェクトで指定してください。`);
	}
	const integer = (path: string[], min: number, max: number) => {
		const node = findNodeAtLocation(root, path);
		if (node?.type !== 'number' || !/^[0-9]+$/u.test(text.slice(node.offset, node.offset + node.length)) ||
			node.value < min || node.value > max) {
			throw new Error(`${file}: ${path.join('.')} は半角数字で ${min === max ? min : `${min}〜${max}の整数`} を指定してください。`);
		}
		return node.value as number;
	};
	integer(['schemaVersion'], 1, 1);
	const paperSize: unknown = findNodeAtLocation(root, ['page', 'paperSize'])?.value;
	return {
		title: stringValue(findNodeAtLocation(root, ['title'])) ?? 'screenplay.txt',
		author: stringValue(findNodeAtLocation(root, ['author'])),
		page: {
			charactersPerLine: integer(['page', 'charactersPerLine'], 10, 40),
			linesPerPage: integer(['page', 'linesPerPage'], 10, 40),
			paperSize: isPaperSize(paperSize) ? paperSize : defaultPaperSize,
		},
	};
}

export function parseCharacters(text: string, file: string): Character[] {
	if (/^[ \t\r\n]*$/u.test(text)) {
		return [];
	}
	const root = jsonTree(text, file);
	const array = findNodeAtLocation(root, ['characters']);
	if (root.type !== 'object' || array?.type !== 'array') {
		throw new Error(`${file}: ルートはJSONオブジェクト、characters は配列で指定してください。`);
	}
	return (array.children ?? []).map((character, index) => {
		const field = `characters[${index}]`;
		if (character.type !== 'object') {
			throw new Error(`${file}: ${field} はJSONオブジェクトで指定してください。`);
		}
		const name = stringValue(findNodeAtLocation(character, ['name']));
		if (!name) {
			throw new Error(`${file}: ${field}.name は空欄でない文字列で指定してください。`);
		}
		const description = findNodeAtLocation(character, ['description']);
		if (description && description.type !== 'string') {
			throw new Error(`${file}: ${field}.description は文字列で指定してください。`);
		}
		return { name, description: stringValue(description) };
	});
}

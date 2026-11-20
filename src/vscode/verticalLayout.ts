import * as vscode from 'vscode';
import { layoutScreenplay } from '../core/layout/screenplay';
import { pageGeometry, papers } from '../core/layout/pageGeometry';
import { parseScreenplay } from '../core/parser/screenplay';
import { defaultPageSettings, parseProjectSettings } from '../core/project/settings';
import { projectFolder, readProjectFile } from './projects';

export function documentText(document: vscode.TextDocument): string {
	return document.getText().replace(/\r\n/gu, '\n');
}

export function verticalLayout(document: vscode.TextDocument, webview: vscode.Webview, editing = false) {
	const settings = vscode.Uri.joinPath(projectFolder(document.uri), 'project.json');
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(projectFolder(document.uri), 'project.json'));
	let size = defaultPageSettings;
	let settingsVersion = 0;
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let ready = false;
	let disposed = false;
	let settingsError: string | undefined;

	function refresh() {
		const request = ++generation;
		if (!ready || disposed) {
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(() => {
			const text = documentText(document);
			const pages = layoutScreenplay(parseScreenplay(text), size).map(page =>
				page.lines.map(line => ({
					indent: 'cells' in line ? line.indent : 0,
					range: line.source.range,
					cells: 'cells' in line ? line.cells : [],
				})),
			);
			if (editing && (!pages.length || text.endsWith('\n'))) {
				if (!pages.length || pages.at(-1)!.length === size.linesPerPage) {
					pages.push([]);
				}
				pages.at(-1)!.push({ indent: 0, range: { start: text.length, end: text.length }, cells: [] });
			}
			void webview.postMessage({
				type: 'layout', version: document.version, generation: request, pages,
				geometry: pageGeometry(size, size.paperSize), paper: papers[size.paperSize], settingsError, ...(editing ? { text } : {}),
			});
		}, editing ? 0 : 80);
	}

	async function loadSettings() {
		const request = ++settingsVersion;
		try {
			const text = await readProjectFile(settings, true);
			const next = text === undefined ? defaultPageSettings : parseProjectSettings(text, settings.fsPath).page;
			if (request !== settingsVersion || disposed) {
				return;
			}
			size = next;
			settingsError = undefined;
		} catch (error) {
			if (request !== settingsVersion || disposed) {
				return;
			}
			settingsError = `前回の有効なページ設定で表示しています。 ${String(error)}`;
		}
		refresh();
	}

	const subscriptions = [
		watcher,
		watcher.onDidChange(loadSettings), watcher.onDidCreate(loadSettings), watcher.onDidDelete(loadSettings),
		vscode.workspace.onDidSaveTextDocument(saved => {
			if (saved.uri.toString() === settings.toString()) {
				void loadSettings();
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === document && event.contentChanges.length) {
				refresh();
			}
		}),
	];
	return {
		start() {
			ready = true;
			void loadSettings();
		},
		dispose() {
			disposed = true;
			clearTimeout(timer);
			for (const subscription of subscriptions) {
				subscription.dispose();
			}
		},
	};
}

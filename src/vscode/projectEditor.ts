import * as vscode from 'vscode';
import { defaultPageSettings, parseCharacters, parseProjectSettings } from '../core/project/settings';
import { isPaperSize, papers } from '../core/layout/pageGeometry';
import { readProjectFile, selectProject } from './projects';
import { documentText } from './verticalLayout';
import { mediaHtml } from './webview';

type FieldValues = Record<string, unknown>;

async function saveMetadata(uri: vscode.Uri, original: string | undefined, updated: string): Promise<void> {
	const conflict = () => new Error(`${uri.fsPath}: ファイルが更新されたか、未保存の編集があります。ファイルを保存してから設定画面で再読み込みしてください。`);
	const edit = new vscode.WorkspaceEdit();
	if (await readProjectFile(uri, true) !== original) {
		throw conflict();
	}
	if (original === undefined) {
		edit.createFile(uri, { contents: new TextEncoder().encode(updated), overwrite: false });
		if (!await vscode.workspace.applyEdit(edit)) {
			throw conflict();
		}
		return;
	}

	const document = await vscode.workspace.openTextDocument(uri);
	if (document.isDirty || documentText(document) !== original.replace(/\r\n/gu, '\n')) {
		throw conflict();
	}
	if (documentText(document) !== updated) {
		const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
		edit.replace(uri, range, updated);
		if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
			throw new Error(`${uri.fsPath}: 保存できませんでした。VS Codeの通知を確認してください。`);
		}
	}
}

function configuredValue(value: unknown) {
	return typeof value === 'string' ? value : '';
}

function dimension(value: unknown, label: string): number {
	if (typeof value !== 'string' || !/^[0-9]+$/u.test(value) || Number(value) < 10 || Number(value) > 40) {
		throw new Error(`${label}は10〜40の半角整数で入力してください。`);
	}
	return Number(value);
}

export class ProjectEditor implements vscode.Disposable {
	private readonly panels = new Map<string, vscode.WebviewPanel>();
	private readonly media: vscode.Uri;

	constructor(extensionUri: vscode.Uri) {
		this.media = vscode.Uri.joinPath(extensionUri, 'media');
	}

	async open(screenplay: vscode.Uri | undefined): Promise<void> {
		const folder = await selectProject(screenplay, true);
		if (!folder) {
			return;
		}
		const key = folder.toString();
		const path = folder.fsPath;
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal();
			return;
		}
		const project = vscode.Uri.joinPath(folder, 'project.json');
		const cast = vscode.Uri.joinPath(folder, 'characters.json');
		const panel = vscode.window.createWebviewPanel('tate-script.projectSettings', '作品設定', vscode.ViewColumn.Beside, {
			enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.media],
		});
		this.panels.set(key, panel);
		const { webview } = panel;
		const state: { project?: string; cast?: string; ready?: boolean } = {};
		let closed = false;
		let operations = Promise.resolve();
		const send = (message: object) => closed ? Promise.resolve(false) : webview.postMessage(message);
		const messages = webview.onDidReceiveMessage(message => {
			operations = operations.then(async () => {
				if (closed) {
					return;
				}
				if (message?.type === 'ready' || message?.type === 'reload') {
					await load();
				} else if (message?.type === 'openProject' || message?.type === 'openCast') {
					await vscode.window.showTextDocument(message.type === 'openProject' ? project : cast);
				} else if (state.ready && message?.type === 'saveProject') {
					await saveProject(message.values);
				} else if (state.ready && message?.type === 'saveCast') {
					await saveCast(message.values);
				}
			}).catch(async error => {
				await send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
			});
		});
		panel.onDidDispose(() => {
			closed = true;
			this.panels.delete(key);
			messages.dispose();
		});

		function projectValue(original: string | undefined) {
			return original === undefined ? { schemaVersion: 1, page: defaultPageSettings } : JSON.parse(original);
		}
		function castValue(original: string | undefined) {
			return original?.trim() ? JSON.parse(original) : { characters: [] };
		}
		async function load() {
			state.ready = false;
			const [projectText, castText] = await Promise.all([readProjectFile(project, true), readProjectFile(cast, true)]);
			const page = projectText === undefined
				? defaultPageSettings
				: parseProjectSettings(projectText, project.fsPath).page;
			const values = projectValue(projectText);
			const characters = parseCharacters(castText ?? '', cast.fsPath);
			state.project = projectText;
			state.cast = castText;
			state.ready = true;
			await send({
				type: 'loaded', path, title: configuredValue(values.title), author: configuredValue(values.author),
				page, characters,
			});
		}
		async function saveProject(values: FieldValues) {
			const charactersPerLine = dimension(values.charactersPerLine, '1行の字数');
			const linesPerPage = dimension(values.linesPerPage, '1ページの行数');
			const { paperSize } = values;
			if (!isPaperSize(paperSize)) {
				throw new Error('用紙サイズはA4またはB5を選択してください。');
			}
			const original = projectValue(state.project);
			const updated = {
				...original, title: configuredValue(values.title), author: configuredValue(values.author),
				page: { ...original.page, charactersPerLine, linesPerPage, paperSize },
			};
			const text = JSON.stringify(updated, null, 2) + '\n';
			parseProjectSettings(text, project.fsPath);
			await saveMetadata(project, state.project, text);
			state.project = await readProjectFile(project);
			await send({ type: 'saved', message: '作品・ページ設定を保存しました。' });
		}
		async function saveCast(values: { index?: number; name: unknown; description: unknown }[]) {
			const original = castValue(state.cast);
			const updated = {
				...original,
				characters: values.map(({ index, name, description }) => ({
					...(Number.isInteger(index) ? original.characters[index!] : undefined),
					name, description: description === '' ? undefined : description,
				})),
			};
			const text = JSON.stringify(updated, null, 2) + '\n';
			const characters = parseCharacters(text, cast.fsPath);
			await saveMetadata(cast, state.cast, text);
			state.cast = await readProjectFile(cast);
			await send({ type: 'saved', message: '登場人物を保存しました。', characters });
		}

		webview.html = mediaHtml(webview, this.media, '作品設定', `
<main>
	<header>
		<h1>作品設定</h1>
		<p id="project-path"></p>
		<div class="actions">
			<button type="button" data-action="reload">再読み込み</button>
			<button type="button" data-action="openProject">project.json を開く</button>
			<button type="button" data-action="openCast">characters.json を開く</button>
		</div>
	</header>
	<p id="status" role="status"></p>
	<form id="project">
		<fieldset disabled>
			<legend>作品・ページ</legend>
			<label>作品名<input name="title" placeholder="空欄の場合は原稿ファイル名"></label>
			<label>作者名<input name="author"></label>
			<div class="dimensions">
				<label>用紙サイズ<select name="paperSize">${Object.keys(papers).map(size => `<option>${size}</option>`).join('')}</select></label>
				<label>1行の字数<input name="charactersPerLine" inputmode="numeric" required></label>
				<label>1ページの行数<input name="linesPerPage" inputmode="numeric" required></label>
			</div>
			<button>作品・ページ設定を保存</button>
		</fieldset>
	</form>
	<form id="cast">
		<fieldset disabled>
			<legend>登場人物</legend>
			<div id="characters"></div>
			<div class="actions">
				<button type="button" id="add">登場人物を追加</button>
				<button>登場人物を保存</button>
			</div>
		</fieldset>
	</form>
</main>`, ['projectEditor.css'], ['projectEditor.js']);
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
	}
}

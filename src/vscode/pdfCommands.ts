import * as vscode from 'vscode';
import { link, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderPdf } from '../core/pdf/render';
import { readSavedProject, selectProject } from './projects';

async function fileState(path: string) {
	try {
		return await stat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
		return undefined;
	}
}

export class PdfCommands implements vscode.Disposable {
	private readonly panels = new Set<vscode.WebviewPanel>();
	private readonly writes = new Map<string, Promise<void>>();
	private readonly temporaryFolders = new Set<string>();
	private readonly stagedFiles = new Set<string>();

	constructor(private readonly extensionUri: vscode.Uri) {}

	private async saveDialog(folder: vscode.Uri): Promise<string | undefined> {
		const uri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.joinPath(folder, 'screenplay.pdf'),
			filters: { PDF: ['pdf'] },
		});
		if (!uri) {
			return undefined;
		}
		if (uri.scheme !== 'file') {
			throw new Error('PDFの保存先にはローカルファイルを指定してください。');
		}
		return /\.pdf$/iu.test(uri.fsPath) ? uri.fsPath : `${uri.fsPath}.pdf`;
	}

	private async save(bytes: Buffer, destination: string): Promise<void> {
		const key = process.platform === 'win32' ? destination.toLowerCase() : destination;
		const task = (this.writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
			const existing = await fileState(destination);
			if (existing && (!existing.isFile() || !await vscode.window.showWarningMessage(
				`既存のPDFを置き換えますか？\n${destination}`, { modal: true }, '上書き',
			))) {
				if (!existing.isFile()) {
					throw new Error(`${destination}: 保存先に通常のファイルを指定してください。`);
				}
				return;
			}

			const staged = join(dirname(destination), `.tate-script-${randomUUID()}.tmp`);
			try {
				await writeFile(staged, bytes, { flag: 'wx' });
				if (existing) {
					const current = await fileState(destination);
					if (!current || current.ino !== existing.ino || current.size !== existing.size ||
						current.mtimeMs !== existing.mtimeMs || current.ctimeMs !== existing.ctimeMs) {
						throw new Error('保存先が変更されました。もう一度保存してください。');
					}
					await rename(staged, destination);
				} else {
					await link(staged, destination);
				}
			} catch (error) {
				throw new Error(`${destination}: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				await this.cleanStaged(staged);
			}
			void vscode.window.showInformationMessage(`PDFを保存しました。 ${destination}`);
		});
		this.writes.set(key, task);
		try {
			await task;
		} finally {
			if (this.writes.get(key) === task) {
				this.writes.delete(key);
			}
		}
	}

	async run(preview: boolean, screenplay: vscode.Uri | undefined): Promise<void> {
		try {
			const folder = await selectProject(screenplay);
			if (!folder) {
				return;
			}
			const project = await readSavedProject(folder);
			const destination = preview ? undefined : await this.saveDialog(folder);
			if (!preview && !destination) {
				return;
			}
			const result = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification, title: 'Tate Script: PDFを生成中',
			}, () => renderPdf(project));
			const warning = result.overflowPages.length ?
				`本文 ${result.overflowPages.join('、')} ページで文字が見切れる可能性があります。` : undefined;
			if (warning) {
				void vscode.window.showWarningMessage(warning);
			}
			if (destination) {
				await this.save(result.bytes, destination);
			} else {
				await this.openPreview(folder, result.bytes, warning);
			}
		} catch (error) {
			this.showError(error);
		}
	}

	private async clean(directory: string): Promise<void> {
		try {
			await rm(directory, { recursive: true, force: true, maxRetries: 3 });
			this.temporaryFolders.delete(directory);
		} catch {
			// Keep failed removals for a later attempt when the extension shuts down.
		}
	}

	private async cleanStaged(file: string): Promise<void> {
		try {
			await rm(file, { force: true });
			this.stagedFiles.delete(file);
		} catch {
			this.stagedFiles.add(file);
		}
	}

	private async openPreview(folder: vscode.Uri, bytes: Buffer, warning: string | undefined): Promise<void> {
		const directory = await mkdtemp(join(tmpdir(), 'tate-script-pdf-'));
		this.temporaryFolders.add(directory);
		try {
			const pdf = vscode.Uri.file(join(directory, 'preview.pdf'));
			await writeFile(pdf.fsPath, bytes);
			const media = vscode.Uri.joinPath(this.extensionUri, 'media');
			const pdfjs = vscode.Uri.joinPath(this.extensionUri, 'dist', 'pdfjs');
			const panel = vscode.window.createWebviewPanel('tate-script.pdfPreview', 'PDFプレビュー', vscode.ViewColumn.Beside, {
				enableScripts: true, localResourceRoots: [media, pdfjs, vscode.Uri.file(directory)],
			});
			this.panels.add(panel);
			let saving: Promise<void> | undefined;
			const messages = panel.webview.onDidReceiveMessage(message => {
				if (message?.type !== 'save' || saving) {
					return;
				}
				saving = (async () => {
					const destination = await this.saveDialog(folder);
					if (destination) {
						await this.save(bytes, destination);
					}
				})().catch(error => this.showError(error)).finally(() => { saving = undefined; });
			});
			panel.onDidDispose(() => {
				messages.dispose();
				this.panels.delete(panel);
				void this.clean(directory);
			});
			const local = (uri: vscode.Uri) => panel.webview.asWebviewUri(uri);
			panel.webview.html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource}; connect-src ${panel.webview.cspSource}; worker-src blob: ${panel.webview.cspSource}; font-src blob: data:">
<link rel="stylesheet" href="${local(vscode.Uri.joinPath(media, 'pdfPreview.css'))}"><title>PDFプレビュー</title>
</head><body data-pdf="${local(pdf)}" data-worker="${local(vscode.Uri.joinPath(pdfjs, 'pdf.worker.mjs'))}">
<header><button type="button" disabled>PDFを保存</button><span id="status" role="status">PDFを読み込み中…</span>${warning ? `<p>${warning}</p>` : ''}</header>
<main aria-label="PDFページ"></main><script src="${local(vscode.Uri.joinPath(pdfjs, 'viewer.js'))}"></script></body></html>`;
		} catch (error) {
			await this.clean(directory);
			throw error;
		}
	}

	private showError(error: unknown): void {
		void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
	}

	dispose(): void {
		for (const panel of this.panels) {
			panel.dispose();
		}
	}

	async shutdown(): Promise<void> {
		this.dispose();
		await Promise.all([
			...Array.from(this.temporaryFolders, directory => this.clean(directory)),
			...Array.from(this.stagedFiles, file => this.cleanStaged(file)),
		]);
	}
}

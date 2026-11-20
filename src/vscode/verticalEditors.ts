import * as vscode from 'vscode';
import { isScreenplay } from './projects';
import { documentText, verticalLayout } from './verticalLayout';
import { mediaHtml } from './webview';

export const verticalEditorType = 'tate-script.verticalEditor';

function positionAt(document: vscode.TextDocument, text: string, offset: number): vscode.Position {
	const extra = document.eol === vscode.EndOfLine.CRLF ? text.slice(0, offset).split('\n').length - 1 : 0;
	return document.positionAt(offset + extra);
}

export class VerticalEditors implements vscode.CustomTextEditorProvider {
	private readonly media: vscode.Uri;
	private readonly panels = new Map<vscode.WebviewPanel, vscode.Uri>();
	private readonly operations = new WeakMap<vscode.TextDocument, Promise<void>>();

	constructor(extensionUri: vscode.Uri) {
		this.media = vscode.Uri.joinPath(extensionUri, 'media');
	}

	activePanel() {
		return [...this.panels].find(([panel]) => panel.active);
	}

	resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
		if (!isScreenplay(document.uri)) {
			panel.webview.html = '<p>screenplay.txt を開いてください。</p>';
			return;
		}
		const { webview } = panel;
		this.panels.set(panel, document.uri);
		webview.options = { enableScripts: true, localResourceRoots: [this.media] };
		const layout = verticalLayout(document, webview, true);
		const state = () => ({ text: documentText(document), version: document.version });
		const sync = () => webview.postMessage({ type: 'document', ...state() });
		const changes = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === document && event.contentChanges.length) {
				void sync();
			}
		});
		let disposed = false;
		const messages = webview.onDidReceiveMessage(message => {
			if (message?.type === 'ready') {
				void sync();
				layout.start();
				return;
			}
			const operation = (this.operations.get(document) ?? Promise.resolve()).then(async () => {
				if (disposed) {
					return;
				}
				if (message?.type === 'edit') {
					const { start, end, insert, version, id } = message;
					const before = state();
					let accepted = false;
					if (before.version === version && Number.isInteger(start) && Number.isInteger(end) &&
						start >= 0 && end >= start && end <= before.text.length && typeof insert === 'string') {
						try {
							const edit = new vscode.WorkspaceEdit();
							edit.replace(document.uri, new vscode.Range(
								positionAt(document, before.text, start), positionAt(document, before.text, end),
							), insert);
							accepted = await vscode.workspace.applyEdit(edit);
						} catch {
							// The authoritative text is returned so the draft can be recovered.
						}
					}
					await webview.postMessage({ type: 'editResult', id, accepted, ...state() });
				} else if (message?.type === 'save') {
					const saved = await document.save();
					await webview.postMessage({ type: 'status', message: saved ? '原稿を保存しました。' : '保存できませんでした。VS Codeの通知を確認してください。' });
				} else if ((message?.type === 'undo' || message?.type === 'redo') && panel.active) {
					await vscode.commands.executeCommand(message.type);
				} else if (message?.type === 'copy' || message?.type === 'cut') {
					if (typeof message.text === 'string' && message.text) {
						await vscode.env.clipboard.writeText(message.text);
						if (message.type === 'cut') {
							await webview.postMessage({ type: 'clipboardEdit', id: message.id, text: '' });
						}
					}
				} else if (message?.type === 'paste') {
					await webview.postMessage({ type: 'clipboardEdit', id: message.id, text: await vscode.env.clipboard.readText() });
				}
			}).catch(error => {
				void vscode.window.showErrorMessage(String(error));
			});
			this.operations.set(document, operation);
		});
		panel.onDidDispose(() => {
			disposed = true;
			this.panels.delete(panel);
			layout.dispose();
			changes.dispose();
			messages.dispose();
		});
		webview.html = mediaHtml(webview, this.media, '縦書きエディタ', `
	<header class="editor-toolbar">
		<button type="button" data-action="save">保存</button>
		<button type="button" data-action="undo">元に戻す</button>
		<button type="button" data-action="redo">やり直す</button>
		<button type="button" data-action="pageBreak">手動改ページ</button>
		<span id="command-status" role="status"></span>
	</header>
	<p id="status" role="status" hidden></p>
	<div id="recovery" hidden>
		<label for="draft">原稿が更新されました。反映できなかった入力を確認し、必要な箇所に貼り付けてください。</label>
		<textarea id="draft" readonly></textarea>
		<button type="button" id="dismiss">閉じる</button>
	</div>
	<main aria-label="脚本の縦書き編集"></main>
	<textarea id="typing" aria-label="原稿本文" spellcheck="false" disabled></textarea>
	<div id="caret" aria-hidden="true" hidden></div>
	<div id="composition" aria-hidden="true" hidden></div>`,
		['preview.css', 'verticalEditor.css'], ['pageView.js', 'verticalEditor.js']);
	}
}

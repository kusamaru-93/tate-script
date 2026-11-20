import * as vscode from 'vscode';
import { verticalLayout } from './verticalLayout';
import { mediaHtml } from './webview';

export class VerticalPreviews implements vscode.Disposable {
	private readonly panels = new Map<string, vscode.WebviewPanel>();
	private readonly media: vscode.Uri;

	constructor(extensionUri: vscode.Uri) {
		this.media = vscode.Uri.joinPath(extensionUri, 'media');
	}

	activeScreenplay(): vscode.Uri | undefined {
		for (const [uri, panel] of this.panels) {
			if (panel.active) {
				return vscode.Uri.parse(uri);
			}
		}
		return undefined;
	}

	open(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal(existing.viewColumn, true);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'tate-script.verticalPreview', '縦書きプレビュー',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: true, localResourceRoots: [this.media] },
		);
		this.panels.set(key, panel);
		const layout = verticalLayout(document, panel.webview);
		const closed = vscode.workspace.onDidCloseTextDocument(closedDocument => {
			if (closedDocument === document) {
				panel.dispose();
			}
		});
		const messages = panel.webview.onDidReceiveMessage(message => {
			if (message?.type === 'ready') {
				layout.start();
			}
		});
		panel.onDidDispose(() => {
			layout.dispose();
			closed.dispose();
			messages.dispose();
			this.panels.delete(key);
		});

		panel.webview.html = mediaHtml(panel.webview, this.media, '縦書きプレビュー',
			'<p id="status" role="status" hidden></p><main aria-label="脚本の縦書きプレビュー"></main>',
			['preview.css'], ['pageView.js', 'preview.js']);
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
	}
}

import * as vscode from 'vscode';
import { VerticalPreviews } from './vscode/verticalPreviews';
import { PdfCommands } from './vscode/pdfCommands';
import { isScreenplay } from './vscode/projects';
import { pageBreak } from './core/parser/screenplay';
import { VerticalEditors, verticalEditorType } from './vscode/verticalEditors';
import { ProjectEditor } from './vscode/projectEditor';
import { newProject } from './vscode/newProject';

let pdfCommands: PdfCommands | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const previews = new VerticalPreviews(context.extensionUri);
	const editors = new VerticalEditors(context.extensionUri);
	const settings = new ProjectEditor(context.extensionUri);
	const pdf = new PdfCommands(context.extensionUri);
	pdfCommands = pdf;
	const activeScreenplay = () => editors.activePanel()?.[1] ?? previews.activeScreenplay() ?? vscode.window.activeTextEditor?.document.uri;
	context.subscriptions.push(
		vscode.commands.registerCommand('tate-script.newProject', newProject),
		previews,
		settings,
		pdf,
		vscode.window.registerCustomEditorProvider(verticalEditorType, editors, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: true,
		}),
		vscode.commands.registerCommand('tate-script.openVerticalEditor', async () => {
			const uri = activeScreenplay();
			if (!uri || uri.scheme === 'untitled' || !isScreenplay(uri)) {
				void vscode.window.showInformationMessage('原稿ファイル screenplay.txt を開いてください。');
				return;
			}
			await vscode.commands.executeCommand('vscode.openWith', uri, verticalEditorType, vscode.ViewColumn.Beside);
		}),
		vscode.commands.registerCommand('tate-script.openProjectSettings', async () => {
			try {
				const uri = activeScreenplay();
				await settings.open(uri?.scheme === 'untitled' ? undefined : uri);
			} catch (error) {
				void vscode.window.showErrorMessage(String(error));
			}
		}),
		vscode.commands.registerCommand('tate-script.previewPdf', () => pdf.run(true, activeScreenplay())),
		vscode.commands.registerCommand('tate-script.exportPdf', () => pdf.run(false, activeScreenplay())),
		vscode.commands.registerCommand('tate-script.insertPageBreak', async () => {
			const vertical = editors.activePanel()?.[0];
			if (vertical) {
				await vertical.webview.postMessage({ type: 'pageBreak' });
				return;
			}
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.isUntitled || !isScreenplay(editor.document.uri)) {
				void vscode.window.showInformationMessage('原稿ファイル screenplay.txt を開いてください。');
				return;
			}
			const newline = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			await editor.edit(edit => edit.insert(new vscode.Position(editor.selection.active.line, 0), pageBreak + newline));
		}),
		vscode.commands.registerCommand('tate-script.openVerticalPreview', () => {
			const document = vscode.window.activeTextEditor?.document;
			if (!document || document.isUntitled || !isScreenplay(document.uri)) {
				void vscode.window.showInformationMessage('原稿ファイル screenplay.txt を開いてください。');
				return;
			}
			previews.open(document);
		}),
	);
}

export async function deactivate(): Promise<void> {
	await pdfCommands?.shutdown();
	pdfCommands = undefined;
}

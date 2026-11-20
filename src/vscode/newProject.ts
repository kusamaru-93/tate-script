import * as vscode from 'vscode';
import { mkdir, open, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPageSettings } from '../core/project/settings';
import { verticalEditorType } from './verticalEditors';

export async function createProjectFiles(parent: vscode.Uri, title: string): Promise<vscode.Uri> {
	if (parent.scheme !== 'file') {
		throw new Error('保存先にはローカルフォルダーを選択してください。');
	}
	let folderName = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').replace(/[. ]+$/gu, '') || '作品';
	if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(folderName)) {
		folderName = '_' + folderName;
	}
	const folder = vscode.Uri.file(join(parent.fsPath, folderName));
	try {
		await mkdir(folder.fsPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new Error(`${folder.fsPath}: 同名のファイルまたはフォルダーがあります。別の保存先または作品名を指定してください。`);
		}
		throw error;
	}

	const files = [
		['screenplay.txt', ''],
		['project.json', JSON.stringify({ schemaVersion: 1, title: title.trim(), page: defaultPageSettings }, null, 2) + '\n'],
		['characters.json', JSON.stringify({ characters: [] }, null, 2) + '\n'],
	];
	const created: string[] = [];
	try {
		for (const [name, text] of files) {
			const file = join(folder.fsPath, name);
			const handle = await open(file, 'wx');
			created.push(file);
			try {
				await handle.writeFile(text, { encoding: 'utf8' });
			} finally {
				await handle.close();
			}
		}
	} catch (error) {
		await Promise.allSettled(created.map(file => unlink(file)));
		await rmdir(folder.fsPath).catch(() => {});
		throw new Error(`${folder.fsPath}: 作品ファイルを作成できませんでした。保存先を確認してください。`, { cause: error });
	}
	return vscode.Uri.joinPath(folder, 'screenplay.txt');
}

export async function newProject(): Promise<void> {
	try {
		const folders = await vscode.window.showOpenDialog({
			title: '作品フォルダーの保存先を選択', openLabel: 'ここに作品を作成',
			canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
			defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
		});
		if (!folders?.length) {
			return;
		}
		const title = await vscode.window.showInputBox({
			title: '新しい作品を作成', prompt: '作品名を入力してください。保存先に作品用のフォルダーを作成します。',
			placeHolder: '例：作品名', ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : '作品名を入力してください。',
		});
		if (!title?.trim()) {
			return;
		}
		const screenplay = await createProjectFiles(folders[0], title);
		await vscode.commands.executeCommand('vscode.openWith', screenplay, verticalEditorType);
	} catch (error) {
		void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
	}
}

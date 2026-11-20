import * as vscode from 'vscode';
import { parseCharacters, parseProjectSettings, readProjectTitle } from '../core/project/settings';
import type { SavedProject } from '../core/pdf/render';

export const isScreenplay = (uri: vscode.Uri) => uri.path.split('/').at(-1)?.toLowerCase() === 'screenplay.txt';

export const projectFolder = (uri: vscode.Uri) => vscode.Uri.joinPath(uri, '..');

export async function readProjectFile(uri: vscode.Uri, optional = false): Promise<string | undefined> {
	try {
		const data = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder('utf-8', { fatal: true }).decode(data);
	} catch (error) {
		if (optional && error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return undefined;
		}
		throw new Error(`${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function readSavedProject(folder: vscode.Uri): Promise<SavedProject> {
	const screenplay = vscode.Uri.joinPath(folder, 'screenplay.txt');
	const project = vscode.Uri.joinPath(folder, 'project.json');
	const cast = vscode.Uri.joinPath(folder, 'characters.json');
	const [source, settings, characters] = await Promise.all([
		readProjectFile(screenplay),
		readProjectFile(project),
		readProjectFile(cast, true),
	]);
	return {
		source: source!,
		settings: parseProjectSettings(settings!, project.fsPath),
		characters: parseCharacters(characters ?? '', cast.fsPath),
	};
}

async function isProject(folder: vscode.Uri): Promise<boolean> {
	try {
		const settings = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, 'project.json'));
		return Boolean(settings.type & vscode.FileType.File);
	} catch (error) {
		// A path that exists but cannot be read is still a candidate.
		return !(error instanceof vscode.FileSystemError && error.code === 'FileNotFound');
	}
}

export async function selectProject(screenplay: vscode.Uri | undefined, allowNewSettings = false): Promise<vscode.Uri | undefined> {
	if (screenplay && isScreenplay(screenplay)) {
		const folder = projectFolder(screenplay);
		if (allowNewSettings || await isProject(folder)) {
			return folder;
		}
	}
	const folders = new Map<string, vscode.Uri>();
	for (const uri of await vscode.workspace.findFiles('**/screenplay.txt')) {
		const folder = projectFolder(uri);
		const key = process.platform === 'win32' && folder.scheme === 'file' ? folder.fsPath.toLowerCase() : folder.toString();
		folders.set(key, folder);
	}
	const candidates = (await Promise.all([...folders.values()].map(async folder => await isProject(folder) ? folder : undefined)))
		.filter(folder => folder !== undefined);
	if (candidates.length === 0) {
		void vscode.window.showInformationMessage('project.json と screenplay.txt がある作品フォルダーを開いてください。');
		return undefined;
	}
	if (candidates.length === 1) {
		return candidates[0];
	}
	const items = await Promise.all(candidates.map(async folder => {
		const settings = vscode.Uri.joinPath(folder, 'project.json');
		let label: string;
		try {
			label = readProjectTitle((await readProjectFile(settings))!, settings.fsPath);
		} catch {
			label = folder.path.split('/').at(-1) || folder.fsPath;
		}
		return { label, description: vscode.workspace.getWorkspaceFolder(folder)?.name, detail: folder.fsPath, folder };
	}));
	items.sort((left, right) => left.label.localeCompare(right.label, 'ja') || left.detail.localeCompare(right.detail));
	return (await vscode.window.showQuickPick(items, {
		placeHolder: 'PDFの対象作品を選択', matchOnDescription: true, matchOnDetail: true,
	}))?.folder;
}

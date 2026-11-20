import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { createProjectFiles } from '../vscode/newProject';
import { readSavedProject } from '../vscode/projects';

suite('New project', () => {
	let parent: string;
	const openDialog = vscode.window.showOpenDialog;
	const inputBox = vscode.window.showInputBox;
	const errorMessage = vscode.window.showErrorMessage;

	setup(async () => {
		parent = vscode.Uri.file(await mkdtemp(join(tmpdir(), 'tate-script-new-project-'))).fsPath;
	});

	teardown(async () => {
		vscode.window.showOpenDialog = openDialog;
		vscode.window.showInputBox = inputBox;
		vscode.window.showErrorMessage = errorMessage;
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await rm(parent, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
	});

	test('creates a usable project and opens its empty screenplay in the vertical editor', async () => {
		vscode.window.showOpenDialog = async () => [vscode.Uri.file(parent)];
		vscode.window.showInputBox = async () => '夏の終わり';
		const errors: string[] = [];
		vscode.window.showErrorMessage = async (message: string) => { errors.push(message); return undefined; };
		await vscode.commands.executeCommand('tate-script.newProject');
		assert.deepEqual(errors, []);
		const folder = vscode.Uri.file(join(parent, '夏の終わり'));
		assert.deepEqual((await readdir(folder.fsPath)).sort(), ['characters.json', 'project.json', 'screenplay.txt']);
		const project = await readSavedProject(folder);
		assert.equal(project.source, '');
		assert.equal(project.settings.title, '夏の終わり');
		assert.deepEqual(project.settings.page, { paperSize: 'A4', charactersPerLine: 20, linesPerPage: 20 });
		assert.deepEqual(project.characters, []);
		assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab =>
			tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'tate-script.verticalEditor' &&
			tab.input.uri.fsPath === join(folder.fsPath, 'screenplay.txt')));
	});

	test('cancelling either prompt creates no files', async () => {
		vscode.window.showOpenDialog = async () => undefined;
		vscode.window.showInputBox = async () => { assert.fail('Unexpected title prompt'); };
		await vscode.commands.executeCommand('tate-script.newProject');
		vscode.window.showOpenDialog = async () => [vscode.Uri.file(parent)];
		vscode.window.showInputBox = async () => undefined;
		await vscode.commands.executeCommand('tate-script.newProject');
		assert.deepEqual(await readdir(parent), []);
	});

	test('preserves the title while making a safe directory name and keeps existing work on retry', async () => {
		const uri = await createProjectFiles(vscode.Uri.file(parent), '../夏:終わり?');
		assert.equal(dirname(dirname(uri.fsPath)), parent);
		const folder = vscode.Uri.file(dirname(uri.fsPath));
		assert.equal((await readSavedProject(folder)).settings.title, '../夏:終わり?');
		await writeFile(uri.fsPath, '執筆中の原稿');
		await assert.rejects(createProjectFiles(vscode.Uri.file(parent), '../夏:終わり?'), /同名/u);
		assert.equal(await readFile(uri.fsPath, 'utf8'), '執筆中の原稿');
		const reserved = await createProjectFiles(vscode.Uri.file(parent), 'CON');
		assert.equal(dirname(reserved.fsPath), join(parent, '_CON'));
	});

	test('concurrent creation of the same work keeps one complete project', async () => {
		const attempts = await Promise.allSettled([
			createProjectFiles(vscode.Uri.file(parent), '同じ作品'),
			createProjectFiles(vscode.Uri.file(parent), '同じ作品'),
		]);
		assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
		assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
		assert.equal((await readSavedProject(vscode.Uri.file(join(parent, '同じ作品')))).source, '');
	});
});

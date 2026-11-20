import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

suite('Vertical preview', () => {
	test('opens one preview per screenplay and leaves Git with only the authored change', async () => {
		const folder = await mkdtemp(join(tmpdir(), 'tate-script-test-'));
		const file = join(folder, 'screenplay.txt');
		const source = '○公園\n美咲「おはよう」\n〇駅\n';
		const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
			cwd: folder,
			encoding: 'utf8',
		});
		const previewTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
			.filter(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('tate-script.verticalPreview'));
		try {
			git('init');
			await writeFile(file, source, 'utf8');
			git('add', 'screenplay.txt');
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const editor = await vscode.window.showTextDocument(document);
			await vscode.commands.executeCommand('tate-script.openVerticalPreview');
			assert.equal(previewTabs().length, 1);
			await vscode.commands.executeCommand('tate-script.openVerticalPreview');
			assert.equal(previewTabs().length, 1);
			assert.ok(await editor.edit(edit => edit.insert(new vscode.Position(1, 0), '空を見上げる。\n')));
			assert.equal(await readFile(file, 'utf8'), source);
			assert.ok(await document.save());
			assert.equal(await readFile(file, 'utf8'), source.replace('美咲', '空を見上げる。\n美咲'));
			const diff = git('diff', '--numstat', '--', 'screenplay.txt');
			assert.match(diff, /^1\t0\tscreenplay\.txt/m);
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await rm(folder, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
		}
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('inserts a manual page break before the selected line without changing other lines', async () => {
		const folder = await mkdtemp(join(tmpdir(), 'tate-script-test-'));
		const file = join(folder, 'screenplay.txt');
		try {
			await writeFile(file, '○公園\r\n〇駅\r\n', 'utf8');
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const editor = await vscode.window.showTextDocument(document);
			editor.selection = new vscode.Selection(1, 1, 1, 1);
			await vscode.commands.executeCommand('tate-script.insertPageBreak');
			assert.equal(document.getText(), '○公園\r\n\f\r\n〇駅\r\n');
			assert.ok(await document.save());
			assert.equal(await readFile(file, 'utf8'), document.getText());
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await rm(folder, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
		}
	});

	test('opens a vertical custom editor on the same screenplay as the text editor', async () => {
		const folder = await mkdtemp(join(tmpdir(), 'tate-script-test-'));
		const file = join(folder, 'screenplay.txt');
		try {
			await writeFile(file, '○公園\r\n美咲「こんにちは」\r\n', 'utf8');
			const uri = vscode.Uri.file(file);
			const document = await vscode.workspace.openTextDocument(uri);
			const horizontal = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
			await vscode.commands.executeCommand('tate-script.openVerticalEditor');

			const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
			assert.ok(tabs.some(tab => tab.input instanceof vscode.TabInputCustom &&
				tab.input.viewType === 'tate-script.verticalEditor' && tab.input.uri.toString() === uri.toString()));
			assert.ok(tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()));
			assert.ok(await horizontal.edit(edit => edit.insert(new vscode.Position(1, 0), '立ち止まる。\n')));
			assert.strictEqual(await vscode.workspace.openTextDocument(uri), document);
			assert.ok(await document.save());
			assert.equal(await readFile(file, 'utf8'), '○公園\r\n立ち止まる。\r\n美咲「こんにちは」\r\n');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await rm(folder, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
		}
	});
});

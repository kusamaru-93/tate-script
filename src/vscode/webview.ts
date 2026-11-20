import * as vscode from 'vscode';

export function mediaHtml(webview: vscode.Webview, media: vscode.Uri, title: string, body: string, styles: string[], scripts: string[]): string {
	const resource = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, file));
	return `<!doctype html>
<html lang="ja"><head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource}">
	<title>${title}</title>
	${styles.map(file => `<link rel="stylesheet" href="${resource(file)}">`).join('\n')}
</head><body>
${body}
${scripts.map(file => `<script src="${resource(file)}"></script>`).join('\n')}
</body></html>`;
}

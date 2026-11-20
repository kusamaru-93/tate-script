(() => {
	const vscode = acquireVsCodeApi();
	const preview = document.querySelector('main');
	const status = document.querySelector('#status');
	let generation = -1;

	window.addEventListener('message', ({ data }) => {
		if (data?.type !== 'layout' || data.generation < generation) {
			return;
		}
		generation = data.generation;
		status.textContent = data.settingsError ?? '';
		status.hidden = !status.textContent;
		window.renderScreenplayPages(preview, data);
	});

	vscode.postMessage({ type: 'ready' });
})();

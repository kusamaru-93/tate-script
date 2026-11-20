(() => {
	const vscode = acquireVsCodeApi();
	const status = document.querySelector('#status');
	const project = document.querySelector('#project');
	const cast = document.querySelector('#cast');
	const rows = document.querySelector('#characters');
	let ready = false;

	function busy(isBusy) {
		for (const fields of document.querySelectorAll('fieldset')) {
			fields.disabled = isBusy || !ready;
		}
	}

	function addCharacter(character = {}, index) {
		const row = document.createElement('div');
		row.className = 'character';
		if (index !== undefined) {
			row.dataset.index = index;
		}
		const name = document.createElement('input');
		name.name = 'name';
		name.value = character.name ?? '';
		name.required = true;
		const description = document.createElement('textarea');
		description.name = 'description';
		description.value = character.description ?? '';
		description.rows = 2;
		for (const [text, field] of [['名前', name], ['説明', description]]) {
			const label = document.createElement('label');
			label.append(text, field);
			row.append(label);
		}
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.textContent = '削除';
		remove.addEventListener('click', () => row.remove());
		row.append(remove);
		rows.append(row);
		return name;
	}

	function showCharacters(characters) {
		rows.replaceChildren();
		characters.forEach((character, index) => addCharacter(character, index));
	}
	function request(type, values) {
		status.textContent = '';
		busy(true);
		vscode.postMessage({ type, values });
	}

	project.addEventListener('submit', event => {
		event.preventDefault();
		request('saveProject', Object.fromEntries(new FormData(project)));
	});
	cast.addEventListener('submit', event => {
		event.preventDefault();
		request('saveCast', [...rows.children].map(row => ({
			index: row.dataset.index === undefined ? undefined : Number(row.dataset.index),
			name: row.querySelector('input').value,
			description: row.querySelector('textarea').value,
		})));
	});
	document.querySelector('#add').addEventListener('click', () => addCharacter().focus());
	document.querySelector('header').addEventListener('click', event => {
		const action = event.target.dataset.action;
		if (action === 'reload') {
			ready = false;
			request(action);
		} else if (action) {
			vscode.postMessage({ type: action });
		}
	});
	window.addEventListener('message', ({ data }) => {
		if (data?.type === 'loaded') {
			document.querySelector('#project-path').textContent = data.path;
			for (const [key, value] of Object.entries({ title: data.title, author: data.author, ...data.page })) {
				project.elements.namedItem(key).value = value;
			}
			showCharacters(data.characters);
			ready = true;
		} else if (data?.type === 'saved' || data?.type === 'error') {
			status.textContent = data.message;
			if (data.characters) {
				showCharacters(data.characters);
			}
		}
		busy(false);
	});
	request('ready');
})();

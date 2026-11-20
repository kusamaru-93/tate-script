(() => {
	const vscode = acquireVsCodeApi();
	const paper = document.querySelector('main');
	const input = document.querySelector('#typing');
	const caret = document.querySelector('#caret');
	const composition = document.querySelector('#composition');
	const draft = document.querySelector('#draft');
	const recovery = document.querySelector('#recovery');
	const settingsStatus = document.querySelector('#status');
	const commandStatus = document.querySelector('#command-status');
	const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });
	let source = '';
	let version = -1;
	let layoutText = '';
	let generation = -1;
	let pages = [];
	let columns = [];
	let flight;
	let nextId = 0;
	let deferredDocument;
	let deferredLayout;
	let composing = false;
	let compositionVersion;
	let dragAnchor;
	let paintedRange;
	let clipboardEdit;
	const actions = [];

	function difference(before, after) {
		if (before === after) {
			return { start: before.length, end: before.length, insert: '' };
		}
		let start = 0;
		while (start < before.length && start < after.length && before[start] === after[start]) {
			start++;
		}
		let end = before.length;
		let last = after.length;
		while (end > start && last > start && before[end - 1] === after[last - 1]) {
			end--;
			last--;
		}
		return { start, end, insert: after.slice(start, last) };
	}

	function mapOffset(offset, change) {
		if (offset < change.start) {
			return offset;
		}
		if (offset < change.end) {
			return change.start + change.insert.length;
		}
		return offset + change.insert.length - (change.end - change.start);
	}

	function selection() {
		return input.selectionDirection === 'backward'
			? [input.selectionEnd, input.selectionStart] : [input.selectionStart, input.selectionEnd];
	}

	function select(anchor, head) {
		input.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), head < anchor ? 'backward' : 'forward');
	}

	function recover(before) {
		draft.value = difference(before, input.value).insert;
		recovery.hidden = false;
		actions.length = 0;
	}

	function replaceFromHost(data) {
		if (data.version < version) {
			return;
		}
		const initial = input.disabled;
		const [anchor, head] = selection();
		const change = difference(input.value, data.text);
		source = data.text;
		version = data.version;
		input.value = source;
		input.disabled = false;
		select(initial ? 0 : mapOffset(anchor, change), initial ? 0 : mapOffset(head, change));
		drawSelection();
	}

	function flush() {
		if (input.disabled || flight || composing) {
			return;
		}
		if (source !== input.value) {
			flight = { id: ++nextId, before: source, after: input.value };
			vscode.postMessage({ type: 'edit', id: flight.id, version, ...difference(source, flight.after) });
		} else {
			for (const action of actions.splice(0)) {
				vscode.postMessage({ type: action });
			}
		}
	}

	function documentChanged(data) {
		if (data.version <= version) {
			return;
		}
		if (flight || composing) {
			if (!deferredDocument || deferredDocument.version < data.version) {
				deferredDocument = data;
			}
			return;
		}
		if (input.value !== source) {
			recover(source);
		}
		replaceFromHost(data);
	}

	function acceptResult(data) {
		if (!flight || flight.id !== data.id) {
			return;
		}
		const edit = flight;
		flight = undefined;
		const accepted = data.accepted && data.text === edit.after;
		if (composing) {
			if (accepted) {
				source = data.text;
				compositionVersion = version = data.version;
			} else if (!deferredDocument || deferredDocument.version <= data.version) {
				deferredDocument = data;
				compositionVersion = -1;
			}
			return;
		}
		if (accepted) {
			source = data.text;
			version = data.version;
		} else {
			recover(edit.before);
			replaceFromHost(data);
		}
		if (deferredDocument) {
			const deferred = deferredDocument;
			deferredDocument = undefined;
			documentChanged(deferred);
		}
		flush();
		drawSelection();
	}

	function lineOffsets(column) {
		return column.cells.length ? [...column.cells.map(cell => cell.start), column.cells.at(-1).end] : [column.start];
	}

	function locate(offset) {
		for (let index = columns.length - 1; index >= 0; index--) {
			const column = columns[index];
			const offsets = lineOffsets(column);
			if (offset >= offsets[0] || index === 0) {
				const match = offsets.findIndex(value => value >= offset);
				return { column, index, offsets, row: match < 0 ? offsets.length - 1 : match };
			}
		}
		return undefined;
	}

	function locationRect(location) {
		const { column, row } = location;
		if (!column.cells.length) {
			return column.element.getBoundingClientRect();
		}
		const rect = column.cells[Math.min(row, column.cells.length - 1)].element.getBoundingClientRect();
		return { left: rect.left, width: rect.width, top: row === column.cells.length ? rect.bottom : rect.top, height: rect.height };
	}

	function drawSelection(reveal = false) {
		const [anchor, head] = selection();
		const change = difference(input.value, layoutText);
		const start = mapOffset(Math.min(anchor, head), change);
		const end = mapOffset(Math.max(anchor, head), change);
		if (!paintedRange || paintedRange.start !== start || paintedRange.end !== end) {
			for (const column of columns) {
				for (const cell of column.cells) {
					cell.element.classList.toggle('selected', start < end && cell.start < end && cell.end > start);
				}
			}
			paintedRange = { start, end };
		}
		const location = locate(mapOffset(head, change));
		caret.hidden = !location || document.activeElement !== input;
		if (!location || composing) {
			return;
		}
		const rect = locationRect(location);
		if (reveal && (rect.top < 52 || rect.top + rect.height > window.innerHeight)) {
			window.scrollBy(0, rect.top - window.innerHeight / 2);
		}
		const left = rect.left + window.scrollX + rect.width * 0.13;
		const top = rect.top + window.scrollY;
		for (const element of [caret, input, composition]) {
			element.style.left = `${left}px`;
			element.style.top = `${top}px`;
		}
		caret.style.width = `${rect.width * 0.74}px`;
		const { fontSize } = getComputedStyle(location.column.element);
		input.style.fontSize = fontSize;
		composition.style.fontSize = fontSize;
	}

	function useLayout(data) {
		generation = data.generation;
		layoutText = data.text;
		settingsStatus.textContent = data.settingsError ?? '';
		settingsStatus.hidden = !settingsStatus.textContent;
		pages = window.renderScreenplayPages(paper, data);
		columns = pages.flatMap(page => page.columns);
		paintedRange = undefined;
		drawSelection();
	}

	window.addEventListener('message', ({ data }) => {
		if (data?.type === 'document') {
			documentChanged(data);
		} else if (data?.type === 'editResult') {
			acceptResult(data);
		} else if (data?.type === 'layout' && data.generation > generation) {
			if (composing) {
				deferredLayout = data;
			} else {
				useLayout(data);
			}
		} else if (data?.type === 'status') {
			commandStatus.textContent = data.message;
		} else if (data?.type === 'pageBreak') {
			perform('pageBreak');
		} else if (data?.type === 'clipboardEdit' && clipboardEdit?.id === data.id) {
			const { before, start, end, type } = clipboardEdit;
			clipboardEdit = undefined;
			if (type === 'paste' && !data.text) {
				return;
			}
			if (input.value !== before || composing) {
				commandStatus.textContent = '原稿が更新されました。必要な箇所で操作をやり直してください。';
				return;
			}
			input.setRangeText(data.text.replace(/\r\n?/gu, '\n'), start, end, 'end');
			flush();
			drawSelection(true);
		}
	});

	function pointOffset(event) {
		const distance = (axis, minimum, maximum) => Math.max(minimum - axis, axis - maximum, 0);
		const page = pages.reduce((best, item) => {
			const rect = item.element.getBoundingClientRect();
			const y = distance(event.clientY, rect.top, rect.bottom);
			return !best || y < best.distance ? { item, distance: y } : best;
		}, undefined)?.item;
		const column = page?.columns.reduce((best, item) => {
			const rect = item.element.getBoundingClientRect();
			const x = Math.abs(event.clientX - (rect.left + rect.width / 2));
			return !best || x < best.distance ? { item, distance: x } : best;
		}, undefined)?.item;
		if (!column) {
			return input.value.length;
		}
		const cell = column.cells.find(item => {
			const rect = item.element.getBoundingClientRect();
			return event.clientY < rect.top + rect.height / 2;
		});
		const offset = cell?.start ?? column.cells.at(-1)?.end ?? column.start;
		return mapOffset(offset, difference(layoutText, input.value));
	}

	paper.addEventListener('pointerdown', event => {
		if (event.button !== 0 || input.disabled || composing) {
			return;
		}
		event.preventDefault();
		const offset = pointOffset(event);
		dragAnchor = event.shiftKey ? selection()[0] : offset;
		paper.setPointerCapture(event.pointerId);
		input.focus({ preventScroll: true });
		select(dragAnchor, offset);
		drawSelection();
	});
	paper.addEventListener('pointermove', event => {
		if (dragAnchor !== undefined) {
			select(dragAnchor, pointOffset(event));
			drawSelection();
		}
	});
	paper.addEventListener('lostpointercapture', () => { dragAnchor = undefined; });

	function perform(action) {
		if (action === 'pageBreak') {
			if (input.disabled || composing) {
				return;
			}
			const head = selection()[1];
			const start = head === 0 ? 0 : input.value.lastIndexOf('\n', head - 1) + 1;
			input.setRangeText('\f\n', start, start, 'preserve');
			flush();
			drawSelection();
			return;
		}
		if (!input.disabled) {
			actions.push(action);
			flush();
		}
	}

	document.querySelector('.editor-toolbar').addEventListener('click', event => {
		const action = event.target.dataset.action;
		if (action) {
			input.focus({ preventScroll: true });
			perform(action);
		}
	});
	document.querySelector('#dismiss').addEventListener('click', () => { recovery.hidden = true; input.focus({ preventScroll: true }); });

	input.addEventListener('compositionstart', () => {
		drawSelection();
		composing = true;
		compositionVersion = version;
	});
	input.addEventListener('compositionupdate', event => {
		composition.textContent = event.data;
		composition.hidden = !event.data;
	});
	input.addEventListener('compositionend', () => {
		setTimeout(() => {
			composing = false;
			composition.hidden = true;
			if (deferredDocument && (deferredDocument.version > compositionVersion || compositionVersion === -1)) {
				const deferred = deferredDocument;
				deferredDocument = undefined;
				if (input.value !== source) {
					recover(source);
				}
				replaceFromHost(deferred);
			}
			if (deferredLayout) {
				useLayout(deferredLayout);
				deferredLayout = undefined;
			}
			flush();
			drawSelection(true);
		}, 0);
	});
	input.addEventListener('input', () => { flush(); drawSelection(true); });
	input.addEventListener('focus', () => drawSelection());
	input.addEventListener('blur', () => { caret.hidden = true; });
	document.addEventListener('selectionchange', () => drawSelection());
	window.addEventListener('resize', () => drawSelection());
	input.addEventListener('beforeinput', event => {
		if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
			event.preventDefault();
			perform(event.inputType === 'historyUndo' ? 'undo' : 'redo');
		}
	});

	input.addEventListener('keydown', event => {
		if (event.isComposing || composing || event.keyCode === 229) {
			return;
		}
		if (event.ctrlKey && !event.altKey) {
			const key = event.key.toLowerCase();
			if (key === 'c' || key === 'x' || key === 'v') {
				event.preventDefault();
				const start = input.selectionStart;
				const end = input.selectionEnd;
				const type = key === 'c' ? 'copy' : key === 'x' ? 'cut' : 'paste';
				if (type === 'paste' || start < end) {
					const id = ++nextId;
					if (type !== 'copy') {
						clipboardEdit = { id, before: input.value, start, end, type };
					}
					vscode.postMessage({ type, id, text: input.value.slice(start, end) });
				}
				return;
			}
			const action = key === 's' ? 'save' : key === 'y' || (key === 'z' && event.shiftKey) ? 'redo' : key === 'z' ? 'undo' : undefined;
			if (action) {
				event.preventDefault();
				perform(action);
				return;
			}
		}
		if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
			return;
		}
		event.preventDefault();
		const [anchor, head] = selection();
		const forward = difference(input.value, layoutText);
		const backward = difference(layoutText, input.value);
		const location = locate(mapOffset(head, forward));
		let next = head;
		if (event.ctrlKey && (event.key === 'Home' || event.key === 'End')) {
			next = event.key === 'Home' ? 0 : input.value.length;
		} else if (location && (event.key === 'Home' || event.key === 'End')) {
			next = mapOffset(event.key === 'Home' ? location.offsets[0] : location.offsets.at(-1), backward);
		} else if (location && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
			const other = columns[location.index + (event.key === 'ArrowLeft' ? 1 : -1)];
			if (other) {
				const offsets = lineOffsets(other);
				const row = Math.max(0, Math.min(location.column.indent + location.row - other.indent, offsets.length - 1));
				next = mapOffset(offsets[row], backward);
			}
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			const segments = graphemes.segment(input.value);
			const segment = event.key === 'ArrowUp' ? segments.containing(head - 1) : segments.containing(head);
			if (segment) {
				next = event.key === 'ArrowUp' ? segment.index : segment.index + segment.segment.length;
			}
		}
		select(event.shiftKey ? anchor : next, next);
		drawSelection(true);
	});

	vscode.postMessage({ type: 'ready' });
})();

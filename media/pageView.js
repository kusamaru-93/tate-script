/* global window, document */
window.renderScreenplayPages = (container, data) => {
	const fragment = document.createDocumentFragment();
	const pages = data.pages.length ? data.pages : [[]];
	const columnsByPage = [];
	for (const [index, lines] of pages.entries()) {
		const page = document.createElement('section');
		page.className = 'page';
		page.style.aspectRatio = `${data.paper.width} / ${data.paper.height}`;
		page.setAttribute('aria-label', `${index + 1}ページ`);
		const columns = document.createElement('div');
		columns.className = 'columns';
		for (const [name, value] of Object.entries(data.geometry)) {
			columns.style.setProperty(`--${name}`, `${100 * value / data.paper.width}cqw`);
		}
		const entries = [];
		for (const line of lines) {
			const column = document.createElement('div');
			column.className = `column indent-${line.indent}`;
			const cells = line.cells.map(({ text, range }) => {
				const element = document.createElement('span');
				element.textContent = text;
				column.append(element);
				return { element, ...range };
			});
			columns.append(column);
			entries.push({ element: column, cells, indent: line.indent, ...line.range });
		}
		page.append(columns);
		fragment.append(page);
		columnsByPage.push({ element: page, columns: entries });
	}
	container.replaceChildren(fragment);
	return columnsByPage;
};

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

const vscode = acquireVsCodeApi();
const { pdf, worker } = document.body.dataset;
const main = document.querySelector('main');
const status = document.querySelector('#status');
const save = document.querySelector('button');
save.addEventListener('click', () => vscode.postMessage({ type: 'save' }));

async function loadResource(url) {
	const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
	if (!response.ok) {
		throw new Error(`読み込みエラー (${response.status})`);
	}
	return response;
}

async function showPdf() {
	const [pdfFile, workerFile] = await Promise.all([loadResource(pdf), loadResource(worker)]);
	const workerUrl = URL.createObjectURL(new Blob([await workerFile.text()], { type: 'text/javascript' }));
	const decoder = new Worker(workerUrl, { type: 'module' });
	const decoderFailed = new Promise((_, reject) => {
		decoder.addEventListener('error', () => reject(new Error('PDFデコーダーを起動できませんでした。')), { once: true });
	});
	GlobalWorkerOptions.workerPort = decoder;
	const loading = getDocument({ data: new Uint8Array(await pdfFile.arrayBuffer()), useWasm: false, isEvalSupported: false });
	window.addEventListener('pagehide', () => {
		void loading.destroy();
		decoder.terminate();
		URL.revokeObjectURL(workerUrl);
	}, { once: true });
	status.textContent = 'PDFを解析中…';
	const documentPdf = await Promise.race([loading.promise, decoderFailed]);
	const firstPage = await documentPdf.getPage(1);
	const { width, height } = firstPage.getViewport({ scale: 1 });
	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				observer.unobserve(entry.target);
				void render(entry.target);
			}
		}
	}, { rootMargin: '300px' });
	async function render(canvas) {
		try {
			const page = await documentPdf.getPage(Number(canvas.dataset.page));
			const viewport = page.getViewport({ scale: 1.6 });
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			await page.render({ canvas, viewport }).promise;
		} catch (error) {
			status.textContent = `PDFのページを表示できませんでした。 ${error.message}`;
		}
	}
	for (let number = 1; number <= documentPdf.numPages; number++) {
		const canvas = document.createElement('canvas');
		canvas.style.aspectRatio = `${width} / ${height}`;
		canvas.dataset.page = number;
		canvas.setAttribute('aria-label', `PDF ${number}ページ`);
		main.append(canvas);
		observer.observe(canvas);
	}
	status.textContent = `${documentPdf.numPages}ページ`;
	save.disabled = false;
}

void showPdf().catch(error => {
	status.textContent = `PDFを表示できませんでした。 ${error.message}`;
});

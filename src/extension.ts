import * as vscode from 'vscode';

const isWeb: boolean = typeof process === 'undefined';
const extId = 'simple-runner';
const extTitle = 'Simple Runner';

enum configSectionIds {
	enableRunButton = 'enableRunButton',
	enableMarkdownCodeLens = 'enableMarkdownCodeLens',
	runInTerminal = 'runInTerminal',
	showDebugInfo = 'showDebugInfo',
	showTimestampInDebugInfo = 'showTimestampInDebugInfo',
	clearOutputBeforeRun = 'clearOutputBeforeRun',
	showOutputBeforeRun = 'showOutputBeforeRun',
	executorMap = 'executorMap',
}

enum commandIds {
	runFile = extId + '.' + 'runFile',
	stopTask = extId + '.' + 'stopTask',
	copyCodeBlock = extId + '.' + 'copyCodeBlock',
	editCodeBlock = extId + '.' + 'editCodeBlock',
	runCodeBlock = extId + '.' + 'runCodeBlock',
	toggleRunInTerminal = extId + '.' + 'toggleRunInTerminal',
	toggleShowDebugInfo = extId + '.' + 'toggleShowDebugInfo',
	toggleClearOutputBeforeRun = extId + '.' + 'toggleClearOutputBeforeRun',
}

enum contextIds {
	isWeb = extId + '.' + 'isWeb',
	fileListInTask = extId + '.' + 'fileListInTask',
	supportedLanguages = extId + '.' + 'supportedLanguages',
	enableRunButton = extId + '.' + configSectionIds.enableRunButton,
}

// codeblockLang is prefered when writting notebook codeblock to markdown
const languageDetailsMap = new Map([
	['ahk', { extname: '.ahk', alias: ['autohotkey'] }],
	['bat', { extname: '.bat', alias: ['batch'] }],
	['cpp', { extname: '.cpp', alias: ['c++'] }],
	['csharp', { extname: '.cs', alias: ['c#'] }],
	['fortran', { extname: '.f', alias: ['fortran_fixed-form', 'fortran_modern', 'FortranFreeForm'] }],
	['fsharp', { extname: '.fs', alias: ['f#'] }],
	['go', { extname: '.go', alias: ['golang'] }],
	['javascript', { extname: '.js', alias: ['js'] }],
	['objective-c', { extname: '.m', alias: ['objective', 'objc'] }],
	['python', { extname: '.py', alias: ['py', 'py2', 'py3'] }],
	['powershell', { extname: '.ps1', alias: ['ps1'] }],
	['rust', { extname: '.rs', alias: ['rs'] }],
	['shellscript', { extname: '.sh', alias: ['sh', 'shell', 'bash'], codeblockLang: 'sh' }],
	['typescript', { extname: '.ts', alias: ['ts'] }],
	['vb', { extname: '.vbs', alias: ['vbscript', 'vbs'] }],
]);

const outputChannel = vscode.window.createOutputChannel(extTitle, 'log');
const fileTaskMap: Map<string, any> = new Map();

function safeImportNodeApi(name: string) {
	return isWeb ? undefined : require(name);
}

const path = safeImportNodeApi('path');
const fs = safeImportNodeApi('fs');
const os = safeImportNodeApi('os');
const spawn = safeImportNodeApi('child_process')?.spawn;
const treeKill = safeImportNodeApi('tree-kill');

function getVscLangId(mdLangId: string): string {
	for (const [vscLangId, data] of languageDetailsMap.entries()) {
		if (data.alias.includes(mdLangId)) {
			return vscLangId;
		}
	}
	return mdLangId;
}

function getConfigValue(section: string): any {
	return vscode.workspace.getConfiguration(extId).get(section);
}

function getTimeStamp(date: Date) {
	return date.toISOString().replace('T', ' ').replace('Z', '');
}

function logWrite(msg: string, timeStamp: string = getTimeStamp(new Date()), prefix: string = '') {
	if (getConfigValue(configSectionIds.showDebugInfo) || getConfigValue(configSectionIds.runInTerminal)) {
		outputChannel.append(prefix + (getConfigValue(configSectionIds.showTimestampInDebugInfo) ? getTimeStamp(new Date()) + ' ' : '') + msg);
	}
}

function debounce(func: (...args: any[]) => void, timeout: number) {
	let timer: NodeJS.Timeout;
	return (...args: any[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => func(...args), timeout);
	};
}

class Executor {
	static terminal: vscode.Terminal | undefined;
	static extTmpDir: string | undefined = isWeb ? undefined : this.getExtTmpDir();

	// We need to sanitize the path before using vscode.URI.fsPath.
	// https://github.com/microsoft/vscode/blob/777f6917e2956882688847460e6f4b10a26f0670/extensions/git/src/git.ts#L353
	static sanitizePath(path: string): string {
		return path.replace(/^([a-z]):\\/i, (_, letter) => `${letter.toUpperCase()}:\\`);
	}

	private static getExtTmpDir(): string {
		// Prepare extension temporary directory
		const extTmpDir = path.join(os.tmpdir(), 'vscode-' + extId);
		if (!fs.existsSync(extTmpDir)) {
			try {
				fs.mkdirSync(extTmpDir, { recursive: true });
				logWrite(`[info] Directory ${extTmpDir} created successfully.\n`);
			} catch (err) {
				logWrite(`[error] Failed to create directory: ${err}\n`);
				throw err;
			}
		}
		logWrite(`[info] Extension temporary directory: ${extTmpDir}\n`);
		return extTmpDir;
	}

	// When running in the terminal, we cannot known when does command start and exit.
	// Thus a bigger maxKeepFileSeconds is set.
	private static async emptyExtTmpDir() {
		if (fileTaskMap.size === 0) {
			try {
				const files = await fs.promises.readdir(Executor.extTmpDir, { withFileTypes: true });
				const currentTime = Date.now();
				const maxKeepFileSeconds = getConfigValue(configSectionIds.runInTerminal) ? 10 : 1;
				for (const file of files) {
					const filePath = path.join(Executor.extTmpDir, file.name);
					try {
						const stats = await fs.promises.stat(filePath);
						const fileCreationTime = stats.birthtimeMs; // Get the file creation time
						if (currentTime - fileCreationTime >= maxKeepFileSeconds * 1000) {
							await fs.promises.rm(filePath, { recursive: true, force: true });
							logWrite(`[info] Deleted ${filePath} created ${((currentTime - fileCreationTime) / 1000).toFixed()} seconds ago.\n`);
						}
					} catch (err) {
						logWrite(`[error] Failed to delete ${filePath}: ${err}`);
					}
				}
			} catch (err) {
				logWrite(`[error] Failed to read directory: ${err}\n`);
				throw err;
			}
		}
	}

	private static execInTerminal(command: string, execution?: vscode.NotebookCellExecution | undefined) {
		if (!this.terminal || this.terminal.exitStatus) {
			this.terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal();
		}

		if (getConfigValue(configSectionIds.showOutputBeforeRun)) {
			this.terminal.show();
		}
		if (getConfigValue(configSectionIds.clearOutputBeforeRun)) {
			vscode.commands.executeCommand('workbench.action.terminal.clear');
		}
		execution?.start();
		execution?.clearOutput();
		this.terminal.sendText(command);
		execution?.end(true)
	}

	private static async execInChildProcess(command: string, file: vscode.Uri, execution?: vscode.NotebookCellExecution | undefined): Promise<any> {
		if (!fileTaskMap.has(file.path)) {
			const output = {
				stdout: '',
				stderr: '',
			}

			if (getConfigValue(configSectionIds.showOutputBeforeRun) && !execution) {
				outputChannel?.show(true);
			}
			if (getConfigValue(configSectionIds.clearOutputBeforeRun)) {
				outputChannel?.clear();
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: path.basename(this.sanitizePath(file.fsPath)),
				cancellable: true
			}, async (progress, token) => {
				const cwd = (() => {
					const workspaceFolder =
						(vscode.workspace.workspaceFolders?.length === 1 && vscode.workspace.workspaceFolders[0]) ||
						vscode.workspace.getWorkspaceFolder(file) ||
						(vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) ||
						(vscode.window.activeNotebookEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeNotebookEditor.notebook.uri));

					return workspaceFolder ? this.sanitizePath(workspaceFolder.uri.fsPath) : undefined;
				})();

				const startTime = Date.now();
				const childProcess = spawn(command, {
					shell: true,
					cwd
				});

				execution?.start(startTime);
				execution?.clearOutput();
				const processMsg = `[PID:${childProcess.pid}]`;
				logWrite(`[info] ${processMsg} Running: ${command}\n`, getTimeStamp(new Date(startTime)));
				fileTaskMap.set(file.path, childProcess);
				vscode.commands.executeCommand('setContext', contextIds.fileListInTask, Array.from(fileTaskMap.keys()));

				const cellOutput = new vscode.NotebookCellOutput([]);
				// execution?.appendOutput(cellOutput);
				execution?.replaceOutput(cellOutput);

				childProcess.stdout.on('data', (data: { toString: () => string; }) => {
					output.stdout = output.stdout + data.toString();
					if (!execution) {
						outputChannel?.append(data.toString());
					}
					execution?.replaceOutputItems([
						// vscode.NotebookCellOutputItem.stdout(output.stdout),
						// vscode.NotebookCellOutputItem.error(new Error(output.stderr)),
						vscode.NotebookCellOutputItem.text(output.stdout + output.stderr)
					], cellOutput);
					progress.report({ message: `${data}` });
				});

				childProcess.stderr.on('data', (data: { toString: () => string; }) => {
					output.stderr = output.stderr + data.toString();
					if (!execution) {
						outputChannel?.append(data.toString());
					}
					execution?.replaceOutputItems([
						// vscode.NotebookCellOutputItem.stdout(output.stdout),
						// vscode.NotebookCellOutputItem.error(new Error(output.stderr)),
						vscode.NotebookCellOutputItem.text(output.stdout + output.stderr)
					], cellOutput);
					progress.report({ message: `${data}` });
				});

				token.onCancellationRequested(() => {
					treeKill(childProcess.pid, 'SIGKILL');
				});

				execution?.token.onCancellationRequested(() => {
					treeKill(childProcess.pid, 'SIGKILL');
				});

				await new Promise<void>((resolve) => {
					childProcess.on('close', (code: number | null, signal: any) => {
						const endTime = Date.now();
						console.log(startTime, endTime, endTime - startTime);

						let elapsedTimeMsg = ` in ${((endTime - startTime) / 1000).toFixed(2)} s`;

						fileTaskMap.delete(file.path);
						vscode.commands.executeCommand('setContext', contextIds.fileListInTask, Array.from(fileTaskMap.keys()));

						let msg: string;
						if (signal) {
							msg = `[error] ${processMsg} Killed by signal: ${signal}${elapsedTimeMsg}\n`;
						} else if (code === null) {
							msg = `[error] ${processMsg} Killed by unknown means${elapsedTimeMsg}\n`;
						} else {
							msg = `[${code === 0 ? 'info' : 'error'}] ${processMsg} Exited with code: ${code}${elapsedTimeMsg}\n`;
						}

						logWrite(msg, undefined, '\n');
						execution?.end(code === 0, endTime);
						resolve();
					});
				});
			});
		} else {
			execution?.end(false);
		}
	}

	static runFile(content: string, vscLangId: string, file: vscode.Uri, execution?: vscode.NotebookCellExecution | undefined) {
		// Follows vscode predefined variables https://code.visualstudio.com/docs/reference/variables-reference#_predefined-variables
		const filePath = this.sanitizePath(file.fsPath);
		const fileBasename = path.basename(filePath);
		const fileBasenameNoExtension = path.basename(file.fsPath, path.extname(file.fsPath));
		const fileExtname = path.extname(filePath);
		const fileDirname = path.dirname(filePath);
		const fileDirnameBasename = path.basename(fileDirname);

		const command = getConfigValue(configSectionIds.executorMap)[vscLangId]
			.replace(/\$\{file\}/g, filePath)
			.replace(/\$\{fileBasename\}/g, fileBasename)
			.replace(/\$\{fileBasenameNoExtension\}/g, fileBasenameNoExtension)
			.replace(/\$\{fileExtname\}/g, fileExtname)
			.replace(/\$\{fileDirname\}/g, fileDirname)
			.replace(/\$\{fileDirnameBasename\}/g, fileDirnameBasename)
			.replace(/\$\{pathSeparator\}/g, path.sep)
			.replace(/\$\{\/\}/g, path.sep)
			.replace(/\$\{content\}/g, content)
			.replace(/\$\{extTmpDir\}/g, Executor.extTmpDir);

		if (getConfigValue(configSectionIds.runInTerminal)) {
			this.execInTerminal(command, execution);
		} else {
			this.execInChildProcess(command, file, execution);
		}
	}

	static async runContent(content: string, mdLangId: string, execution?: vscode.NotebookCellExecution | undefined) {
		const vscLangId = getVscLangId(mdLangId);
		const fileExtname = (vscLangId === 'fortran' && mdLangId !== 'fortran') && '.f90' || languageDetailsMap.get(vscLangId)?.extname || '.' + mdLangId;
		// const fileBasenameNoExtension = require('crypto').createHash('sha256').update(content).digest('hex').slice(0, 8); // Same file name for same content
		const fileBasenameNoExtension = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
		const fileName = fileBasenameNoExtension + fileExtname;
		const filePath = path.join(Executor.extTmpDir, fileName);

		let fileContent;
		switch (mdLangId) {
			case 'powershell':
			case 'vb':
				fileContent = Buffer.concat([Buffer.from('\uFEFF', 'utf16le'), Buffer.from(content, 'utf16le')])
				break;
			case 'bat':
				fileContent = content.replace(/\n/g, "\r\n");
				break;
			default:
				fileContent = content;
				break;
		}

		try {
			fs.writeFileSync(filePath, fileContent);
		} catch (err) {
			logWrite(`[error] Failed to write to file: ${err}\n`);
			throw err;
		}

		await Executor.emptyExtTmpDir();
		this.runFile(content, vscLangId, vscode.Uri.file(filePath), execution);
	}
}

class MarkdownParser {
	static parseMarkdown(content: string): vscode.NotebookCellData[] {
		const codeBlockStartPattern = /^([ \t]*)(`{3,})(.*)/;
		const lines = content.split(/\r?\n/g);
		let cells: vscode.NotebookCellData[] = [];
		let i = 0;

		// Each parse function starts with line i, leaves i on the line after the last line parsed
		for (; i < lines.length;) {
			const leadingWhitespace = i === 0 ? parseWhitespaceLines(true) : '';
			if (i >= lines.length) {
				break;
			}

			const codeBlockMatch = lines[i].match(codeBlockStartPattern);
			if (codeBlockMatch) {
				parseCodeBlock(leadingWhitespace, codeBlockMatch[1], codeBlockMatch[2], codeBlockMatch[3]);
			} else {
				parseMarkdownParagraph(leadingWhitespace);
			}
		}

		function parseWhitespaceLines(isFirst: boolean): string {
			let start = i;
			const nextNonWhitespaceLineOffset = lines.slice(start).findIndex(l => l !== '');
			let end: number; // will be next line or overflow
			let isLast = false;
			if (nextNonWhitespaceLineOffset < 0) {
				end = lines.length;
				isLast = true;
			} else {
				end = start + nextNonWhitespaceLineOffset;
			}

			i = end;
			const numWhitespaceLines = end - start + (isFirst || isLast ? 0 : 1);
			return '\n'.repeat(numWhitespaceLines);
		}

		function parseCodeBlock(leadingWhitespace: string, indentation: string, fence: string, language: string): void {
			const startSourceIdx = ++i;
			const startLine = lines[startSourceIdx - 1];
			const startPos = new vscode.Position(startSourceIdx - 1, startLine.length);
			while (true) {
				const currLine = lines[i];
				if (i >= lines.length) {
					break;
				} else if (currLine.match(new RegExp(`^${indentation}${fence}$`))) {
					i++; // consume block end marker
					break;
				}

				i++;
			}

			const endPos = new vscode.Position(i - 1, lines[i - 1].length);
			const range = new vscode.Range(startPos, endPos);

			const content = lines.slice(startSourceIdx, i - 1)
				.map(line => line.replace(new RegExp('^' + indentation), ''))
				.join('\n');
			const trailingWhitespace = parseWhitespaceLines(false);

			cells.push({
				kind: vscode.NotebookCellKind.Code,
				languageId: getVscLangId(language),
				value: content,
				metadata: {
					leadingWhitespace,
					indentation,
					fence,
					language,
					content,
					trailingWhitespace,
					range,
				},
			});
		}

		function parseMarkdownParagraph(leadingWhitespace: string): void {
			const startSourceIdx = i;
			const startPos = new vscode.Position(startSourceIdx, 0);

			if (lines[i].match(/^<!--/)) {
				while (true) {
					if (i >= lines.length) {
						break;
					}

					const currLine = lines[i];
					if (currLine.match(/^.*-->$/)) {
						i++;
						break;
					}

					i++;
				}
			} else {
				while (true) {
					if (i >= lines.length) {
						break;
					}

					const currLine = lines[i];
					if (currLine === '' || currLine.match(codeBlockStartPattern)) {
						break;
					}

					i++;
				}
			}

			const endPos = new vscode.Position(i - 1, lines[i - 1].length);
			const range = new vscode.Range(startPos, endPos);

			const content = lines.slice(startSourceIdx, i).join('\n');
			const trailingWhitespace = parseWhitespaceLines(false);

			cells.push({
				kind: vscode.NotebookCellKind.Markup,
				languageId: 'markdown',
				value: content,
				metadata: {
					leadingWhitespace,
					content,
					trailingWhitespace,
					range,
				},
			});
		}

		return cells;
	}

	static getBetweenCellsWhitespace(cells: ReadonlyArray<vscode.NotebookCellData>, idx: number): string {
		const thisCell = cells[idx];
		const nextCell = cells[idx + 1];

		if (!nextCell) {
			return thisCell.metadata?.trailingWhitespace ?? '\n';
		}

		const trailing = thisCell.metadata?.trailingWhitespace;
		const leading = nextCell.metadata?.leadingWhitespace;

		if (typeof trailing === 'string' && typeof leading === 'string') {
			return trailing + leading;
		}

		// One of the cells is new
		const combined = (trailing ?? '') + (leading ?? '');
		if (!combined || combined === '\n') {
			return '\n\n';
		}

		return combined;
	}

	static writeCellsToMarkdown(cells: ReadonlyArray<vscode.NotebookCellData>): string {
		let result = '';
		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];

			if (i === 0) {
				result += cell.metadata?.leadingWhitespace ?? '';
			}

			if (cell.kind === vscode.NotebookCellKind.Code) {
				const indentation = cell.metadata?.raw?.indentation ?? ''
				const defaultLang = languageDetailsMap.get(cell.languageId)?.codeblockLang ?? cell.languageId;
				const originLang = cell.metadata?.raw?.language;
				const cellLang = originLang && getVscLangId(originLang) === cell.languageId ? originLang : defaultLang;
				const fence = cell.metadata?.raw?.fence ?? '```';
				const codePrefix = indentation + fence + cellLang + '\n';
				const contents = cell.value.split(/\r?\n/g)
					.map(line => indentation + line)
					.join('\n');
				const codeSuffix = '\n' + indentation + fence;

				result += codePrefix + contents + codeSuffix;
			} else {
				result += cell.value;
			}

			result += this.getBetweenCellsWhitespace(cells, i);
		}
		return result;
	}
}

class NotebookSerializer implements vscode.NotebookSerializer {
	private readonly decoder = new TextDecoder();
	private readonly encoder = new TextEncoder();

	deserializeNotebook(data: Uint8Array, _token: vscode.CancellationToken): vscode.NotebookData | Thenable<vscode.NotebookData> {
		const content = this.decoder.decode(data);
		return {
			cells: MarkdownParser.parseMarkdown(content),
		};
	}

	serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Uint8Array | Thenable<Uint8Array> {
		const stringOutput = MarkdownParser.writeCellsToMarkdown(data.cells);
		return this.encoder.encode(stringOutput);
	}
}

class NotebookKernel {
	private _executionOrder = 0;
	private readonly _controller: vscode.NotebookController;

	constructor() {
		this._controller = vscode.notebooks.createNotebookController(extId, extId, extTitle);
		this._controller.supportsExecutionOrder = true;
		this._controller.executeHandler = this._executeAll.bind(this);
	}

	dispose(): void {
		this._controller.dispose();
	}

	private _executeAll(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, _controller: vscode.NotebookController): void {
		for (const cell of cells) {
			this._doExecution(cell);
		}
	}

	private async _doExecution(cell: vscode.NotebookCell): Promise<void> {
		const execution = this._controller.createNotebookCellExecution(cell);
		execution.executionOrder = ++this._executionOrder;
		await Executor.runContent(cell.document.getText(), cell.document.languageId, execution);
	}

	setSupportedLanguages(supportedLanguages: string[]) {
		this._controller.supportedLanguages = supportedLanguages;
	}
}

function initMarkdownCodeLens(context: vscode.ExtensionContext,) {
	context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: '*', language: 'markdown' }, {
		provideCodeLenses: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
			const codeLenses: vscode.CodeLens[] = [];

			if (getConfigValue(configSectionIds.enableMarkdownCodeLens)) {
				MarkdownParser.parseMarkdown(document.getText()).forEach((cell, index) => {
					if (cell.kind === vscode.NotebookCellKind.Code) {
						codeLenses.push(new vscode.CodeLens(cell.metadata?.range, {
							command: commandIds.copyCodeBlock,
							title: '$(copy)' + vscode.l10n.t('Copy'),
							tooltip: vscode.l10n.t('Copy code block'),
							arguments: [cell]
						}));

						// Add new CodeLens for editing code block
						codeLenses.push(new vscode.CodeLens(cell.metadata?.range, {
							command: commandIds.editCodeBlock,
							title: '$(pencil)' + vscode.l10n.t('Edit'),
							tooltip: vscode.l10n.t('Edit code block'),
							arguments: [cell, index, document]
						}));

						const runner = getConfigValue(configSectionIds.executorMap)[getVscLangId(cell.languageId)];
						if (!isWeb && runner) {
							codeLenses.push(new vscode.CodeLens(cell.metadata?.range, {
								command: commandIds.runCodeBlock,
								title: '$(run)' + vscode.l10n.t('Run'),
								tooltip: vscode.l10n.t('Run code block{0}', `\n${runner}`),
								arguments: [cell]
							}));
						}
					}
				});
			}
			return codeLenses;
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(commandIds.copyCodeBlock, (cell: vscode.NotebookCellData) => {
		vscode.env.clipboard.writeText(cell.value).then(() => {
			vscode.window.showInformationMessage(vscode.l10n.t('Copied code block to clipboard'))
		}, (error) => {
			vscode.window.showErrorMessage(vscode.l10n.t('Failed to copy code block: {0}', error));
		});
	}));

	// Register the new command for editing code blocks
	context.subscriptions.push(vscode.commands.registerCommand(commandIds.editCodeBlock, async (cell: vscode.NotebookCellData, index: number, document: vscode.TextDocument) => {
		const tmpDoc = await vscode.workspace.openTextDocument({ content: cell.value, language: cell.languageId });
		const editor = await vscode.window.showTextDocument(tmpDoc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

		const changeSubscription = vscode.workspace.onDidChangeTextDocument(debounce(async (event: vscode.TextDocumentChangeEvent) => {
			if (event.document === tmpDoc && tmpDoc.getText() !== '') {
				const range: vscode.Range = MarkdownParser.parseMarkdown(document.getText())[index].metadata?.range;
				const rangeToReplace = new vscode.Range(
					new vscode.Position(range.start.line + 1, 0),
					new vscode.Position(range.end.line, 0)
				);
				const edit = new vscode.WorkspaceEdit();
				edit.replace(document.uri, rangeToReplace, tmpDoc.getText() + '\n');
				await vscode.workspace.applyEdit(edit);
			}
		}, 60));

		vscode.workspace.onDidCloseTextDocument((closedDocument) => {
			if (closedDocument === tmpDoc) {
				changeSubscription.dispose();
			}
		});
	}));

	if (!isWeb) {
		context.subscriptions.push(vscode.commands.registerCommand(commandIds.runCodeBlock, (data: vscode.NotebookCellData) => {
			Executor.runContent(data.value, data.languageId);
		}));
	}
}

function initRunButton(context: vscode.ExtensionContext) {
	if (!isWeb) {
		vscode.commands.executeCommand('setContext', contextIds.enableRunButton, getConfigValue(configSectionIds.enableRunButton));
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(configSectionIds.enableRunButton)) {
				vscode.commands.executeCommand('setContext', contextIds.enableRunButton, getConfigValue(configSectionIds.enableRunButton));
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand(commandIds.runFile, (file) => {
			const document = file ? vscode.workspace.textDocuments.find(d => d.uri.path === file.path) : vscode.window.activeTextEditor?.document;
			if (document) {
				if (document.isUntitled) {
					Executor.runContent(document.getText(), document.languageId);
				} else {
					Executor.runFile(document.getText(), document.languageId, document.uri);
				}
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand(commandIds.stopTask, (file) => {
			const filePath = file ? file.path : vscode.window.activeTextEditor?.document.uri.path;
			if (filePath && fileTaskMap.has(filePath)) {
				treeKill(fileTaskMap.get(filePath).pid, 'SIGKILL');
			}
		}));
	}
}

function initNotebook(context: vscode.ExtensionContext): NotebookKernel | undefined {
	const providerOptions = {
		transientMetadata: {
			runnable: true,
			editable: true,
			custom: true,
		},
		transientOutputs: true
	};
	if (isWeb) {
		context.subscriptions.push(vscode.workspace.registerNotebookSerializer(extId, new NotebookSerializer(), providerOptions));
	} else {
		const notebookKernel = new NotebookKernel();
		context.subscriptions.push(vscode.workspace.registerNotebookSerializer(extId, new NotebookSerializer(), providerOptions), notebookKernel);
		return notebookKernel;
	}
	return undefined;
}

function initConfigUpdater(context: vscode.ExtensionContext, notebookKernel: NotebookKernel | undefined) {
	const toggleMap = new Map();
	toggleMap.set(commandIds.toggleRunInTerminal, configSectionIds.runInTerminal);
	toggleMap.set(commandIds.toggleShowDebugInfo, configSectionIds.showDebugInfo);
	toggleMap.set(commandIds.toggleClearOutputBeforeRun, configSectionIds.clearOutputBeforeRun);

	toggleMap.forEach((section, mapKey) => {
		context.subscriptions.push(vscode.commands.registerCommand(mapKey, (file) => {
			vscode.workspace.getConfiguration(extId).update(section, !getConfigValue(section), vscode.ConfigurationTarget.Global);
		}));
	});

	const updateSupportedLanguages = () => {
		const supportedLanguages = Object.keys(getConfigValue(configSectionIds.executorMap)).filter(k => getConfigValue(configSectionIds.executorMap)[k]);
		vscode.commands.executeCommand('setContext', contextIds.supportedLanguages, supportedLanguages);
		notebookKernel?.setSupportedLanguages(supportedLanguages);
	};

	updateSupportedLanguages();
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration(configSectionIds.executorMap)) {
			updateSupportedLanguages();
		}
	}));
}

export function activate(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand('setContext', contextIds.isWeb, isWeb);
	logWrite(`[info] isWeb: ${isWeb}\n`);

	initMarkdownCodeLens(context);
	initRunButton(context);
	const notebookKernel = initNotebook(context);
	initConfigUpdater(context, notebookKernel);
	if (!isWeb) {
		vscode.window.onDidChangeActiveTerminal(t => Executor.terminal = t);
	}
}

export async function deactivate() { }

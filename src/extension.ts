import * as vscode from 'vscode';

enum ids {
	extId = "simple-runner",
	extTitle = "Simple Runner",
	isWeb = extId + "." + "isWeb",
	enableRunButton = extId + "." + "enableRunButton",
	enableMarkdownCodeLens = extId + "." + "enableMarkdownCodeLens",
	runInTerminal = extId + "." + "runInTerminal",
	showDebugInfo = extId + "." + "showDebugInfo",
	showTimestampInDebugInfo = extId + "." + "showTimestampInDebugInfo",
	clearOutputBeforeRun = extId + "." + "clearOutputBeforeRun",
	showOutputBeforeRun = extId + "." + "showOutputBeforeRun",
	runnerMap = extId + "." + "runnerMap",
	runFile = extId + "." + "runFile",
	stopTask = extId + "." + "stopTask",
	copyCodeBlock = extId + "." + "copyCodeBlock",
	runCodeBlock = extId + "." + "runCodeBlock",
	supportedLanguages = extId + "." + "supportedLanguages",
	fileListInTask = extId + "." + "fileListInTask",
	toggleRunInTerminal = extId + "." + "toggleRunInTerminal",
	toggleShowDebugInfo = extId + "." + "toggleShowDebugInfo",
	toggleClearOutputBeforeRun = extId + "." + "toggleClearOutputBeforeRun",
	markdownCodeLensStyle = extId + "." + "markdownCodeLensStyle",
}

const isWeb: boolean = typeof process === 'undefined'
const outputChannel = vscode.window.createOutputChannel(ids.extTitle, 'log');
let terminal: vscode.Terminal | undefined = undefined;
const fileTaskMap: Map<string, any> = new Map();

const getConfig: () => any = () => vscode.workspace.getConfiguration();
const getrunnerMap: () => any = () => getConfig().get(ids.runnerMap);
// https://github.com/microsoft/vscode/blob/777f6917e2956882688847460e6f4b10a26f0670/extensions/git/src/git.ts#L353
const sanitizePath: (path: string) => string = (path: string) => path.replace(/^([a-z]):\\/i, (_, letter) => `${letter.toUpperCase()}:\\`);

function getTimeStamp(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function debugWrite(msg: string, timeStamp: string = getTimeStamp(new Date()), prefix: string = "") {
	if (getConfig().get(ids.showDebugInfo)) {
		outputChannel.append(prefix + (getConfig().get(ids.showTimestampInDebugInfo) ? getTimeStamp(new Date()) + " " : "") + msg);
	}
}

function makeExtTmpDir(): string | undefined {
	const { tmpdir } = require('os');
	const path = require('path');
	const fs = require('fs');

	const extTmpDir = path.join(tmpdir(), ids.extId);

	// Check if the directory exists
	if (!fs.existsSync(extTmpDir)) {
		// Create the directory if it does not exist
		try {
			fs.mkdirSync(extTmpDir, { recursive: true });
			debugWrite(`[info] Directory ${extTmpDir} created successfully.\n`);
		} catch (err) {
			debugWrite(`[error] Failed to create directory: ${err}\n`);
			return undefined;
		}
	}
	return extTmpDir;
}

function runInTerminal(command: string, context: vscode.ExtensionContext) {
	if (!terminal) {
		terminal = vscode.window.terminals.find(t => t.name == ids.extTitle);
	}

	if (!terminal) {
		terminal = vscode.window.createTerminal({
			name: ids.extTitle,
			iconPath: new vscode.ThemeIcon("rocket"),
		});
		context.subscriptions.push(terminal);
	}

	if (getConfig().get(ids.showOutputBeforeRun)) {
		terminal.show();
	}
	if (getConfig().get(ids.clearOutputBeforeRun)) {
		vscode.commands.executeCommand("workbench.action.terminal.clear");
	}

	terminal.sendText(command);
}

async function runChildProcess(command: string, file: vscode.Uri): Promise<any> {
	if (getConfig().get(ids.showOutputBeforeRun)) {
		outputChannel?.show(true);
	}
	if (getConfig().get(ids.clearOutputBeforeRun)) {
		outputChannel?.clear();
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: vscode.l10n.t('Running {0}', sanitizePath(file.fsPath)),
		cancellable: true
	}, async (progress, token) => {
		const startTimeFormatted = getTimeStamp(new Date());
		const startTime = process.hrtime();
		const childProcess = require('child_process').spawn(command, {
			shell: true,
			cwd: (() => {
				const fileFolder = vscode.workspace.getWorkspaceFolder(file);
				if (fileFolder) {
					return sanitizePath(fileFolder.uri.fsPath);
				}

				const editorFolder = vscode.window.activeTextEditor
					? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
					: undefined;

				if (editorFolder) {
					return sanitizePath(editorFolder.uri.fsPath);
				}
			})()
		});
		const processMsg = `[PID:${childProcess.pid}]`;
		debugWrite(`[info] ${processMsg} Running: ${command}\n`, startTimeFormatted);
		fileTaskMap.set(file.path, childProcess);
		vscode.commands.executeCommand('setContext', ids.fileListInTask, Array.from(fileTaskMap.keys()));

		childProcess.stdout.on('data', (data: { toString: () => string; }) => {
			progress.report({ message: data.toString() });
			outputChannel?.append(data.toString());
		});

		childProcess.stderr.on('data', (data: { toString: () => string; }) => {
			progress.report({ message: data.toString() });
			outputChannel?.append(data.toString());
		});

		token.onCancellationRequested(() => {
			require('tree-kill')(childProcess.pid, 'SIGKILL');
		});

		await new Promise((resolve, reject) => {
			childProcess.on('close', (code: number | null, signal: any) => {
				const endTime = process.hrtime(startTime);
				const [seconds, nanoseconds] = endTime;
				// const elapsedTimeMsg = ` in ${(seconds * 1e3 + nanoseconds / 1e6).toFixed(2)} ms`;
				const elapsedTimeMsg = ` in ${(seconds + nanoseconds / 1e9).toFixed(2)} s`;

				fileTaskMap.delete(file.path);
				vscode.commands.executeCommand('setContext', ids.fileListInTask, Array.from(fileTaskMap.keys()));
				if (signal) {
					const msg = `[error] ${processMsg} Killed by signal: ${signal}${elapsedTimeMsg}\n`;
					debugWrite(msg, undefined, "\n");
					resolve(msg);
				} else if (code === null) {
					const msg = `[error] ${processMsg} Killed by unknown means${elapsedTimeMsg}\n`;
					debugWrite(msg, undefined, "\n");
					resolve(msg);
				} else {
					const msg = `[${code === 0 ? 'info' : 'error'}] ${processMsg} Exited with code: ${code}${elapsedTimeMsg}\n`;
					debugWrite(msg, undefined, "\n");
					resolve(msg);
				}
			});
		});
	});
}

// https://github.com/Microsoft/vscode-docs/blob/main/docs/editor/variables-reference.md
function runFile(file: vscode.Uri, languageId: string, context: vscode.ExtensionContext) {
	if (!fileTaskMap.has(file.path)) {
		const path = require('path');

		const filePath = sanitizePath(file.fsPath);
		const fileBasename = path.basename(file.fsPath);
		const fileBasenameNoExtension = fileBasename.split('.').slice(0, -1).join('.');
		const fileExtname = filePath.split('.').slice(-1)[0];
		const fileDirname = path.dirname(filePath);
		const fileDirnameBasename = path.basename(fileDirname);
		const extTmpDir = makeExtTmpDir();
		if (!extTmpDir) {
			return;
		}

		const command: string = getrunnerMap()[languageId]
			.replace(/\$\{file\}/g, filePath)
			.replace(/\$\{fileBasename\}/g, fileBasename)
			.replace(/\$\{fileBasenameNoExtension\}/g, fileBasenameNoExtension)
			.replace(/\$\{fileExtname\}/g, fileExtname)
			.replace(/\$\{fileDirname\}/g, fileDirname)
			.replace(/\$\{fileDirnameBasename\}/g, fileDirnameBasename)
			.replace(/\$\{pathSeparator\}/g, path.sep)
			.replace(/\$\{extTmpDir\}/g, extTmpDir);

		if (getConfig().get(ids.runInTerminal)) {
			runInTerminal(command, context);
		} else {
			runChildProcess(command, file);
		}
	}
}

function copyCodeBlock(codeBlock: any) {
	vscode.env.clipboard.writeText(codeBlock.content).then(() => {
		vscode.window.showInformationMessage(vscode.l10n.t('Copied code block to clipboard'))
	}, (error) => {
		vscode.window.showErrorMessage(vscode.l10n.t('Failed to copy code block: {0}', error));
	});
}

async function runCodeBlock(codeBlock: any, context: vscode.ExtensionContext) {
	const path = require('path');
	const fs = require('fs');

	const extTmpDir = makeExtTmpDir();
	if (!extTmpDir) {
		return;
	}

	// Write code block to file
	let filePath = path.join(extTmpDir, require('crypto').createHash('sha256').update(codeBlock.content).digest('hex').substring(0, 8) + codeBlock.fileExtension);
	try {
		fs.writeFileSync(filePath, codeBlock.encodeInUtf16 ? Buffer.concat([Buffer.from('\uFEFF', 'utf16le'), Buffer.from(codeBlock.content, 'utf16le')]) : codeBlock.content);
	} catch (err) {
		debugWrite(` [error] Failed to write to file: ${err}\n`);
		return;
	}

	runFile(vscode.Uri.file(filePath), codeBlock.languageId, context);
}

// Define a function to provide codelens for each code block
function provideMarkdownCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
	const codeLenses: vscode.CodeLens[] = [];
	if (getConfig().get(ids.enableMarkdownCodeLens)) {
		// Iterate over all lines in the document
		for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
			const line = document.lineAt(lineIndex);

			// Check if the line starts a code block
			if (line.text.startsWith('```') && line.text.substring(3).trim()) {
				let codeBlockStart = lineIndex;
				let codeBlockInfo = '';
				let codeBlockEnd = -1;

				// Determine the code block type if specified
				if (line.text.length > 3) {
					codeBlockInfo = line.text.substring(3).trim();
				}

				// Find the end of the code block
				for (let i = lineIndex + 1; i < document.lineCount; i++) {
					const nextLine = document.lineAt(i);
					if (nextLine.text.startsWith('```')) {
						if (nextLine.text.substring(3).trim()) {
							break;
						}
						codeBlockEnd = i;
						break;
					}
				}

				if (codeBlockEnd !== -1) {
					// Extract the code block content
					const codeBlockContent = document.getText(new vscode.Range(
						new vscode.Position(codeBlockStart + 1, 0),
						new vscode.Position(codeBlockEnd - 1, document.lineAt(codeBlockEnd - 1).range.end.character)
					));

					const codeBlockInfoLowerCased = codeBlockInfo.toLowerCase();
					let languageId = codeBlockInfoLowerCased;
					let fileExtension = '.' + codeBlockInfoLowerCased;
					let encodeInUtf16 = false;

					/* First item is language ID, then alias. */
					switch (codeBlockInfoLowerCased) {
						case 'ahk':
						case 'autohotkey':
							languageId = 'ahk';
							fileExtension = '.ahk';
							break;
						case 'applescript':
							fileExtension = '.scpt';
							break;
						case 'autoit':
							fileExtension = '.au3';
							break;
						case 'bat':
						case 'batch':
							languageId = 'bat';
							fileExtension = '.bat';
							break;
						case 'clojure':
							fileExtension = '.clj';
							break;
						case 'coffeescript':
							fileExtension = '.coffee';
							break;
						case 'cpp':
						case 'c++':
							languageId = 'cpp';
							fileExtension = '.cpp';
							break;
						case 'crystal':
							fileExtension = '.cr';
							break;
						case 'csharp':
						case 'c#':
							languageId = 'csharp';
							fileExtension = '.cs';
							break;
						case 'erlang':
							fileExtension = '.erl';
							break;
						case 'fortran_fixed-form':
							languageId = 'fortran';
							fileExtension = '.f';
							break;
						case 'fortran_modern':
							languageId = 'fortran';
							fileExtension = '.f90';
							break;
						case 'fortran':
							fileExtension = '.f';
							break;
						case 'FortranFreeForm':
							languageId = 'fortran';
							fileExtension = '.f90';
							break;
						case 'fsharp':
						case 'f#':
							languageId = 'fsharp';
							fileExtension = '.fs';
							break;
						case 'gleam':
							fileExtension = '.gl';
							break;
						case 'go':
						case 'golang':
							languageId = 'go';
							fileExtension = '.go';
							break;
						case 'haskell':
							fileExtension = '.hs';
							break;
						case 'haxe':
							fileExtension = '.hx';
							break;
						case 'javascript':
						case 'js':
							languageId = 'javascript';
							fileExtension = '.js';
							break;
						case 'julia':
							fileExtension = '.jl';
							break;
						case 'objective-c':
						case 'objective':
						case 'objc':
							languageId = 'objective-c';
							fileExtension = '.m';
							break;
						case 'ocaml':
							fileExtension = '.ml';
							break;
						case 'pascal':
							fileExtension = '.pas';
							break;
						case 'perl':
							fileExtension = '.pl';
							break;
						case 'perl6':
							fileExtension = '.pm';
							break;
						case 'powershell':
							fileExtension = '.ps1';
							encodeInUtf16 = true;
							break;
						case 'python':
						case 'py':
							languageId = 'python';
							fileExtension = '.py';
							break;
						case 'racket':
							fileExtension = '.rkt';
							break;
						case 'ruby':
							fileExtension = '.rb';
							break;
						case 'rust':
						case 'rs':
							languageId = 'rust';
							fileExtension = '.rs';
							break;
						case 'scheme':
							fileExtension = '.scm';
							break;
						case 'shellscript':
						case 'bash':
						case 'sh':
						case 'shell':
							languageId = 'shellscript';
							fileExtension = '.sh';
							break;
						case 'typescript':
						case 'ts':
							languageId = 'typescript';
							fileExtension = '.ts';
							break;
						case 'vb':
						case 'vbscript':
						case 'vbs':
							languageId = 'vb';
							fileExtension = '.vbs';
							encodeInUtf16 = true;
							break;
					}

					const codeBlock = {
						info: codeBlockInfo,
						content: codeBlockContent,
						languageId: languageId,
						fileExtension: fileExtension,
						encodeInUtf16: encodeInUtf16
					};

					// Add a codelens to Copy code block
					codeLenses.push(new vscode.CodeLens(new vscode.Range(
						new vscode.Position(codeBlockStart, 0),
						new vscode.Position(codeBlockStart, 0)
					), {
						command: ids.copyCodeBlock,
						title: (() => {
							switch (getConfig().get(ids.markdownCodeLensStyle)) {
								case "icon":
									return '$(copy)';
								case "text":
									return vscode.l10n.t('Copy');
								default:
									return '$(copy)' + vscode.l10n.t('Copy');
							}
						})(),
						tooltip: vscode.l10n.t('Copy code block'),
						arguments: [codeBlock]
					}));

					// Add a codelens to run the code block
					const runner = getrunnerMap()[languageId];
					if (!isWeb && runner) {
						codeLenses.push(new vscode.CodeLens(new vscode.Range(
							new vscode.Position(codeBlockStart, 0),
							new vscode.Position(codeBlockStart, 0)
						), {
							command: ids.runCodeBlock,
							title: (() => {
								switch (getConfig().get(ids.markdownCodeLensStyle)) {
									case "icon":
										return '$(run)';
									case "text":
										return vscode.l10n.t('Run');
									default:
										return '$(run)' + vscode.l10n.t('Run');
								}
							})(),
							tooltip: vscode.l10n.t('Run code block{0}', `\n${runner}`),
							arguments: [codeBlock]
						}));
					}
				}
			}
		}
	}
	return codeLenses;
}

function initMarkdownCodeLens(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: '*', language: 'markdown' }, {
		provideCodeLenses: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
			return provideMarkdownCodeLenses(document);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(ids.copyCodeBlock, (codeBlock) => {
		copyCodeBlock(codeBlock);
	}));

	if (!isWeb) {
		context.subscriptions.push(vscode.commands.registerCommand(ids.runCodeBlock, (codeBlock) => {
			runCodeBlock(codeBlock, context);
		}));
	}
}

function initRunButton(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand('setContext', ids.enableRunButton, getConfig().get(ids.enableRunButton));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration(ids.enableRunButton)) {
			vscode.commands.executeCommand('setContext', ids.enableRunButton, getConfig().get(ids.enableRunButton));
		}
	}));

	vscode.commands.executeCommand('setContext', ids.supportedLanguages, Object.keys(getrunnerMap()).filter(k => getrunnerMap()[k]));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration(ids.runnerMap)) {
			vscode.commands.executeCommand('setContext', ids.supportedLanguages, Object.keys(getrunnerMap()).filter(k => getrunnerMap()[k]));
		}
	}));
}

export function activate(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand('setContext', ids.isWeb, isWeb);
	debugWrite(`[info] isWeb: ${isWeb}\n`);

	initMarkdownCodeLens(context);
	if (!isWeb) {
		initRunButton(context);

		context.subscriptions.push(vscode.commands.registerCommand(ids.runFile, (file) => {
			const document = file ? vscode.workspace.textDocuments.find(d => d.uri.path === file.path) : vscode.window.activeTextEditor?.document;
			if (document) {
				runFile(document.uri, document.languageId, context);
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand(ids.stopTask, (file) => {
			const filePath = file ? file.path : vscode.window.activeTextEditor?.document.uri.path;
			if (filePath && fileTaskMap.has(filePath)) {
				require('tree-kill')(fileTaskMap.get(filePath).pid, 'SIGKILL');
			}
		}));

		context.subscriptions.push(vscode.window.onDidCloseTerminal(t => {
			// Terminal name does not match on Windows when closed by entering 'exit'
			if (t.name == ids.extTitle || !vscode.window.terminals.find(t2 => t2.name == ids.extTitle)) {
				terminal = undefined;
			}
		}));

		const toggleMap = new Map();
		toggleMap.set(ids.toggleRunInTerminal, ids.runInTerminal);
		toggleMap.set(ids.toggleShowDebugInfo, ids.showDebugInfo);
		toggleMap.set(ids.toggleClearOutputBeforeRun, ids.clearOutputBeforeRun);

		toggleMap.forEach((value, key) => {
			context.subscriptions.push(vscode.commands.registerCommand(key, (file) => {
				vscode.workspace.getConfiguration().update(value, !getConfig().get(value), vscode.ConfigurationTarget.Global);
			}));
		});
	}
}

export async function deactivate() { }
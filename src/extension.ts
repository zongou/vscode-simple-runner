import * as vscode from 'vscode';

enum ids {
	ext = "simple-runner",
	isWeb = ext + "." + "isWeb",
	enableRunButton = ext + "." + "enableRunButton",
	enableMarkdownCodeLens = ext + "." + "enableMarkdownCodeLens",
	runInTerminal = ext + "." + "runInTerminal",
	showOutputBeforeRun = ext + "." + "showOutputBeforeRun",
	clearOutputBeforeRun = ext + "." + "clearOutputBeforeRun",
	showDebugInfo = ext + "." + "showDebugInfo",
	runnerMap = ext + "." + "runnerMap",
	runFile = ext + "." + "runFile",
	stopTask = ext + "." + "stopTask",
	copyCodeBlock = ext + "." + "copyCodeBlock",
	runCodeBlock = ext + "." + "runCodeBlock",
	supportedLanguages = ext + "." + "supportedLanguages",
	tasks = ext + "." + "tasks",
	toggleEnableRunButton = ext + "." + "toggleEnableRunButton",
	toggleEnableMarkdownCodeLens = ext + "." + "toggleEnableMarkdownCodeLens",
	toggleRunInTerminal = ext + "." + "toggleRunInTerminal",
	toggleClearOutputBeforeRun = ext + "." + "toggleClearOutputBeforeRun",
	toggleShowOutputBeforeRun = ext + "." + "toggleShowOutputBeforeRun",
	toggleShowDebugInfo = ext + "." + "toggleShowDebugInfo",
}

const isWeb: boolean = typeof process === 'undefined'
vscode.commands.executeCommand('setContext', ids.isWeb, isWeb);

const getConfig: () => any = () => vscode.workspace.getConfiguration();
const getrunnerMap: () => any = () => getConfig().get(ids.runnerMap);

const outputChannel = vscode.window.createOutputChannel(ids.ext, 'log');
let terminal: vscode.Terminal | null = null;
const tasks: Map<string, any> = new Map();

function getFormatedDate(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function debug_log(msg: string) {
	if (getConfig().get(ids.showDebugInfo)) {
		outputChannel?.append(`${getFormatedDate(new Date())} ${msg}`);
	}
}

function makeExtTmpDir(): string | null {
	const { tmpdir } = require('os');
	const path = require('path');
	const fs = require('fs');

	const extTmpDir = path.join(tmpdir(), ids.ext);

	// Check if the directory exists
	if (!fs.existsSync(extTmpDir)) {
		// Create the directory if it does not exist
		try {
			fs.mkdirSync(extTmpDir, { recursive: true });
			debug_log(`[info] Directory ${extTmpDir} created successfully.`);
		} catch (err) {
			debug_log(` [error] Failed to create directory: ${err}`);
			return null;
		}
	}
	return extTmpDir;
}

function runInTerminal(command: string, context: vscode.ExtensionContext) {
	if (!terminal) {
		for (const t in vscode.window.terminals) {
			for (const t of vscode.window.terminals) {
				if (t.name == ids.ext) {
					debug_log(`[info] terminal: terminal named '${ids.ext}' exists.`);
					terminal = t;
					context.subscriptions.push(terminal);
					break;
				}
			}
		}
	}

	if (!terminal) {
		terminal = vscode.window.createTerminal(ids.ext);
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

async function runChildProcess(command: string, filePath: string): Promise<any> {
	if (getConfig().get(ids.showOutputBeforeRun)) {
		outputChannel?.show();
	}
	if (getConfig().get(ids.clearOutputBeforeRun)) {
		outputChannel?.clear();
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: vscode.l10n.t('Running {0}', filePath),
		cancellable: true
	}, async (progress, token) => {
		const startTime = performance.now();
		const childProcess = require('child_process').spawn(command, {
			shell: true,
			cwd: (() => {
				const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
				if (folder) {
					return folder.uri.fsPath;
				}

				const activeEditor = vscode.window.activeTextEditor;
				if (activeEditor) {
					const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
					if (folder) {
						return folder.uri.fsPath;
					}
				}

				return undefined;
			})()
		});
		const processMsg = `[PID:${childProcess.pid}]`;
		debug_log(`[info] ${processMsg} Running: ${command}\n`);
		tasks.set(filePath, childProcess);
		vscode.commands.executeCommand('setContext', ids.tasks, Array.from(tasks.keys()));

		childProcess.stdout.on('data', (data: { toString: () => string; }) => {
			outputChannel?.append(data.toString());
		});

		childProcess.stderr.on('data', (data: { toString: () => string; }) => {
			outputChannel?.append(data.toString());
		});

		token.onCancellationRequested(() => {
			require('tree-kill')(childProcess.pid, 'SIGKILL');
		});

		await new Promise((resolve, reject) => {
			childProcess.on('close', (code: null, signal: any) => {
				const elapsedTime = (performance.now() - startTime).toFixed(1)
				tasks.delete(filePath);
				vscode.commands.executeCommand('setContext', ids.tasks, Array.from(tasks.keys()));
				if (signal) {
					const msg = `[error] ${processMsg} Killed by signal: ${signal} in ${elapsedTime} ms\n`;
					outputChannel.append("\n");
					debug_log(msg);
					resolve(msg);
				} else if (code === null) {
					const msg = `${processMsg} Killed by unknown means in ${elapsedTime} ms\n`;
					debug_log(msg);
					resolve(msg);
				} else {
					const msg = `[${code === 0 ? 'info' : 'error'}] ${processMsg} Exited with code: ${code} in ${elapsedTime} ms\n`;
					debug_log(msg);
					resolve(msg);
				}
			});
		});
	});
}

function runFile(filePath: string, languageId: string, context: vscode.ExtensionContext) {
	const path = require('path');

	const extTmpDir = makeExtTmpDir();
	if (!extTmpDir) {
		return;
	}

	const fileDir = path.dirname(filePath);
	const fileBasename = path.basename(filePath);
	const fileBasenameNoExtension = fileBasename.split('.').slice(0, -1).join('.');
	const fileExtname = filePath.split('.').slice(-1)[0];

	const command: string = getrunnerMap()[languageId]
		.replace(/\{file\}/g, filePath)
		.replace(/\{fileDir\}/g, fileDir)
		.replace(/\{fileBasename\}/g, fileBasename)
		.replace(/\{fileBasenameNoExtension\}/g, fileBasenameNoExtension)
		.replace(/\{fileExtname\}/g, fileExtname)
		.replace(/\{extTmpDir\}/g, extTmpDir)
		.replace(/\{pathSep\}/g, path.sep);

	if (getConfig().get(ids.runInTerminal)) {
		runInTerminal(command, context);
	} else {
		runChildProcess(command, filePath);
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
	let filePath = path.join(extTmpDir, require('crypto').createHash('sha256').update(codeBlock.content).digest('hex').substring(0, 8) + codeBlock.language.fileExtName);
	try {
		fs.writeFileSync(filePath, codeBlock.content);
	} catch (err) {
		debug_log(` [error] Failed to write to file: ${err}`);
		return;
	}

	runFile(filePath, codeBlock.language.languageId, context);
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
				let codeBlockType = '';
				let codeBlockEnd = -1;

				// Determine the code block type if specified
				if (line.text.length > 3) {
					codeBlockType = line.text.substring(3).trim();
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

					const codeBlock = {
						type: codeBlockType,
						content: codeBlockContent,
						language: (() => {
							const codeBlockTypeLowerCased = codeBlockType.toLowerCase();
							switch (codeBlockTypeLowerCased) {
								case 'sh':
								case 'shell':
								case 'bash':
									return { languageId: 'shellscript', fileExtName: '.sh' }
								case 'cpp':
								case 'c++':
									return { languageId: 'cpp', fileExtName: '.cpp' }
								case 'go':
								case 'golang':
									return { languageId: 'go', fileExtName: '.go' }
								case 'javascript':
								case 'js':
									return { languageId: 'javascript', fileExtName: '.js' }
								case 'python':
								case 'py':
									return { languageId: 'python', fileExtName: '.py' }
								case 'rust':
								case 'rs':
									return { languageId: 'rust', fileExtName: '.rs' }
								case 'typescript':
								case 'ts':
									return { languageId: 'typescript', fileExtName: '.ts' }
								default:
									return { languageId: codeBlockTypeLowerCased, fileExtName: '.' + codeBlockTypeLowerCased };
							}
						})()
					};

					// Add a codelens to Copy code block
					codeLenses.push(new vscode.CodeLens(new vscode.Range(
						new vscode.Position(codeBlockStart, 0),
						new vscode.Position(codeBlockStart, 0)
					), {
						command: ids.copyCodeBlock,
						title: vscode.l10n.t('Copy'),
						tooltip: vscode.l10n.t('Copy code block', codeBlockType),
						arguments: [codeBlock]
					}));

					// Add a codelens to run the code block
					if (!isWeb && getrunnerMap()[codeBlock.language.languageId]) {
						codeLenses.push(new vscode.CodeLens(new vscode.Range(
							new vscode.Position(codeBlockStart, 0),
							new vscode.Position(codeBlockStart, 0)
						), {
							command: ids.runCodeBlock,
							title: vscode.l10n.t('Run'),
							tooltip: vscode.l10n.t('Run code block{0}', `\n${getrunnerMap()[codeBlock.language.languageId]}`),
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
	debug_log(`[info] isWeb: ${isWeb}\n`);
	initMarkdownCodeLens(context);
	if (!isWeb) {
		initRunButton(context);

		context.subscriptions.push(vscode.commands.registerCommand(ids.runFile, (file) => {
			const document = file ? vscode.workspace.textDocuments.find(d => d.uri.fsPath === file.fsPath) : vscode.window.activeTextEditor?.document;
			if (document) {
				runFile(document.uri.fsPath, document.languageId, context);
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand(ids.stopTask, (file) => {
			const filePath = file ? file.fsPath : vscode.window.activeTextEditor?.document.uri.fsPath;
			if (filePath && tasks.has(filePath)) {
				require('tree-kill')(tasks.get(filePath).pid, 'SIGKILL');
			}
		}));

		context.subscriptions.push(vscode.window.onDidCloseTerminal(t => {
			if (t.name == ids.ext) {
				terminal = null;
			}
		}));

		const toggleMap = new Map();
		toggleMap.set(ids.toggleEnableRunButton, ids.enableRunButton);
		toggleMap.set(ids.toggleEnableMarkdownCodeLens, ids.enableMarkdownCodeLens);
		toggleMap.set(ids.toggleRunInTerminal, ids.runInTerminal);
		toggleMap.set(ids.toggleClearOutputBeforeRun, ids.clearOutputBeforeRun);
		toggleMap.set(ids.toggleShowOutputBeforeRun, ids.showOutputBeforeRun);
		toggleMap.set(ids.toggleShowDebugInfo, ids.showDebugInfo);

		toggleMap.forEach((value, key) => {
			context.subscriptions.push(vscode.commands.registerCommand(key, (file) => {
				vscode.workspace.getConfiguration().update(value, !getConfig().get(value), vscode.ConfigurationTarget.Global);
			}));
		});
	}
}

export async function deactivate() { }
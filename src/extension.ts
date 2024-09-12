import * as vscode from 'vscode';

enum ids {
	ext = "simple-runner",
	isWeb = ext + "." + "isWeb",
	debug = ext + "_debug",
	enableRunButton = ext + "." + "enableRunButton",
	enableMarkdownCodeLens = ext + "." + "enableMarkdownCodeLens",
	showOutputBeforeRun = ext + "." + "showOutputBeforeRun",
	clearOutputBeforeRun = ext + "." + "clearOutputBeforeRun",
	runnerMap = ext + "." + "runnerMap",
	runFile = ext + "." + "runFile",
	stopTask = ext + "." + "stopTask",
	supportedLanguages = ext + "." + "supportedLanguages",
	copyCodeBlock = ext + "." + "copyCodeBlock",
	runCodeBlock = ext + "." + "runCodeBlock",
	tasks = ext + "." + "tasks",
	runInTerminal = ext + "." + "runInTerminal",
	toggleEnableRunButton = ext + "." + "toggleEnableRunButton",
	toggleEnableMarkdownCodeLens = ext + "." + "toggleEnableMarkdownCodeLens",
	toggleRunInTerminal = ext + "." + "toggleRunInTerminal",
	toggleClearOutputBeforeRun = ext + "." + "toggleClearOutputBeforeRun",
	toggleShowOutputBeforeRun = ext + "." + "toggleShowOutputBeforeRun",
}

const isWeb: boolean = typeof process === 'undefined'
vscode.commands.executeCommand('setContext', ids.isWeb, isWeb);

const getConfig: () => any = () => vscode.workspace.getConfiguration();
const getrunnerMap: () => any = () => getConfig().get(ids.runnerMap);

const debugChannel = vscode.window.createOutputChannel(ids.debug, 'log');
const outputChannel = !isWeb ? vscode.window.createOutputChannel(ids.ext, 'log') : undefined;
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
			debugChannel.appendLine(`${getFormatedDate(new Date())} [info] Directory ${extTmpDir} created successfully.`);
		} catch (err) {
			debugChannel.appendLine(`${getFormatedDate(new Date())} [error] Failed to create directory: ${err}`);
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
					debugChannel.appendLine(`${getFormatedDate(new Date())} [info] terminal: terminal named '${ids.ext}' exists.`);
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
	outputChannel?.appendLine(`${getFormatedDate(new Date())} [info] Running ${filePath}`);

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: vscode.l10n.t('Running {0}', filePath),
		cancellable: true
	}, async (progress, token) => {
		const startTime = new Date();
		const childProcess = require('child_process').spawn(command, { shell: true });
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
				const formatedDate = getFormatedDate(new Date());
				tasks.delete(filePath);
				vscode.commands.executeCommand('setContext', ids.tasks, Array.from(tasks.keys()));
				if (signal) {
					outputChannel?.append(`\n${formatedDate} [info] Child process was killed by signal: ${signal}\n`);
					resolve(new Error(`Child process was killed by signal: ${signal}`));
				} else if (code === null) {
					outputChannel?.append(`${formatedDate} [info] Child process was killed by unknown means.\n`);
					resolve(new Error(`Child process was killed by unknown means.`));
				} else {
					outputChannel?.append(`${formatedDate} [info] Child process exited with code: ${code}\n`);
					resolve('Done');
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
		debugChannel.appendLine(`${getFormatedDate(new Date())} [error] Failed to write to file: ${err}`);
		return;
	}

	runFile(filePath, codeBlock.language.languageId, context);
}

function getLanguageByCodeBlockType(codeBlockType: string): { languageId: string, fileExtName: string } {
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
						language: getLanguageByCodeBlockType(codeBlockType)
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
	debugChannel.appendLine(`${getFormatedDate(new Date())} [info] isWeb: ${isWeb}`);
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

		toggleMap.forEach((value, key) => {
			context.subscriptions.push(vscode.commands.registerCommand(key, (file) => {
				vscode.workspace.getConfiguration().update(value, !getConfig().get(value), vscode.ConfigurationTarget.Global);
			}));
		});
	}
}

export async function deactivate() { }
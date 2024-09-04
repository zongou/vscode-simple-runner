# vscode-simple-runner

- [x] Provides a button on editor title to run file.
- [x] Provides code lens `Copy` and `Run` for markdown code block.

## Runner Map

Example to use variables:

```json
"simple-runner.runnerMap": {
    "bat": "echo file: \"{file}\" && echo fileDir: \"{fileDir}\" && echo fileBasename: \"{fileBasename}\" && echo fileBasenameNoExtension: \"{fileBasenameNoExtension}\" && echo fileExtname: \"{fileExtname}\" && echo pathSep: '{pathSep}' && echo extTmpDir: \"{extTmpDir}\"",
    "shellscript": "echo file: \"{file}\" && echo fileDir: \"{fileDir}\" && echo fileBasename: \"{fileBasename}\" && echo fileBasenameNoExtension: \"{fileBasenameNoExtension}\" && echo fileExtname: \"{fileExtname}\" && echo pathSep: '{pathSep}' && echo extTmpDir: \"{extTmpDir}\"",
}
```

Example output:

bat:

```text
file: "x:\windows\TEMP\hello.bat" 
fileDir: "x:\windows\TEMP" 
fileBasename: "hello.bat" 
fileBasenameNoExtension: "hello" 
fileExtname: "bat" 
pathSep: '\' 
extTmpDir: "X:\windows\TEMP\simple-runner"
```

shellscript:

```text
file: /tmp/hello.sh
fileDir: /tmp
fileBasename: hello.sh
fileBasenameNoExtension: hello
fileExtname: sh
pathSep: /
extTmpDir: /tmp/simple-runner
```

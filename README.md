# vscode-simple-runner

- [x] Provides a button on editor title to run file.
- [x] Provides codelens `Copy` and `Run` for markdown code block.

## Fix showing garbled characters on Windows

```json
"terminal.integrated.profiles.windows": {
    "PowerShell": {
        "source": "PowerShell",
        "icon": "terminal-powershell",
        "args": [
            "-NoExit",
            "chcp 65001 >$null"
        ]
    },
    "cmd": {
        "path": "cmd",
        "args": [
            "/K",
            "chcp 65001 >/nul"
        ]
    }
}
```

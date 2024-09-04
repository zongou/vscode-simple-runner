# VSCode Simple Code Runner

- [x] Provides Markdown notebook.
- [x] Provides codelens `Copy`, `Edit` and `Run` for Markdown code block.
- [x] Provides a button on editor title to run file.

## To fix garbled characters on Windows

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

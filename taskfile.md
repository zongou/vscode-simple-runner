# Tasks

## install

```sh
npm install
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install @vscode/test-web -g
npm install vsce -g
```

## compile

```sh
npm run compile
```

## watch

```sh
npm run watch
```

## test-Web

```sh
vscode-test-web --browser=none --quality=stable --extensionDevelopmentPath=. --printServerLog --verbose --testRunnerDataDir=$HOME/.vscode-test-web
```

## publish

[publish with version](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#auto-increment-the-extension-version)

```sh
vsce publish minor
```

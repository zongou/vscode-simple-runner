# Scripts

## Install

```sh
npm install
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install @vscode/test-web -g
npm install vsce -g
```

## Compile

```sh
npm run compile
```

## Watch

```sh
npm run watch
```

## Test-Web

```sh
vscode-test-web --browser=none --quality=stable --extensionDevelopmentPath=. --printServerLog --verbose --testRunnerDataDir=$HOME/.vscode-test-web
```

## Publish

```sh
vsce publish
```

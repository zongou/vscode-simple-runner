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
[semver](https://semver.org/)

Given a version number MAJOR.MINOR.PATCH, increment the:

- MAJOR version when you make incompatible API changes
- MINOR version when you add functionality in a backward compatible manner
- PATCH version when you make backward compatible bug fixes

Additional labels for pre-release and build metadata are available as extensions to the MAJOR.MINOR.PATCH format.

```sh
vsce publish "$@"
```

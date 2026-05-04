# Claude Commit

A VS Code extension that generates git commit messages using [Claude Code](https://claude.ai/code) — the Anthropic CLI. Click the sparkle button in the Source Control input box and get a concise, context-aware commit message written by Claude.

> Code written by [Claude](https://claude.ai) (Anthropic).

## Features

- Generates commit messages from your staged diff (or unstaged if nothing is staged)
- Sets the message directly in the SCM input box of the repository you clicked
- Works correctly in multi-root workspaces — always targets the right repo
- Diffs larger than 30 000 characters are automatically truncated to avoid token limits
- Configurable path to the `claude` binary for non-standard installs

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude --version` should work in your terminal)
- VS Code 1.85+

## Installation

1. Download the latest `.vsix` file from the [Releases](../../releases) page
2. In VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX...** → select the file
3. Reload the window when prompted

## Usage

1. Stage your changes (`git add ...`)
2. Open the **Source Control** panel (`Ctrl+Shift+G`)
3. Click the **✨ sparkle** dropdown in the commit message input box and choose **Claude: Generate Commit Message**
4. Wait a few seconds — Claude reads the diff and fills in the message

If nothing is staged you'll be asked whether to use all unstaged changes instead.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `claudeCommit.claudePath` | *(empty)* | Full path to the `claude` binary. Leave empty to use `claude` from `PATH`. |

To set it: `Ctrl+,` → search **Claude Commit**.

## Building from source

```bash
npm install
npm run compile
npm run package        # produces claude-commit-x.y.z.vsix
code --install-extension claude-commit-x.y.z.vsix --force
```

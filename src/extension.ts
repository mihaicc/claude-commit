import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';

const PROMPT =
  'Generate a git commit message for the diff below.\n' +
  'Rules: first line ≤72 chars, imperative mood, output ONLY the commit message — no explanation, no markdown, no quotes.\n\n' +
  'Diff:';

function findClaude(): string {
  const configured = vscode.workspace.getConfiguration('claudeCommit').get<string>('claudePath');
  if (configured?.trim()) return configured.trim();

  // Common install locations for claude CLI
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    try {
      cp.execFileSync(p, ['--version'], { stdio: 'ignore' });
      return p;
    } catch {
      // not found here
    }
  }
  return 'claude'; // fall back to PATH
}

function runClaude(diff: string, cwd: string, claudeBin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = cp.spawn(
      claudeBin,
      ['-p', PROMPT, '--dangerously-skip-permissions'],
      { cwd }
    );

    proc.stdin.write(diff);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Timed out after 60 seconds'));
    }, 60_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}${stderr.trim() ? ': ' + stderr.trim() : ''}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function getStagedDiff(cwd: string): string {
  return cp.execSync('git diff --cached', { cwd, encoding: 'utf8' });
}

function getFullDiff(cwd: string): string {
  return cp.execSync('git diff', { cwd, encoding: 'utf8' });
}


export function activate(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand('claudeCommit.generate', async (sourceControl?: vscode.SourceControl) => {
    const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
    const gitAPI = gitExt?.getAPI(1);

    // Resolve the repository from: SCM context arg → active editor → first repo
    let repo = gitAPI?.repositories?.[0];
    if (gitAPI && sourceControl?.rootUri) {
      const matched = gitAPI.repositories.find(
        (r: any) => r.rootUri.fsPath === sourceControl.rootUri!.fsPath
      );
      if (matched) repo = matched;
    } else if (gitAPI && vscode.window.activeTextEditor) {
      const editorRepo = gitAPI.getRepository(vscode.window.activeTextEditor.document.uri);
      if (editorRepo) repo = editorRepo;
    }

    const folder = repo?.rootUri?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      vscode.window.showErrorMessage('Claude Commit: No workspace folder open.');
      return;
    }

    let diff: string;
    try {
      diff = getStagedDiff(folder);
    } catch {
      vscode.window.showErrorMessage('Claude Commit: Failed to run git diff.');
      return;
    }

    if (!diff.trim()) {
      const choice = await vscode.window.showWarningMessage(
        'No staged changes found. Use all unstaged changes instead?',
        'Yes',
        'No'
      );
      if (choice !== 'Yes') return;
      try {
        diff = getFullDiff(folder);
      } catch {
        vscode.window.showErrorMessage('Claude Commit: Failed to run git diff.');
        return;
      }
      if (!diff.trim()) {
        vscode.window.showInformationMessage('Claude Commit: No changes to summarize.');
        return;
      }
    }

    // Trim to avoid hitting token limits; ~30k chars covers most realistic diffs
    const trimmedDiff = diff.length > 30_000 ? diff.slice(0, 30_000) + '\n... (truncated)' : diff;
    const claudeBin = findClaude();

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Claude: generating commit message…', cancellable: false },
      async () => {
        try {
          const message = await runClaude(trimmedDiff, folder, claudeBin);
          if (!message) { vscode.window.showErrorMessage('Claude Commit: Empty response.'); return; }
          if (repo) {
            repo.inputBox.value = message;
          } else {
            vscode.window.showInputBox({ value: message, prompt: 'Generated commit message', ignoreFocusOut: true });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('ENOENT') || msg.includes('not found')) {
            const action = await vscode.window.showErrorMessage(
              `Claude Commit: \`claude\` binary not found. Set the path in settings.`,
              'Open Settings'
            );
            if (action === 'Open Settings') {
              vscode.commands.executeCommand('workbench.action.openSettings', 'claudeCommit.claudePath');
            }
          } else {
            vscode.window.showErrorMessage(`Claude Commit: ${msg}`);
          }
        }
      }
    );
  });

  context.subscriptions.push(cmd);
}

export function deactivate() {}

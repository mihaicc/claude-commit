"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const PROMPT = 'Generate a git commit message for the diff below.\n' +
    'Rules: first line ≤72 chars, imperative mood, output ONLY the commit message — no explanation, no markdown, no quotes.\n\n' +
    'Diff:';
function findClaude() {
    const configured = vscode.workspace.getConfiguration('claudeCommit').get('claudePath');
    if (configured?.trim())
        return configured.trim();
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
        }
        catch {
            // not found here
        }
    }
    return 'claude'; // fall back to PATH
}
const CANCELLED = 'cancelled';
function runClaude(diff, cwd, claudeBin, token) {
    return new Promise((resolve, reject) => {
        const proc = cp.spawn(claudeBin, ['-p', PROMPT, '--dangerously-skip-permissions'], { cwd });
        const cancel = token.onCancellationRequested(() => {
            proc.kill();
            reject(new Error(CANCELLED));
        });
        proc.stdin.write(diff);
        proc.stdin.end();
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (chunk) => (stdout += chunk.toString()));
        proc.stderr.on('data', (chunk) => (stderr += chunk.toString()));
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error('Timed out after 60 seconds'));
        }, 60000);
        proc.on('close', (code) => {
            clearTimeout(timer);
            cancel.dispose();
            if (code !== 0) {
                reject(new Error(`claude exited with code ${code}${stderr.trim() ? ': ' + stderr.trim() : ''}`));
            }
            else {
                resolve(stdout.trim());
            }
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            cancel.dispose();
            reject(err);
        });
    });
}
function getStagedDiff(cwd) {
    return cp.execSync('git diff --cached', { cwd, encoding: 'utf8' });
}
function getFullDiff(cwd) {
    return cp.execSync('git diff', { cwd, encoding: 'utf8' });
}
function activate(context) {
    const cmd = vscode.commands.registerCommand('claudeCommit.generate', async (arg) => {
        const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
        const gitAPI = gitExt?.getAPI(1);
        // Resolve the repository from: SCM inputBox arg → SCM sourceControl arg → active editor → first repo
        // When contributed to scm/inputBox, VS Code passes the SourceControlInputBox as arg (not SourceControl).
        let repo = gitAPI?.repositories?.[0];
        if (gitAPI && arg) {
            const matchedByInputBox = gitAPI.repositories.find((r) => r.inputBox === arg);
            if (matchedByInputBox) {
                repo = matchedByInputBox;
            }
            else if (arg?.rootUri) {
                const matchedByRoot = gitAPI.repositories.find((r) => r.rootUri.fsPath === arg.rootUri.fsPath);
                if (matchedByRoot)
                    repo = matchedByRoot;
            }
        }
        else if (gitAPI && vscode.window.activeTextEditor) {
            const editorRepo = gitAPI.getRepository(vscode.window.activeTextEditor.document.uri);
            if (editorRepo)
                repo = editorRepo;
        }
        const folder = repo?.rootUri?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!folder) {
            vscode.window.showErrorMessage('Claude Commit: No workspace folder open.');
            return;
        }
        let diff;
        try {
            diff = getStagedDiff(folder);
        }
        catch {
            vscode.window.showErrorMessage('Claude Commit: Failed to run git diff.');
            return;
        }
        if (!diff.trim()) {
            const choice = await vscode.window.showWarningMessage('No staged changes found. Use all unstaged changes instead?', 'Yes', 'No');
            if (choice !== 'Yes')
                return;
            try {
                diff = getFullDiff(folder);
            }
            catch {
                vscode.window.showErrorMessage('Claude Commit: Failed to run git diff.');
                return;
            }
            if (!diff.trim()) {
                vscode.window.showInformationMessage('Claude Commit: No changes to summarize.');
                return;
            }
        }
        // Trim to avoid hitting token limits; ~30k chars covers most realistic diffs
        const trimmedDiff = diff.length > 30000 ? diff.slice(0, 30000) + '\n... (truncated)' : diff;
        const claudeBin = findClaude();
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Claude: generating commit message…', cancellable: true }, async (_progress, token) => {
            try {
                const message = await runClaude(trimmedDiff, folder, claudeBin, token);
                if (!message) {
                    vscode.window.showErrorMessage('Claude Commit: Empty response.');
                    return;
                }
                if (repo) {
                    repo.inputBox.value = message;
                }
                else {
                    vscode.window.showInputBox({ value: message, prompt: 'Generated commit message', ignoreFocusOut: true });
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg === CANCELLED) {
                    return;
                }
                if (msg.includes('ENOENT') || msg.includes('not found')) {
                    const action = await vscode.window.showErrorMessage(`Claude Commit: \`claude\` binary not found. Set the path in settings.`, 'Open Settings');
                    if (action === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'claudeCommit.claudePath');
                    }
                }
                else {
                    vscode.window.showErrorMessage(`Claude Commit: ${msg}`);
                }
            }
        });
    });
    context.subscriptions.push(cmd);
}
function deactivate() { }

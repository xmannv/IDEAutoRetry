/**
 * SidePanelProvider - Simplified WebviewViewProvider for Auto Retry
 * Now using Vite + React + shadcn/ui
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { AutoRetryService } from '../services/AutoRetryService';

export class SidePanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ideAutoRetry.mainPanel';

  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;
  private readonly _autoRetryService: AutoRetryService;

  constructor(
    extensionUri: vscode.Uri,
    autoRetryService: AutoRetryService
  ) {
    this._extensionUri = extensionUri;
    this._autoRetryService = autoRetryService;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'start':
          await this.handleStart();
          break;
        case 'stop':
          await this.handleStop();
          break;
        case 'toggle':
          await this.handleToggle();
          break;
        case 'setupCDP':
          await this.handleSetupCDP();
          break;
        case 'setAutoStart':
          await this.handleSetAutoStart(message.data?.enabled ?? false);
          break;
        case 'getStatus':
          this.sendStatus();
          this.sendAutoStartSetting();
          this.sendMaxConnectionsSetting();
          break;
        case 'getStats':
          await this.sendStats();
          break;
        case 'setMaxConnections':
          await this.handleSetMaxConnections(message.data?.value ?? 10);
          break;
      }
    });
  }

  /**
   * Try to auto-start (called from extension activation)
   */
  public async tryAutoStart(): Promise<void> {
    this._autoRetryService.setLogCallback((msg, type) => {
      this.sendLog(msg, type === 'warning' ? 'info' : type);
    });

    const cdpAvailable = await this._autoRetryService.isCDPAvailable();

    if (!cdpAvailable) {
      this.sendLog('Auto-start: CDP not available. Please restart IDE with CDP flag.', 'error');
      this.sendStatus();
      return;
    }

    this.sendLog('Auto-starting...', 'info');
    const started = await this._autoRetryService.start();

    if (started) {
      this.sendStatus();
      this.sendLog('✅ Auto Retry started!', 'success');
    } else {
      this.sendLog('Auto-start failed', 'error');
      this.sendStatus();
    }
  }

  /**
   * Update status (called from extension commands)
   */
  public updateStatus(): void {
    this.sendStatus();
  }

  /**
   * Update stats (called when stats change)
   */
  public async updateStats(): Promise<void> {
    await this.sendStats();
  }

  /**
   * Handle start from webview
   */
  private async handleStart(): Promise<void> {
    this.sendLog('Checking CDP...', 'info');

    this._autoRetryService.setLogCallback((msg, type) => {
      this.sendLog(msg, type === 'warning' ? 'info' : type);
    });

    const cdpAvailable = await this._autoRetryService.isCDPAvailable();

    if (!cdpAvailable) {
      this.sendLog('CDP not enabled. Setting up...', 'info');
      const setupSuccess = await this._autoRetryService.setupCDP();

      if (setupSuccess) {
        this.sendLog('Please restart IDE to enable Auto Retry', 'info');
      } else {
        this.sendLog('Setup failed. Check instructions above.', 'error');
      }
      this.sendStatus();
      return;
    }

    this.sendLog('CDP available! Starting...', 'success');
    const started = await this._autoRetryService.start();

    if (started) {
      this.sendStatus();
      vscode.window.showInformationMessage('Auto Retry started - watching for Retry buttons');
    } else {
      this.sendStatus();
    }
  }

  /**
   * Handle stop from webview
   */
  private async handleStop(): Promise<void> {
    await this._autoRetryService.stop();
    this.sendStatus();
    this.sendLog('Stopped', 'info');
  }

  /**
   * Handle toggle from webview
   */
  private async handleToggle(): Promise<void> {
    const status = this._autoRetryService.getStatus();
    if (status.running) {
      await this.handleStop();
    } else {
      await this.handleStart();
    }
  }

  /**
   * Handle CDP setup from webview
   */
  private async handleSetupCDP(): Promise<void> {
    this.sendLog('Setting up CDP...', 'info');
    const success = await this._autoRetryService.setupCDP();
    if (success) {
      this.sendLog('CDP setup complete. Please restart IDE.', 'success');
    } else {
      this.sendLog('CDP setup failed.', 'error');
    }
    this.sendStatus();
  }

  /**
   * Handle set auto-start setting from webview
   */
  private async handleSetAutoStart(enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('ideAutoRetry');
    await config.update('autoStart', enabled, vscode.ConfigurationTarget.Global);
    this.sendLog(enabled ? 'Auto-start enabled' : 'Auto-start disabled', 'info');
  }

  /**
   * Handle set max connections setting from webview
   */
  private async handleSetMaxConnections(value: number): Promise<void> {
    const config = vscode.workspace.getConfiguration('ideAutoRetry');
    await config.update('maxConnections', value, vscode.ConfigurationTarget.Global);
    this.sendLog(`Max connections set to ${value}`, 'info');
    this.sendMaxConnectionsSetting();
  }

  /**
   * Send status to webview
   */
  private sendStatus(): void {
    if (!this._view) return;
    const status = this._autoRetryService.getStatus();
    this._view.webview.postMessage({
      type: 'status',
      data: {
        running: status.running,
        clicks: status.clicks,
        connectionCount: status.connectionCount,
        cdpPort: this._autoRetryService.getCDPPort()
      }
    });
  }

  /**
   * Send stats to webview
   */
  private async sendStats(): Promise<void> {
    if (!this._view) return;
    const stats = await this._autoRetryService.getStats();
    this._view.webview.postMessage({
      type: 'stats',
      data: stats
    });
  }

  /**
   * Send auto-start setting to webview
   */
  private sendAutoStartSetting(): void {
    if (!this._view) return;
    const config = vscode.workspace.getConfiguration('ideAutoRetry');
    const enabled = config.get('autoStart', false);
    this._view.webview.postMessage({
      type: 'autoStartSetting',
      data: { enabled }
    });
  }

  /**
   * Send max connections setting to webview
   */
  private sendMaxConnectionsSetting(): void {
    if (!this._view) return;
    const config = vscode.workspace.getConfiguration('ideAutoRetry');
    const value = config.get('maxConnections', 10);
    this._view.webview.postMessage({
      type: 'maxConnectionsSetting',
      data: { value }
    });
  }

  /**
   * Send log message to webview
   */
  private sendLog(message: string, logType: 'success' | 'error' | 'info'): void {
    if (!this._view) return;
    this._view.webview.postMessage({
      type: 'log',
      data: { message, logType }
    });
  }

  /**
   * Generate HTML for the webview - loads Vite built assets
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const distPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview');
    
    // Get script and style URIs
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'main.js'));
    
    // Check if CSS file exists (Vite may inline styles or create separate file)
    const cssPath = vscode.Uri.joinPath(distPath, 'styles.css');
    const cssExists = fs.existsSync(cssPath.fsPath);
    const styleUri = cssExists ? webview.asWebviewUri(cssPath) : null;

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    ${styleUri ? `<link href="${styleUri}" rel="stylesheet">` : ''}
    <title>IDE Auto Retry</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

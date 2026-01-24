/**
 * IDE Auto Retry - VS Code Extension
 * Auto-click Retry buttons when AI coding agents encounter errors
 */
import * as vscode from 'vscode';
import { AutoRetryService } from './services/AutoRetryService';
import { SidePanelProvider } from './ui/SidePanelProvider';

let autoRetryService: AutoRetryService | undefined;
let sidePanelProvider: SidePanelProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Update status bar item based on current state
 */
function updateStatusBar(): void {
  if (!statusBarItem || !autoRetryService) return;
  
  const status = autoRetryService.getStatus();
  
  if (status.running) {
    // Running state: green dot + click count
    const clickText = status.clicks > 0 ? `: ${status.clicks} clicks` : '';
    statusBarItem.text = `$(circle-filled) IDEAutoRetry${clickText}`;
    statusBarItem.tooltip = `IDE Auto Retry is running\nConnections: ${status.connectionCount}\nClicks: ${status.clicks}\n\nClick to open panel`;
    statusBarItem.color = new vscode.ThemeColor('charts.green');
    statusBarItem.backgroundColor = undefined;
  } else {
    // Stopped state: gray circle
    statusBarItem.text = `$(circle-outline) IDEAutoRetry`;
    statusBarItem.tooltip = 'IDE Auto Retry is stopped\n\nClick to open panel';
    statusBarItem.color = undefined;
    statusBarItem.backgroundColor = undefined;
  }
  
  statusBarItem.show();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('IDE Auto Retry is activating...');

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'ideAutoRetry.openPanel';
  statusBarItem.name = 'IDE Auto Retry Status';
  context.subscriptions.push(statusBarItem);

  // Initialize services
  autoRetryService = new AutoRetryService();

  // Register side panel first (before setting callback)
  sidePanelProvider = new SidePanelProvider(context.extensionUri, autoRetryService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidePanelProvider.viewType,
      sidePanelProvider
    )
  );

  // Set up status bar update callback (also updates panel stats)
  autoRetryService.setStatusUpdateCallback(() => {
    updateStatusBar();
    sidePanelProvider?.updateStats();
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ideAutoRetry.start', async () => {
      try {
        await autoRetryService?.start();
        sidePanelProvider?.updateStatus();
        updateStatusBar();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to start: ${(error as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('ideAutoRetry.stop', async () => {
      try {
        await autoRetryService?.stop();
        sidePanelProvider?.updateStatus();
        updateStatusBar();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to stop: ${(error as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('ideAutoRetry.toggle', async () => {
      const status = autoRetryService?.getStatus();
      if (status?.running) {
        await autoRetryService?.stop();
      } else {
        await autoRetryService?.start();
      }
      sidePanelProvider?.updateStatus();
      updateStatusBar();
    }),

    vscode.commands.registerCommand('ideAutoRetry.setupCDP', async () => {
      await autoRetryService?.setupCDP();
      sidePanelProvider?.updateStatus();
    }),

    vscode.commands.registerCommand('ideAutoRetry.openPanel', () => {
      // Focus the webview view in the sidebar
      vscode.commands.executeCommand('ideAutoRetry.mainPanel.focus');
    })
  );

  // Auto-start if enabled
  const config = vscode.workspace.getConfiguration('ideAutoRetry');
  if (config.get('autoStart', false)) {
    setTimeout(async () => {
      try {
        console.log('[IDE Auto Retry] Auto-starting...');
        await sidePanelProvider?.tryAutoStart();
      } catch (error) {
        console.error('[IDE Auto Retry] Auto-start failed:', error);
      }
    }, 3000);
  }

  // Initialize status bar
  updateStatusBar();

  console.log('IDE Auto Retry activated!');
}

export function deactivate(): void {
  autoRetryService?.stop();
  console.log('IDE Auto Retry deactivated');
}

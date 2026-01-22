/**
 * IDE Auto Retry - VS Code Extension
 * Auto-click Retry buttons when AI coding agents encounter errors
 */
import * as vscode from 'vscode';
import { AutoRetryService } from './services/AutoRetryService';
import { SidePanelProvider } from './ui/SidePanelProvider';

let autoRetryService: AutoRetryService | undefined;
let sidePanelProvider: SidePanelProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('IDE Auto Retry is activating...');

  // Initialize services
  autoRetryService = new AutoRetryService();

  // Register side panel
  sidePanelProvider = new SidePanelProvider(context.extensionUri, autoRetryService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidePanelProvider.viewType,
      sidePanelProvider
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ideAutoRetry.start', async () => {
      try {
        await autoRetryService?.start();
        sidePanelProvider?.updateStatus();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to start: ${(error as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('ideAutoRetry.stop', async () => {
      try {
        await autoRetryService?.stop();
        sidePanelProvider?.updateStatus();
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

  console.log('IDE Auto Retry activated!');
}

export function deactivate(): void {
  autoRetryService?.stop();
  console.log('IDE Auto Retry deactivated');
}

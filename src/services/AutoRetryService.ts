/**
 * AutoRetryService - Main service for Auto Retry functionality
 * 
 * Uses Chrome DevTools Protocol to auto-click Retry buttons
 * Requires IDE to be launched with: --remote-debugging-port=31905
 */
import * as vscode from 'vscode';
import { CDPHandler, CDPLogCallback, CDPStats } from './CDPHandler';
import { Relauncher } from './Relauncher';

export type AutoRetryLogCallback = (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;

export interface AutoRetryConfig {
  enabled: boolean;
  pollInterval: number;
  cooldown: number;
}

export class AutoRetryService {
  private isRunning = false;
  private cdpHandler: CDPHandler;
  private relauncher: Relauncher;
  private logCallback?: AutoRetryLogCallback;
  private statusUpdateCallback?: () => void;
  private pollTimer?: ReturnType<typeof setInterval>;
  private statsTimer?: ReturnType<typeof setInterval>;
  private config: AutoRetryConfig;
  private cachedClicks: number = 0;

  constructor() {
    this.config = this.getConfig();
    this.cdpHandler = new CDPHandler();
    this.relauncher = new Relauncher();
  }

  /**
   * Get configuration from VS Code settings
   */
  private getConfig(): AutoRetryConfig {
    const config = vscode.workspace.getConfiguration('ideAutoRetry');
    return {
      enabled: config.get<boolean>('enabled', true),
      pollInterval: config.get<number>('pollInterval', 1000),
      cooldown: config.get<number>('cooldown', 5000)
    };
  }

  /**
   * Set log callback for UI updates
   */
  public setLogCallback(callback: AutoRetryLogCallback): void {
    this.logCallback = callback;
    this.cdpHandler.setLogCallback(callback as CDPLogCallback);
    this.relauncher.setLogCallback(callback);
  }

  /**
   * Set status update callback for status bar updates
   */
  public setStatusUpdateCallback(callback: () => void): void {
    this.statusUpdateCallback = callback;
    this.cdpHandler.setStatusUpdateCallback(callback);
  }

  /**
   * Log message to callback
   */
  private log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
    console.log(`[AutoRetry] ${message}`);
    this.logCallback?.(message, type);
  }

  /**
   * Check if CDP is available
   */
  public async isCDPAvailable(): Promise<boolean> {
    return await this.cdpHandler.isCDPAvailable();
  }

  /**
   * Get the configured CDP port
   */
  public getCDPPort(): number {
    return this.relauncher.getCDPPort();
  }

  /**
   * Get the CDP flag for launching IDE
   */
  public getCDPFlag(): string {
    return this.relauncher.getCDPFlag();
  }

  /**
   * Check if current process was launched with CDP flag
   */
  public checkCurrentProcessHasFlag(): boolean {
    return this.relauncher.checkCurrentProcessHasFlag();
  }

  /**
   * Start the auto-retry service
   */
  public async start(): Promise<boolean> {
    this.log('Starting Auto Retry...', 'info');

    this.config = this.getConfig();
    const connected = await this.cdpHandler.start({
      pollInterval: this.config.pollInterval,
      bannedCommands: this.getDefaultBannedCommands()
    });

    if (!connected) {
      this.log('Failed to connect to CDP', 'error');
      return false;
    }

    this.isRunning = true;
    this.log(`✅ Auto Retry started!`, 'success');
    this.log(`Connected to ${this.cdpHandler.getConnectionCount()} page(s)`, 'info');

    // Start polling to maintain connection
    this.pollTimer = setInterval(async () => {
      if (!this.isRunning) return;

      await this.cdpHandler.start({
        pollInterval: this.config.pollInterval,
        bannedCommands: this.getDefaultBannedCommands()
      });
    }, 5000);

    // Start stats polling to update status bar
    this.statsTimer = setInterval(async () => {
      if (!this.isRunning) return;

      const stats = await this.cdpHandler.getStats();
      if (stats.clicks !== this.cachedClicks) {
        this.cachedClicks = stats.clicks;
        this.statusUpdateCallback?.();
      }
    }, 2000);

    // Immediately update status bar
    this.statusUpdateCallback?.();

    return true;
  }

  /**
   * Stop the auto-retry service
   */
  public async stop(): Promise<void> {
    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }

    this.cachedClicks = 0;
    await this.cdpHandler.stop();
    this.log('Auto Retry stopped', 'info');

    // Immediately update status bar
    this.statusUpdateCallback?.();
  }

  /**
   * Setup CDP by modifying shortcuts
   */
  public async setupCDP(): Promise<boolean> {
    const result = await this.relauncher.ensureCDPAndPrompt();
    return result.success;
  }

  /**
   * Get service status
   */
  public getStatus(): { running: boolean; clicks: number; connectionCount: number } {
    return {
      running: this.isRunning && this.cdpHandler.isRunning(),
      clicks: this.cachedClicks,
      connectionCount: this.cdpHandler.getConnectionCount()
    };
  }

  /**
   * Get stats from CDP handler
   */
  public async getStats(): Promise<CDPStats> {
    return await this.cdpHandler.getStats();
  }

  /**
   * Reset stats
   */
  public async resetStats(): Promise<CDPStats> {
    return await this.cdpHandler.resetStats();
  }

  /**
   * Default list of dangerous commands to block
   */
  private getDefaultBannedCommands(): string[] {
    return [
      'rm -rf /',
      'rm -rf ~',
      'rm -rf *',
      'format c:',
      'del /f /s /q',
      'rmdir /s /q',
      ':(){:|:&};:',
      'dd if=',
      'mkfs.',
      '> /dev/sda',
      'chmod -R 777 /'
    ];
  }
}

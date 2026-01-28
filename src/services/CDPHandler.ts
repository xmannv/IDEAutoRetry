/**
 * CDPHandler - Chrome DevTools Protocol handler for auto-retry
 * 
 * Uses WebSocket to connect to CDP endpoint and inject auto-click script
 * Port: 31905 (± 3 range for flexibility)
 */
import * as vscode from 'vscode';
import * as http from 'http';

// Dynamic import for ws module
let WebSocket: any;

export interface CDPConfig {
  pollInterval?: number;
  bannedCommands?: string[];
}

export interface CDPStats {
  clicks: number;
  blocked: number;
}

interface CDPConnection {
  ws: any;
  injected: boolean;
  connectedAt: number;  // Timestamp for LRU eviction
}

export type CDPLogCallback = (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;

export class CDPHandler {
  private connections: Map<string, CDPConnection> = new Map();
  private isEnabled: boolean = false;
  private msgId: number = 1;
  private logCallback?: CDPLogCallback;
  private statusUpdateCallback?: () => void;
  private basePort: number;
  private portRange: number;
  private maxConnections: number = 10;  // Default, will be updated on start()
  private pendingMessages: Map<number, { timeout: NodeJS.Timeout; cleanup: () => void }> = new Map();

  constructor() {
    const config = vscode.workspace.getConfiguration('ideAutoRetry');
    this.basePort = config.get('cdpPort', 31905);
    this.portRange = config.get('cdpPortRange', 3);
    // Note: maxConnections is read dynamically in start() to support live updates
  }

  /**
   * Initialize WebSocket module (lazy load)
   */
  private async initWebSocket(): Promise<boolean> {
    if (WebSocket) return true;

    try {
      WebSocket = require('ws');
      return true;
    } catch (e) {
      this.log('WebSocket module not found. Please install: npm install ws', 'error');
      return false;
    }
  }

  /**
   * Set log callback for UI updates
   */
  setLogCallback(callback: CDPLogCallback): void {
    this.logCallback = callback;
  }

  /**
   * Set status update callback for status bar updates
   */
  setStatusUpdateCallback(callback: () => void): void {
    this.statusUpdateCallback = callback;
  }

  /**
   * Log message to callback
   */
  private log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] [CDP] ${message}`);
    if (this.logCallback) {
      this.logCallback(message, type);
    }
  }

  /**
   * Check if any CDP port in the target range is active
   */
  async isCDPAvailable(): Promise<boolean> {
    for (let port = this.basePort - this.portRange; port <= this.basePort + this.portRange; port++) {
      try {
        const pages = await this.getPages(port);
        if (pages.length > 0) {
          this.log(`CDP available on port ${port}`, 'success');
          return true;
        }
      } catch (e) {
        // Port not available, try next
      }
    }
    return false;
  }

  /**
   * Get the port where CDP is active
   */
  async getActivePort(): Promise<number | null> {
    for (let port = this.basePort - this.portRange; port <= this.basePort + this.portRange; port++) {
      try {
        const pages = await this.getPages(port);
        if (pages.length > 0) {
          return port;
        }
      } catch (e) {
        // Port not available
      }
    }
    return null;
  }

  /**
   * Start/maintain the CDP connection and injection loop
   */
  async start(config?: CDPConfig): Promise<boolean> {
    if (!await this.initWebSocket()) {
      return false;
    }

    this.isEnabled = true;
    
    // Read maxConnections from config (supports live updates from panel)
    const vsConfig = vscode.workspace.getConfiguration('ideAutoRetry');
    this.maxConnections = vsConfig.get('maxConnections', 10);
    
    this.log(`Scanning ports ${this.basePort - this.portRange} to ${this.basePort + this.portRange}...`, 'info');

    // Clean up dead connections first
    for (const [id, conn] of this.connections) {
      if (conn.ws.readyState !== 1) { // 1 = OPEN
        this.connections.delete(id);
      }
    }

    let newConnections = 0;

    for (let port = this.basePort - this.portRange; port <= this.basePort + this.portRange; port++) {
      try {
        const pages = await this.getPages(port);
        for (const page of pages) {
          const id = `${port}:${page.id}`;
          
          // If already connected, skip
          if (this.connections.has(id)) {
            // Only inject if not already injected
            const conn = this.connections.get(id);
            if (conn && !conn.injected) {
              await this.inject(id, config);
            }
            continue;
          }
          
          // Need to create new connection
          // If at max, evict oldest connection first (LRU)
          if (this.connections.size >= this.maxConnections) {
            this.evictOldestConnection();
          }
          
          const success = await this.connect(id, page.webSocketDebuggerUrl);
          if (success) {
            newConnections++;
            await this.inject(id, config);
          }
        }
      } catch (e) {
        // Port not available
      }
    }

    const totalConnections = this.connections.size;

    if (totalConnections > 0) {
      this.log(`Connected to ${totalConnections} page(s)`, 'success');
      return true;
    } else {
      this.log('No CDP connections. Is IDE launched with --remote-debugging-port=31905?', 'warning');
      return false;
    }
  }

  /**
   * Stop the CDP handler
   * Fixed: Cleanup all pending messages to prevent memory leaks
   * Fixed: Call __autoRetryStop on pages before closing to cleanup observers
   */
  async stop(): Promise<void> {
    this.isEnabled = false;

    // Cleanup all pending messages first
    for (const [msgId, { timeout, cleanup }] of this.pendingMessages) {
      clearTimeout(timeout);
      cleanup();
    }
    this.pendingMessages.clear();

    // Call __autoRetryStop on each page to cleanup observers before closing
    for (const [id, conn] of this.connections) {
      try {
        if (conn.ws.readyState === 1) { // OPEN
          // Quick evaluate without waiting (fire and forget)
          conn.ws.send(JSON.stringify({
            id: this.msgId++,
            method: 'Runtime.evaluate',
            params: { expression: 'if(window.__autoRetryStop) window.__autoRetryStop()' }
          }));
        }
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    // Give a moment for stop commands to execute, then close
    await new Promise(resolve => setTimeout(resolve, 100));

    for (const [id, conn] of this.connections) {
      try {
        conn.ws.close();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    this.connections.clear();
    this.log('CDP handler stopped', 'info');
  }

  /**
   * Evict the oldest connection (LRU strategy)
   * Called when max connections reached and need to make room for new page
   */
  private evictOldestConnection(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, conn] of this.connections) {
      if (conn.connectedAt < oldestTime) {
        oldestTime = conn.connectedAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      const conn = this.connections.get(oldestId);
      if (conn) {
        try {
          // Call __autoRetryStop on the page before closing
          if (conn.ws.readyState === 1) {
            conn.ws.send(JSON.stringify({
              id: this.msgId++,
              method: 'Runtime.evaluate',
              params: { expression: 'if(window.__autoRetryStop) window.__autoRetryStop()' }
            }));
          }
          conn.ws.close();
        } catch (e) {
          // Ignore errors during eviction
        }
        this.connections.delete(oldestId);
        this.log(`Evicted oldest connection: ${oldestId} (LRU)`, 'info');
      }
    }
  }

  /**
   * Get list of pages from CDP endpoint
   */
  private async getPages(port: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: '127.0.0.1', port, path: '/json/list', timeout: 1000 },
        (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const pages = JSON.parse(body);
              resolve(pages.filter((p: any) =>
                p.webSocketDebuggerUrl &&
                (p.type === 'page' || p.type === 'webview')
              ));
            } catch (e) {
              resolve([]);
            }
          });
        }
      );
      req.on('error', () => resolve([]));
      req.on('timeout', () => {
        req.destroy();
        resolve([]);
      });
    });
  }

  /**
   * Connect to a CDP page via WebSocket
   * Fixed: Added 5s timeout to prevent hanging connections
   */
  private async connect(id: string, url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(url);
        let resolved = false;

        // Timeout after 5 seconds
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.log(`Connection timeout for ${id}`, 'warning');
            try { ws.close(); } catch (e) {}
            resolve(false);
          }
        }, 5000);

        ws.on('open', () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          this.connections.set(id, { ws, injected: false, connectedAt: Date.now() });
          this.log(`Connected to page ${id}`, 'success');
          resolve(true);
        });

        ws.on('error', (err: any) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          this.log(`WebSocket error for ${id}: ${err.message}`, 'error');
          resolve(false);
        });

        ws.on('close', () => {
          // Connection was closed - remove from map and mark for re-injection
          this.connections.delete(id);
          this.log(`Disconnected from page ${id}`, 'info');
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Inject auto-retry script into page
   * OPTIMIZED: Only inject once, script auto-starts. No need to call __autoRetryStart repeatedly.
   */
  private async inject(id: string, config?: CDPConfig): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;

    try {
      if (!conn.injected) {
        // First time: inject script with config embedded
        const script = this.getInjectScript(config);
        await this.evaluate(id, script);
        conn.injected = true;
        this.log(`Script injected into ${id}`, 'success');
        
        // Start the auto-retry (only once after injection)
        const configJson = JSON.stringify(config || {});
        await this.evaluate(id, `if(window.__autoRetryStart) window.__autoRetryStart(${configJson})`);
      }
      // If already injected, do nothing - script is already running
    } catch (e: any) {
      this.log(`Injection failed for ${id}: ${e.message}`, 'error');
    }
  }

  /**
   * Evaluate JavaScript in the page context
   * Fixed: Properly cleanup message listeners on timeout to prevent memory leaks
   */
  private async evaluate(id: string, expression: string): Promise<any> {
    const conn = this.connections.get(id);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      const currentId = this.msgId++;
      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        conn.ws.off('message', onMessage);
        this.pendingMessages.delete(currentId);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('CDP Timeout'));
      }, 5000);

      const onMessage = (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === currentId) {
            clearTimeout(timeout);
            cleanup();
            resolve(msg.result);
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      // Track pending message for cleanup on stop()
      this.pendingMessages.set(currentId, { timeout, cleanup });

      conn.ws.on('message', onMessage);
      conn.ws.send(JSON.stringify({
        id: currentId,
        method: 'Runtime.evaluate',
        params: {
          expression,
          userGesture: true,
          awaitPromise: true
        }
      }));
    });
  }

  /**
   * Get stats from all connected pages
   */
  async getStats(): Promise<CDPStats> {
    const stats: CDPStats = { clicks: 0, blocked: 0 };

    for (const [id] of this.connections) {
      try {
        const res = await this.evaluate(id,
          'JSON.stringify(window.__autoRetryGetStats ? window.__autoRetryGetStats() : {})'
        );
        if (res?.result?.value) {
          const s = JSON.parse(res.result.value);
          stats.clicks += s.clicks || 0;
          stats.blocked += s.blocked || 0;
        }
      } catch (e) {
        // Ignore errors
      }
    }

    return stats;
  }

  /**
   * Reset stats on all connected pages
   */
  async resetStats(): Promise<CDPStats> {
    const stats = await this.getStats();

    for (const [id] of this.connections) {
      try {
        await this.evaluate(id, 'if(window.__autoRetryResetStats) window.__autoRetryResetStats()');
      } catch (e) {
        // Ignore errors
      }
    }

    return stats;
  }

  /**
   * Get number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Check if handler is running
   */
  isRunning(): boolean {
    return this.isEnabled && this.connections.size > 0;
  }

  /**
   * Get the auto-retry inject script
   * @param config Optional config to embed in script
   */
  private getInjectScript(config?: CDPConfig): string {
    return `
(function() {
  // Prevent double-loading
  if (window.__autoRetryLoaded) {
    console.log('[Auto Retry] Already loaded!');
    return;
  }
  window.__autoRetryLoaded = true;

  // Stats tracking
  let stats = { clicks: 0, blocked: 0 };

  // Config
  let config = {
    pollInterval: 1000,
    bannedCommands: [
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
    ]
  };

  let isProcessing = false;
  let pollTimer = null;
  
  // Track observers to prevent accumulation (PERFORMANCE FIX)
  let observers = [];
  let observerSetupDone = false;

  // Only click Retry button
  const RETRY_PATTERN = 'Retry';

  // Check if element is in an error context
  function isErrorContext(element) {
    let el = element;
    for (let i = 0; i < 5 && el; i++) {
      const text = el.textContent || '';
      const className = el.className || '';
      if (text.includes('error') || text.includes('Error') || 
          text.includes('failed') || text.includes('Failed') ||
          text.includes('terminated') || text.includes('Agent terminated') ||
          text.includes('Dismiss') ||
          className.includes('error') || className.includes('alert')) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  // Check if command is dangerous
  function isDangerousCommand(text) {
    const lowerText = text.toLowerCase();
    return config.bannedCommands.some(cmd => 
      lowerText.includes(cmd.toLowerCase())
    );
  }

  // Find and click Retry buttons
  function findAndClickButtons() {
    if (isProcessing) return;
    isProcessing = true;

    try {
      clickButtonsInDocument(document);

      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            clickButtonsInDocument(iframeDoc);
          }
        } catch (e) {
          // Cross-origin iframe, skip
        }
      }
    } catch (e) {
      console.error('[Auto Retry] Error:', e);
    }

    isProcessing = false;
  }

  // Click Retry buttons in a document
  function clickButtonsInDocument(doc) {
    const buttons = doc.querySelectorAll('button, [role="button"]');
    
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      
      if (text !== RETRY_PATTERN) continue;
      
      if (!isErrorContext(btn)) continue;

      const context = btn.closest('.terminal-command, .code-block, [class*="command"]');
      if (context && isDangerousCommand(context.textContent || '')) {
        console.log('[Auto Retry] ⚠️ Blocked dangerous command!');
        stats.blocked++;
        continue;
      }

      btn.click();
      stats.clicks++;
      console.log('[Auto Retry] ✅ Clicked Retry! (Total: ' + stats.clicks + ')');
    }
  }

  // Debounce helper (PERFORMANCE FIX)
  let debounceTimer = null;
  function debouncedFindAndClick() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(findAndClickButtons, 100);
  }

  // Setup MutationObserver - only once per document (PERFORMANCE FIX)
  function setupObserver(doc) {
    // Check if observer already exists for this document
    if (doc.__autoRetryObserver) {
      return;
    }
    
    try {
      const observer = new MutationObserver(debouncedFindAndClick);

      observer.observe(doc.body, {
        childList: true,
        subtree: true
      });

      // Mark document as having observer
      doc.__autoRetryObserver = observer;
      observers.push(observer);

      console.log('[Auto Retry] Observer started');
    } catch (e) {
      console.log('[Auto Retry] Could not setup observer:', e.message);
    }
  }

  // Cleanup all observers (PERFORMANCE FIX)
  function cleanupObservers() {
    for (const observer of observers) {
      try { observer.disconnect(); } catch (e) {}
    }
    observers = [];
    observerSetupDone = false;
    
    // Also clear the marker on documents (FIX: allow re-setup after restart)
    try { delete document.__autoRetryObserver; } catch (e) {}
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) delete iframeDoc.__autoRetryObserver;
      } catch (e) {}
    });
    
    console.log('[Auto Retry] Observers cleaned up');
  }

  // Start auto-retry
  window.__autoRetryStart = function(userConfig) {
    if (userConfig) {
      config = { ...config, ...userConfig };
    }

    findAndClickButtons();
    
    // Only setup observers once (PERFORMANCE FIX)
    if (!observerSetupDone) {
      setupObserver(document);

      document.querySelectorAll('iframe').forEach(iframe => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc?.body) {
            setupObserver(iframeDoc);
          }
        } catch (e) {}
      });
      observerSetupDone = true;
    }

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(findAndClickButtons, config.pollInterval);

    console.log('[Auto Retry] ✅ Started with interval: ' + config.pollInterval + 'ms');
  };

  // Stop auto-retry (PERFORMANCE FIX - now cleans up observers and resets loaded flag)
  window.__autoRetryStop = function() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    cleanupObservers();
    // Reset loaded flag to allow re-injection after restart
    window.__autoRetryLoaded = false;
    console.log('[Auto Retry] Stopped and reset');
  };

  // Get stats
  window.__autoRetryGetStats = function() {
    return stats;
  };

  // Reset stats
  window.__autoRetryResetStats = function() {
    stats = { clicks: 0, blocked: 0 };
  };

  // Get health info (NEW - for debugging)
  window.__autoRetryGetHealth = function() {
    return {
      observerCount: observers.length,
      observerSetupDone: observerSetupDone,
      pollTimerActive: !!pollTimer,
      stats: stats
    };
  };

  console.log('[Auto Retry] ✅ Loaded! Ready to auto-click Retry button on errors.');
})();
`;
  }
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { vscode } from './main'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Play, Square, Settings, RefreshCw, Minus, Plus } from 'lucide-react'

interface StatusData {
  running: boolean
  clicks: number
  connectionCount: number
  cdpPort: number
}

interface LogEntry {
  id: number
  message: string
  type: 'info' | 'success' | 'error'
  timestamp: string
}

function App() {
  const [status, setStatus] = useState<StatusData>({
    running: false,
    clicks: 0,
    connectionCount: 0,
    cdpPort: 31905
  })
  const [autoStart, setAutoStart] = useState(false)
  const [maxConnections, setMaxConnections] = useState(10)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logIdRef = useRef(0)
  const logContainerRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error') => {
    const now = new Date()
    const timestamp = now.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    })
    
    logIdRef.current += 1
    const newId = logIdRef.current
    
    setLogs(currentLogs => {
      const newLogs = [...currentLogs, { id: newId, message, type, timestamp }]
      // Keep only last 50 logs
      return newLogs.slice(-50)
    })
  }, [])

  // Auto-scroll log container to bottom when new logs are added
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    // Request initial status
    vscode.postMessage({ type: 'getStatus' })

    // Listen for messages from extension
    const handleMessage = (event: MessageEvent) => {
      const message = event.data
      
      switch (message.type) {
        case 'status':
          setStatus(message.data)
          break
        case 'stats':
          setStatus(prev => ({ ...prev, clicks: message.data.clicks }))
          break
        case 'log':
          addLog(message.data.message, message.data.logType)
          break
        case 'autoStartSetting':
          setAutoStart(message.data.enabled)
          break
        case 'maxConnectionsSetting':
          setMaxConnections(message.data.value)
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [addLog])

  const handleToggle = () => {
    vscode.postMessage({ type: 'toggle' })
  }

  const handleSetupCDP = () => {
    vscode.postMessage({ type: 'setupCDP' })
  }

  const handleAutoStartChange = (checked: boolean) => {
    setAutoStart(checked)
    vscode.postMessage({ type: 'setAutoStart', data: { enabled: checked } })
  }

  const handleMaxConnectionsChange = (delta: number) => {
    const newValue = Math.max(1, Math.min(50, maxConnections + delta))
    setMaxConnections(newValue)
    vscode.postMessage({ type: 'setMaxConnections', data: { value: newValue } })
  }

  return (
    <div className="dark min-h-screen bg-background p-2">
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-10 bg-white items-center justify-center rounded border border-zinc-700">
            <span className="text-zinc-900 text-[9px] font-black tracking-tight">
              RETRY
            </span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground leading-tight">IDE Auto Retry</h1>
            <p className="text-[10px] text-muted-foreground">Auto-click Retry on AI errors</p>
          </div>
        </div>

        {/* Status Card */}
        <Card className="py-0 gap-1">
          <CardContent className="p-3">
            <div className="flex flex-col items-center gap-2">
              {/* Status Badge */}
              <Badge 
                variant={status.running ? "default" : "secondary"}
                className={`px-2.5 py-1 text-xs font-medium ${
                  status.running 
                    ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
                  status.running ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'
                }`} />
                {status.running ? 'Running' : 'Stopped'}
              </Badge>

              {/* Toggle Button */}
              <Button 
                onClick={handleToggle}
                variant={status.running ? "secondary" : "default"}
                size="sm"
                className="w-full max-w-[160px] gap-1.5 h-8"
              >
                {status.running ? (
                  <>
                    <Square className="h-3 w-3" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" />
                    Start
                  </>
                )}
              </Button>

              {/* Auto-start checkbox */}
              <div className="flex items-center gap-1.5">
                <Checkbox 
                  id="autoStart" 
                  checked={autoStart}
                  onCheckedChange={handleAutoStartChange}
                  className="h-3.5 w-3.5"
                />
                <label 
                  htmlFor="autoStart" 
                  className="text-[11px] text-muted-foreground cursor-pointer"
                >
                  Auto-start on IDE launch
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Card */}
        <Card className="py-0 gap-1">
          <CardHeader className="pb-0 pt-3 px-3">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3" />
              Statistics
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pt-1 pb-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col items-center rounded bg-muted/50 py-1.5 px-2">
                <span className="text-lg font-bold text-foreground leading-tight">{status.clicks}</span>
                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Retries</span>
              </div>
              <div className="flex flex-col items-center rounded bg-muted/50 py-1.5 px-2">
                <span className="text-lg font-bold text-foreground leading-tight">{status.connectionCount}</span>
                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Connections</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Log Card */}
        <Card className="py-0 gap-1">
          <CardHeader className="pb-0 pt-3 px-3">
            <CardTitle className="text-xs font-medium">Activity Log</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pt-1 pb-3">
            <div ref={logContainerRef} className="h-[100px] overflow-y-auto rounded bg-muted/30 p-1.5 font-mono text-[10px]">
              {logs.length === 0 ? (
                <div className="flex h-full items-center justify-center text-muted-foreground italic text-[10px]">
                  Ready to start...
                </div>
              ) : (
                logs.map((log) => (
                  <div 
                    key={log.id} 
                    className={`py-0.5 leading-tight ${
                      log.type === 'success' ? 'text-green-400' :
                      log.type === 'error' ? 'text-red-400' :
                      'text-muted-foreground'
                    }`}
                  >
                    <span className="opacity-50">[{log.timestamp}]</span> {log.message}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Settings Card */}
        <Card className="py-0 gap-0">
          <CardHeader className="pb-0 pt-3 px-3">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5">
              <Settings className="h-3 w-3" />
              Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pt-2 pb-3 space-y-2">
            {/* CDP Port */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">CDP Port:</span>
              <span className="font-mono text-xs font-medium text-foreground">{status.cdpPort}</span>
            </div>
            
            {/* Max Connections */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Max Connections:</span>
              <div className="flex items-center gap-1">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-5 w-5 p-0" 
                  onClick={() => handleMaxConnectionsChange(-1)}
                  disabled={maxConnections <= 1}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="font-mono text-xs font-medium text-foreground w-6 text-center">
                  {maxConnections}
                </span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-5 w-5 p-0" 
                  onClick={() => handleMaxConnectionsChange(1)}
                  disabled={maxConnections >= 50}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            
            {/* Setup CDP Button */}
            <Button variant="outline" size="sm" onClick={handleSetupCDP} className="w-full h-7 text-xs">
              Setup CDP
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App

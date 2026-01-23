# IDE Auto Retry

⚡ **Auto-click Retry buttons when AI coding agents encounter errors.**

Zero-babysitting automation for VS Code, Cursor, and compatible editors.

## Features

- 🔄 **Automatic Retry** - Automatically clicks "Retry" buttons when AI agents (Gemini, Copilot, Claude, etc.) encounter errors
- 🛡️ **Safe by Design** - Blocks dangerous commands before clicking
- 🖥️ **Cross-Platform** - Works on macOS, Windows, and Linux
- 🚀 **Simple UI** - Clean, minimal interface with one-click start/stop
- ⚙️ **Auto-Start** - Option to automatically start when IDE launches

## Requirements

This extension uses Chrome DevTools Protocol (CDP) to interact with the IDE. You need to launch your IDE with a special flag:

```bash
# macOS Antigravity
open -a "Antigravity" --args --remote-debugging-port=31905

# macOS Visual Studio Code
open -a "Visual Studio Code" --args --remote-debugging-port=31905

# Windows Antigravity
antigravity.exe --remote-debugging-port=31905

# Windows Visual Studio Code
code.exe --remote-debugging-port=31905

# Linux Antigravity
antigravity --remote-debugging-port=31905

# Linux Visual Studio Code
code --remote-debugging-port=31905
```

**Or use the built-in Setup:**
1. Click the "Setup CDP" button in the extension panel
2. Follow the platform-specific instructions
3. Restart your IDE

## Usage

1. Open the IDE Auto Retry panel from the Activity Bar (⚡ icon)
2. Click "Start" to begin auto-retrying
3. The extension will automatically click "Retry" buttons when AI errors occur

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ideAutoRetry.enabled` | `true` | Enable the extension |
| `ideAutoRetry.autoStart` | `false` | Auto-start when IDE launches |
| `ideAutoRetry.cdpPort` | `31905` | CDP remote debugging port |
| `ideAutoRetry.cdpPortRange` | `3` | Port range to scan (port ± range) |
| `ideAutoRetry.pollInterval` | `1000` | Interval between checks (ms) |
| `ideAutoRetry.cooldown` | `5000` | Cooldown after clicking (ms) |

## Commands

- `IDE Auto Retry: Start` - Start auto-retry
- `IDE Auto Retry: Stop` - Stop auto-retry
- `IDE Auto Retry: Toggle` - Toggle auto-retry on/off
- `IDE Auto Retry: Setup CDP` - Setup Chrome DevTools Protocol
- `IDE Auto Retry: Open Panel` - Open the extension panel

## How It Works

1. The extension connects to your IDE via Chrome DevTools Protocol
2. It injects a script that monitors for "Retry" buttons in error contexts
3. When a Retry button is found in an error message, it automatically clicks it
4. Dangerous commands are detected and blocked for safety

## Safety Features

The extension includes a blocklist of dangerous commands that will prevent auto-clicking:
- `rm -rf /` and similar destructive commands
- `format c:` and disk formatting commands
- Fork bombs and other malicious patterns

## Troubleshooting

### "CDP not available" error

Your IDE wasn't launched with the required flag. Solutions:
1. Click "Setup CDP" and follow the instructions
2. Restart your IDE with `--remote-debugging-port=31905`

### Extension not clicking Retry

1. Make sure the extension status shows "Running"
2. Check that you have at least 1 connection in the stats
3. Verify the Retry button is in an error context (error message visible)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## Author

Created by [Duc Luong](https://codetay.com)

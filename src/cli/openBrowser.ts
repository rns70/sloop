// Open a URL in the default browser. The command selection is a pure function so it can
// be tested without spawning anything; opening itself is best-effort (failure is logged,
// never fatal — the URL is always printed by the caller).

import { spawn } from 'node:child_process';

export interface OpenCommand {
  cmd: string;
  args: string[];
}

/** Map a node `process.platform` to a browser-open command, or null if unsupported. */
export function browserCommand(platform: NodeJS.Platform | string, url: string): OpenCommand | null {
  switch (platform) {
    case 'darwin':
      return { cmd: 'open', args: [url] };
    case 'win32':
      // Empty title arg so a quoted URL isn't treated as the window title.
      return { cmd: 'cmd', args: ['/c', 'start', '', url] };
    case 'linux':
      return { cmd: 'xdg-open', args: [url] };
    default:
      return null;
  }
}

/** Best-effort: launch the browser, swallowing any failure. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const command = browserCommand(platform, url);
  if (!command) return;
  try {
    const child = spawn(command.cmd, command.args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Non-fatal: the caller already printed the URL.
  }
}

import { exec, execFile } from 'node:child_process'

/**
 * Ejecución de comandos externos con timeout y sin ventanas emergentes.
 *
 * En Windows, los lanzadores `.cmd`/`.bat` (npm, composer…) no se pueden
 * ejecutar directamente con `execFile` desde Node 20; se invocan a través del
 * intérprete de comandos con la ruta entre comillas (admite espacios).
 */

export interface CommandResult {
  ok: boolean
  output: string
  error: string | null
}

const DEFAULT_TIMEOUT = 5000
const MAX_BUFFER = 1024 * 1024

function runFile(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`.trim()
        resolve(
          error ? { ok: false, output, error: error.message } : { ok: true, output, error: null }
        )
      }
    )
  })
}

function runShell(commandLine: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      commandLine,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`.trim()
        resolve(
          error ? { ok: false, output, error: error.message } : { ok: true, output, error: null }
        )
      }
    )
  })
}

export function runCommand(
  command: string,
  args: string[] = [],
  timeoutMs = DEFAULT_TIMEOUT
): Promise<CommandResult> {
  const isWindowsLauncher = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)

  if (isWindowsLauncher) {
    const executable = /\s/.test(command) ? `"${command}"` : command
    return runShell([executable, ...args].join(' '), timeoutMs)
  }

  return runFile(command, args, timeoutMs)
}

/** Nombre del ejecutable según la plataforma (Windows resuelve extensiones). */
export function executableName(base: string): string {
  if (process.platform !== 'win32') return base

  const windowsLaunchers: Record<string, string> = {
    npm: 'npm.cmd',
    yarn: 'yarn.cmd',
    pnpm: 'pnpm.cmd',
    composer: 'composer.bat'
  }
  return windowsLaunchers[base] ?? `${base}.exe`
}

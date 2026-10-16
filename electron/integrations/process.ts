import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

interface ProcessOptions {
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  input?: string;
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

/** Own the complete process group until close, including cancellation and timeout. */
export async function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<string> {
  options.signal.throwIfAborted();
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(options.timeoutMs ?? 21_600_000),
  ]);
  const child = spawn(command, args, {
    env: options.env ?? process.env,
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
    shell: false,
  });
  let failure: Error | undefined;
  let output = "";
  let pending = "";
  let stderr = "";
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const decoder = new StringDecoder("utf8");
  const errors = new StringDecoder("utf8");
  const kill = (force = false): void => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32")
        child.kill(force ? "SIGKILL" : "SIGTERM");
      else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      /* The process may already have exited. */
    }
  };
  const stop = (error: Error): void => {
    failure ??= error;
    kill();
    killTimer ??= setTimeout(() => kill(true), 2_000);
    killTimer.unref();
  };
  const abort = (): void =>
    stop(
      new Error(
        options.signal.aborted
          ? "Operation cancelled."
          : "Operation timed out. Please try again.",
      ),
    );
  signal.addEventListener("abort", abort, { once: true });
  child.stdin.on("error", () => undefined);
  child.stdin.end(options.input);
  try {
    return await new Promise<string>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        try {
          const text = decoder.write(chunk);
          if (!options.onLine) {
            output = (output + text).slice(-64_000);
            return;
          }
          pending += text;
          if (pending.length > 32_000_000)
            throw new Error("The worker returned an oversized response.");
          let newline: number;
          while ((newline = pending.indexOf("\n")) !== -1) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            if (line.trim()) options.onLine(line);
          }
        } catch (error) {
          stop(error instanceof Error ? error : new Error(String(error)));
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + errors.write(chunk)).slice(-16_000);
      });
      child.once("error", (error) => {
        failure = error;
      });
      child.once("close", (code) => {
        try {
          pending += decoder.end();
          stderr += errors.end();
          if (failure) throw failure;
          if (code !== 0)
            throw new Error(
              stderr.trim() || `${command} exited with status ${String(code)}.`,
            );
          if (pending.trim() && options.onLine) options.onLine(pending);
          resolve(output);
        } catch (error) {
          reject(error);
        }
      });
      if (signal.aborted) abort();
    });
  } finally {
    signal.removeEventListener("abort", abort);
    if (killTimer) clearTimeout(killTimer);
    // Descendants must not survive a completed/cancelled worker.
    kill(true);
  }
}

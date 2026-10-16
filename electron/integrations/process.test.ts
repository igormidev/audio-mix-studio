import { describe, expect, it } from "vitest";
import { runProcess } from "./process";

describe("owned local worker processes", () => {
  it("decodes UTF-8 and complete JSON lines across arbitrary process chunks", async () => {
    const lines: string[] = [];
    await runProcess(
      process.execPath,
      [
        "-e",
        'const data=Buffer.from(JSON.stringify({text:"日本語"})+"\\n"); process.stdout.write(data.subarray(0,12));setTimeout(()=>process.stdout.end(data.subarray(12)),10)',
      ],
      {
        signal: new AbortController().signal,
        onLine: (line) => {
          lines.push(line);
        },
      },
    );
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { text: "日本語" },
    ]);
  });

  it("cancels a worker, waits for close and stops its descendant process group", async () => {
    const controller = new AbortController();
    let descendant = 0;
    const pending = runProcess(
      process.execPath,
      [
        "-e",
        'const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log(child.pid);setInterval(()=>{},1000)',
      ],
      {
        signal: controller.signal,
        onLine: (line) => {
          descendant = Number(line);
          controller.abort();
        },
      },
    );
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(descendant).toBeGreaterThan(0);
    expect(() => process.kill(descendant, 0)).toThrow();
  });
});

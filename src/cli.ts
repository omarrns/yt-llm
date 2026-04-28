import { Command } from "commander";
import { resolve } from "node:path";
import { analyze } from "./analyze.js";
import { writeBundle } from "./writeBundle.js";

const program = new Command();

program
  .name("yt-llm")
  .description(
    "YouTube → typed VideoBundle. Captions, metadata, chapters in one validated object.",
  )
  .argument("<url>", "YouTube URL (video, short, or playlist)")
  .option("--output-dir <path>", "output directory", "./output")
  .option("--force", "wipe the per-video output directory before writing")
  .option(
    "--sub-langs <langs>",
    "comma-separated list of yt-dlp subtitle language patterns",
    "en.*",
  )
  .option(
    "--max-entries <n>",
    "max entries to pull from a playlist (default 200, 0 to disable)",
    parsePositiveInt,
  )
  .option(
    "--concurrency <n>",
    "parallel yt-dlp invocations (default 1)",
    parsePositiveInt,
  )
  .option(
    "--socket-timeout <sec>",
    "yt-dlp socket timeout in seconds (default 30)",
    parsePositiveInt,
  )
  .option(
    "--allow-any-host",
    "skip the YouTube hostname allowlist (use only for trusted URLs)",
  )
  .option(
    "--json",
    "print the validated VideoBundle JSON to stdout instead of writing files",
  )
  .action(async (url: string, opts: CliOptions) => {
    const subLangs = opts.subLangs.split(",").map((s) => s.trim());
    const result = await analyze(url, {
      subLangs,
      ...(opts.maxEntries !== undefined ? { maxEntries: opts.maxEntries } : {}),
      ...(opts.concurrency !== undefined
        ? { concurrency: opts.concurrency }
        : {}),
      ...(opts.socketTimeout !== undefined
        ? { socketTimeout: opts.socketTimeout }
        : {}),
      ...(opts.allowAnyHost ? { allowedHosts: "any" as const } : {}),
    });

    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          { bundles: result.bundles, errors: result.errors },
          null,
          2,
        ) + "\n",
      );
    } else {
      const outputDir = resolve(opts.outputDir);
      for (const bundle of result.bundles) {
        const written = writeBundle(bundle, {
          outputDir,
          rawInfo: result.raw[bundle.source.id],
          force: opts.force,
        });
        process.stderr.write(
          `OK: ${bundle.source.id} -> ${written.outputDir}\n`,
        );
      }
    }

    for (const err of result.errors) {
      const tag = err.kind ? `[${err.kind}] ` : "";
      process.stderr.write(`WARN: ${tag}${err.id}: ${err.reason}\n`);
    }

    if (result.bundles.length === 0 && result.errors.length > 0) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

function parsePositiveInt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`expected a non-negative integer, got "${value}"`);
  }
  return n;
}

type CliOptions = {
  outputDir: string;
  force?: boolean;
  subLangs: string;
  maxEntries?: number;
  concurrency?: number;
  socketTimeout?: number;
  allowAnyHost?: boolean;
  json?: boolean;
};

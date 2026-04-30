import { Command } from "commander";
import { resolve } from "node:path";
import { analyze } from "./analyze.js";
import { writeBundle } from "./writeBundle.js";

export type CliOptions = {
  outputDir: string;
  force?: boolean;
  subLangs: string;
  maxEntries?: number;
  concurrency?: number;
  socketTimeout?: number;
  allowAnyHost?: boolean;
  json?: boolean;
  withComments?: boolean;
  maxComments?: number;
  commentSort?: "top" | "new";
};

const DEFAULT_MAX_COMMENTS = 500;
const DEFAULT_COMMENT_SORT: "top" = "top";

/**
 * Pure entrypoint for the CLI action. Returns the exit code instead of setting
 * `process.exitCode` directly so tests can call this without spinning up
 * commander or asserting on global state. The bin shell (src/cli-bin.ts)
 * builds a commander program around this and assigns the exit code.
 */
export async function runCli(url: string, opts: CliOptions): Promise<number> {
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
    ...(opts.withComments
      ? {
          comments: {
            max: opts.maxComments ?? DEFAULT_MAX_COMMENTS,
            sort: opts.commentSort ?? DEFAULT_COMMENT_SORT,
          },
        }
      : {}),
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
      try {
        const written = writeBundle(bundle, {
          outputDir,
          rawInfo: result.raw[bundle.source.id],
          force: opts.force,
        });
        process.stderr.write(
          `OK: ${bundle.source.id} -> ${written.outputDir}\n`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        result.errors.push({
          id: bundle.source.id,
          kind: "video",
          reason: `writeBundle failed: ${reason}`,
        });
      }
    }
  }

  for (const err of result.errors) {
    const tag = err.kind ? `[${err.kind}] ` : "";
    process.stderr.write(`WARN: ${tag}${err.id}: ${err.reason}\n`);
  }

  return result.bundles.length === 0 && result.errors.length > 0 ? 1 : 0;
}

export function parseNonNeg(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`expected a non-negative integer, got "${value}"`);
  }
  return n;
}

export function parsePositive(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`expected a positive integer (>=1), got "${value}"`);
  }
  return n;
}

export function parseCommentSort(value: string): "top" | "new" {
  if (value !== "top" && value !== "new") {
    throw new Error(`expected "top" or "new", got "${value}"`);
  }
  return value;
}

export function buildProgram(): Command {
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
      parseNonNeg,
    )
    .option(
      "--concurrency <n>",
      "parallel yt-dlp invocations (default 1)",
      parsePositive,
    )
    .option(
      "--socket-timeout <sec>",
      "yt-dlp socket timeout in seconds (default 30)",
      parsePositive,
    )
    .option(
      "--allow-any-host",
      "skip the YouTube hostname allowlist (use only for trusted URLs)",
    )
    .option(
      "--json",
      "print the validated VideoBundle JSON to stdout instead of writing files",
    )
    .option(
      "--with-comments",
      "fetch top-level comments + replies (separate yt-dlp call; opt-in)",
    )
    .option(
      "--max-comments <n>",
      "cap on total comments fetched per video (default 500)",
      parsePositive,
    )
    .option(
      "--comment-sort <sort>",
      'comment ordering: "top" or "new" (default "top")',
      parseCommentSort,
    )
    .action(async (url: string, opts: CliOptions) => {
      process.exitCode = await runCli(url, opts);
    });
  return program;
}

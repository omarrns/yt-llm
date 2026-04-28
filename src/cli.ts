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
  .option("--with-comments", "include yt-dlp comments in the underlying fetch")
  .option(
    "--sub-langs <langs>",
    "comma-separated list of yt-dlp subtitle language patterns",
    "en.*",
  )
  .option(
    "--json",
    "print the validated VideoBundle JSON to stdout instead of writing files",
  )
  .action(async (url: string, opts: CliOptions) => {
    const subLangs = opts.subLangs.split(",").map((s) => s.trim());
    const result = await analyze(url, {
      subLangs,
      withComments: opts.withComments,
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
      process.stderr.write(`WARN: ${err.id}: ${err.reason}\n`);
    }

    if (result.bundles.length === 0 && result.errors.length > 0) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

type CliOptions = {
  outputDir: string;
  force?: boolean;
  withComments?: boolean;
  subLangs: string;
  json?: boolean;
};

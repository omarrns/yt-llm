import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyze } from "../analyze.js";
import { DEFAULT_ALLOWED_HOSTS, isAllowedHost } from "../url.js";
import pkg from "../../package.json" with { type: "json" };

export type AnalyzeToolInput = {
  url: string;
  subLangs?: string[];
};

export type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

/**
 * Pure handler for the `analyze_youtube_video` tool. Exported so tests can
 * exercise the host-allowlist branch and the success path without spinning up
 * a transport.
 */
export async function analyzeTool({
  url,
  subLangs,
}: AnalyzeToolInput): Promise<ToolResult> {
  if (!isAllowedHost(url, DEFAULT_ALLOWED_HOSTS)) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              bundles: [],
              errors: [
                {
                  id: url,
                  kind: "playlist",
                  reason: `url host not in YouTube allowlist (allowed: ${DEFAULT_ALLOWED_HOSTS.join(", ")})`,
                },
              ],
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  const result = await analyze(url, subLangs ? { subLangs } : {});
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { bundles: result.bundles, errors: result.errors },
          null,
          2,
        ),
      },
    ],
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "yt-llm",
    version: pkg.version,
  });

  server.registerTool(
    "analyze_youtube_video",
    {
      title: "Analyze YouTube video",
      description:
        "Fetch metadata, chapters, and captions for a YouTube URL (video, short, or playlist). Returns a typed VideoBundle JSON object designed for LLM pipelines. Captions only in v0.1; videos without captions return transcript: null. URLs are validated against a YouTube hostname allowlist; any other host is rejected without a network call.",
      inputSchema: {
        url: z.string().url().describe("YouTube video, short, or playlist URL"),
        subLangs: z
          .array(z.string())
          .optional()
          .describe(
            'yt-dlp subtitle language patterns (e.g. ["en.*", "es"]). Defaults to ["en.*"].',
          ),
      },
    },
    analyzeTool,
  );

  return server;
}

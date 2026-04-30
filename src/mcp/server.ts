import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyze } from "../analyze.js";
import { DEFAULT_ALLOWED_HOSTS, isAllowedHost } from "../url.js";
import pkg from "../../package.json" with { type: "json" };

export type AnalyzeToolInput = {
  url: string;
  subLangs?: string[];
  withComments?: boolean;
  maxComments?: number;
  commentSort?: "top" | "new";
};

const MCP_MAX_COMMENTS_CAP = 2000;
const DEFAULT_MAX_COMMENTS = 500;

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
  withComments,
  maxComments,
  commentSort,
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
  // Hard cap on the MCP surface: agentic callers should not be able to trigger
  // 50k-comment dumps that would burn hours of yt-dlp time before the agent
  // loop notices. CLI callers can still override at the lib level.
  const result = await analyze(url, {
    ...(subLangs ? { subLangs } : {}),
    ...(withComments
      ? {
          comments: {
            max: Math.min(
              maxComments ?? DEFAULT_MAX_COMMENTS,
              MCP_MAX_COMMENTS_CAP,
            ),
            sort: commentSort ?? "top",
          },
        }
      : {}),
  });
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
        'Fetch metadata, chapters, captions, and (optionally) comments for a YouTube URL (video, short, or playlist). Returns a typed VideoBundle JSON object designed for LLM pipelines. Captions-only transcript in v0.1; videos without captions return transcript: null. Comments are off by default — set withComments: true to fetch them in a separate yt-dlp call (slow, rate-limit prone); maxComments is server-clamped to 2000. Comment-fetch failures surface as kind: "comments" in errors[] and the bundle still ships with comments: null. URLs are validated against a YouTube hostname allowlist; any other host is rejected without a network call.',
      inputSchema: {
        url: z.string().url().describe("YouTube video, short, or playlist URL"),
        subLangs: z
          .array(z.string())
          .optional()
          .describe(
            'yt-dlp subtitle language patterns (e.g. ["en.*", "es"]). Defaults to ["en.*"].',
          ),
        withComments: z
          .boolean()
          .optional()
          .describe(
            "Opt in to comment fetching (separate yt-dlp invocation, slow, rate-limit prone). Default: false.",
          ),
        maxComments: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            `Cap on comments fetched per video. Default ${DEFAULT_MAX_COMMENTS}; server clamps to ${MCP_MAX_COMMENTS_CAP} regardless of input.`,
          ),
        commentSort: z
          .enum(["top", "new"])
          .optional()
          .describe('Comment ordering. Default "top".'),
      },
    },
    analyzeTool,
  );

  return server;
}

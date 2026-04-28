import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyze } from "../analyze.js";

const server = new McpServer({
  name: "yt-llm",
  version: "0.1.0",
});

server.registerTool(
  "analyze_youtube_video",
  {
    title: "Analyze YouTube video",
    description:
      "Fetch metadata, chapters, and captions for a YouTube URL (video, short, or playlist). Returns a typed VideoBundle JSON object designed for LLM pipelines. Captions only in v0.1; videos without captions return transcript: null.",
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
  async ({ url, subLangs }) => {
    const result = await analyze(url, { subLangs });
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
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

import { z } from "zod";

export const ChapterSchema = z.object({
  startSec: z.number(),
  title: z.string(),
});

export const TranscriptSegmentSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
});

export const TranscriptParagraphSchema = z.object({
  startSec: z.number(),
  text: z.string(),
});

export const TranscriptSourceSchema = z.enum([
  "captions",
  "whisper",
  "deepgram",
  "openai",
]);

export const TranscriptSchema = z.object({
  source: TranscriptSourceSchema,
  sourceDetail: z.string().nullable(),
  language: z.string(),
  full: z.string(),
  segments: z.array(TranscriptSegmentSchema),
  paragraphs: z.array(TranscriptParagraphSchema),
});

export const VideoMetaSchema = z.object({
  title: z.string(),
  channel: z.string(),
  channelId: z.string().nullable(),
  channelUrl: z.string().nullable(),
  uploader: z.string().nullable(),
  uploadedAt: z.string().nullable(),
  durationSec: z.number(),
  durationString: z.string().nullable(),
  views: z.number().nullable(),
  likeCount: z.number().nullable(),
  commentCount: z.number().nullable(),
  description: z.string(),
  tags: z.array(z.string()),
  categories: z.array(z.string()),
  thumbnailUrl: z.string().nullable(),
  isLive: z.boolean(),
  wasLive: z.boolean(),
  liveStatus: z.string().nullable(),
  ageLimit: z.number(),
  availability: z.string().nullable(),
});

export const VideoSourceSchema = z.object({
  url: z.string(),
  id: z.string(),
  platform: z.literal("youtube"),
});

export const VideoBundleSchema = z.object({
  source: VideoSourceSchema,
  meta: VideoMetaSchema,
  chapters: z.array(ChapterSchema),
  transcript: TranscriptSchema.nullable(),
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type TranscriptParagraph = z.infer<typeof TranscriptParagraphSchema>;
export type TranscriptSource = z.infer<typeof TranscriptSourceSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type VideoMeta = z.infer<typeof VideoMetaSchema>;
export type VideoSource = z.infer<typeof VideoSourceSchema>;
export type VideoBundle = z.infer<typeof VideoBundleSchema>;

export type AnalyzeError = { id: string; reason: string };
export type AnalyzeResult = {
  bundles: VideoBundle[];
  errors: AnalyzeError[];
  /** Raw, unfiltered yt-dlp info per video id. Loosely typed to keep the public surface clean — used by `writeBundle()` to emit `raw.info.json` for parity with the Python script. */
  raw: Record<string, unknown>;
};

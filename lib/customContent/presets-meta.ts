import type { CustomContentFieldType } from "@/lib/db/customContentEntities";

// Client-safe preset definitions (no server imports) — presets.ts adds the server-side create.

export type ContentPresetId = "videos" | "stories" | "events";

type PresetField = { name: string; key: string; type: CustomContentFieldType; required?: boolean };

export const CONTENT_PRESETS: Record<ContentPresetId, { name: string; slug: string; blurb: string; fields: PresetField[] }> = {
  videos: {
    name: "Videos",
    slug: "videos",
    blurb: "A gallery of videos, each with a title and description.",
    fields: [
      { name: "Title", key: "title", type: "text", required: true },
      { name: "Description", key: "description", type: "textarea" },
      { name: "Video", key: "video", type: "video", required: true },
      { name: "Thumbnail", key: "image", type: "image_url" },
    ],
  },
  stories: {
    name: "Stories",
    slug: "stories",
    blurb: "Stories with a title, a summary, a picture and/or a video, and the full text.",
    fields: [
      { name: "Title", key: "title", type: "text", required: true },
      { name: "Summary", key: "description", type: "textarea" },
      { name: "Story", key: "body", type: "richtext" },
      { name: "Picture", key: "image", type: "image_url" },
      { name: "Video", key: "video", type: "video" },
      { name: "Shared by", key: "author", type: "text" },
    ],
  },
  events: {
    name: "Happenings",
    slug: "happenings",
    blurb: "Upcoming events. Past events hide themselves.",
    fields: [
      { name: "Title", key: "title", type: "text", required: true },
      { name: "Description", key: "description", type: "textarea" },
      { name: "Starts", key: "date", type: "datetime", required: true },
      { name: "Location", key: "location", type: "text" },
      { name: "Picture", key: "image", type: "image_url" },
      { name: "More info link", key: "link", type: "url" },
    ],
  },
};


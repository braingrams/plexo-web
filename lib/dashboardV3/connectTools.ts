/**
 * The "Connect AI tools" cards: one per tool, one link to copy, three plain steps. The
 * technical connection details stay in `advanced`, tucked away. Pure.
 */
export type ConnectToolId = "claude" | "chatgpt" | "cursor";

export type ConnectTool = {
  id: ConnectToolId;
  name: string;
  tagline: string;
  steps: [string, string, string];
  /** What the link is called inside the tool, for the person to type. */
  connectionName: string;
  advancedTitle: string;
};

export const CONNECT_TOOLS: ConnectTool[] = [
  {
    id: "claude",
    name: "Claude",
    tagline: "Chat with Claude and watch your site change.",
    connectionName: "Plexo",
    steps: [
      "Open Claude, then Customize, then Connectors.",
      "Choose Add custom connector. Type Plexo as the name and paste your link.",
      "Sign in to Plexo when asked. Then ask Claude for what you want, like “make me a pricing page”.",
    ],
    advancedTitle: "Connection details",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    tagline: "Ask ChatGPT to build and edit your pages.",
    connectionName: "Plexo",
    steps: [
      "Open ChatGPT, then Settings, then Apps. Turn on Developer mode if it asks.",
      "Choose Create app. Type Plexo as the name and paste your link.",
      "Sign in to Plexo when asked. Then ask ChatGPT for what you want, like “write a new about page”.",
    ],
    advancedTitle: "Connection details",
  },
  {
    id: "cursor",
    name: "Cursor",
    tagline: "For when you like to work in a code editor.",
    connectionName: "plexo",
    steps: [
      "Open Cursor, then Settings, then MCP.",
      "Choose Add new server. Type plexo as the name and paste your link.",
      "Sign in to Plexo when asked. Then ask Cursor to work on your site.",
    ],
    advancedTitle: "Use a key instead of signing in",
  },
];

export const mcpUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, "")}/api/v1/mcp`;

/** The config file for editors that start Plexo themselves with an API key (Cursor, Windsurf, Claude Desktop). */
export function editorConfig(baseUrl: string, apiKey: string): string {
  return JSON.stringify({ mcpServers: { plexo: { command: "npx", args: ["-y", "@charisol/plexo-mcp"], env: { PLEXO_API_KEY: apiKey, PLEXO_BASE_URL: baseUrl.replace(/\/+$/, "") } } } }, null, 2);
}

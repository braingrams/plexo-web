import type { AdvancedSectionId } from "./hubAdvanced";

/**
 * The app editor used to show Data, People, Settings, History, GitHub, Server code and Secret keys itself. The app's own page
 * already has every one of them (Advanced), so on the full view the editor just links there. Keys are the editor's tab names
 * (and the old ?panel= names) and values are the section on the app's page.
 */
export const HUB_SECTION_FOR_PANEL: Record<string, AdvancedSectionId> = {
  database: "data",
  data: "data",
  users: "users",
  people: "users",
  settings: "appsettings",
  history: "history",
  github: "appgithub",
  functions: "functions",
  secrets: "secrets",
};

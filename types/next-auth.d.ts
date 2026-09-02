import { DefaultSession } from "next-auth";

// Auth.js doesn't put `id` on session.user by default (verified — a deliberate omission,
// not a bug), even though server/authDynamo.ts's session callback adds it at runtime.
// Every call site across the app that reads session.user.id needs this augmentation to
// see it as non-optional, matching what the callback actually guarantees.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

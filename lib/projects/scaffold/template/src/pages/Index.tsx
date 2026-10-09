import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Index() {
  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-b from-background to-accent/40 px-6">
      <div className="max-w-xl text-center space-y-6">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <Sparkles className="size-7" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Your app starts here</h1>
        <p className="text-lg text-muted-foreground">
          Describe what you want to build and Plexo will build it — pages, data, sign-in, and all.
        </p>
        <Button size="lg">Get started</Button>
      </div>
    </main>
  );
}

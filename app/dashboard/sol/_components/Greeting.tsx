function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  return fullName.trim().split(/\s+/)[0] || null;
}

/** The empty-state greeting shown above a new, unstarted chat — "Good afternoon,
 * Oluwabukunmi!" style, matching how ChatGPT/Claude.ai greet you before your first message
 * in a thread. `name` is threaded down from the page's own server-side `session.user.name`
 * (see SolChatView/the sol page.tsx files) rather than fetched client-side: this used to
 * call `/api/v1/profile` on mount, but that endpoint does a full fan-out over every
 * template + a per-template domain-count query just to compute credit/domain-limit data
 * this component never needed — genuinely slow, and the actual cause of the name visibly
 * popping in a beat after the rest of the page. Reading it straight off the session that
 * already resolved server-side is instant and needs no loading state at all. */
export function Greeting({ name }: { name: string | null }) {
  const first = firstName(name);
  return (
    <h1
      style={{
        fontFamily: "var(--font-heading), sans-serif",
        fontWeight: 700,
        fontSize: "1.7rem",
        color: "#f3f0fa",
        textAlign: "center",
        margin: 0,
        letterSpacing: "-0.01em",
      }}
    >
      {timeOfDayGreeting()}
      {first ? `, ${first}` : ""}!
    </h1>
  );
}

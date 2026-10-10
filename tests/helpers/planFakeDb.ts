// A tiny in-memory stand-in for the ElectroDB entities the plan lifecycle touches (User,
// Member, Template, PublishedDomain) — enough of the builder API (get/patch/set/remove/
// where/create/query) to run lib/plan end to end, including the raw UpdateCommand
// sitesStore uses to flip a page's publish flags without touching its updatedAt.

type Row = Record<string, unknown>;

export type FakeDb = ReturnType<typeof createFakeDb>;

class ConditionalCheckFailed extends Error {
  name = "ConditionalCheckFailedException";
}

// where((attr, op) => `${op.notExists(attr.x)} OR ${op.lt(attr.x, v)}`) — clauses are
// encoded as JSON so the expression string the code builds can be evaluated here.
const attrProxy = new Proxy({}, { get: (_t, name) => String(name) }) as Record<string, string>;
const ops = {
  notExists: (a: string) => JSON.stringify({ op: "notExists", a }),
  eq: (a: string, v: unknown) => JSON.stringify({ op: "eq", a, v }),
  ne: (a: string, v: unknown) => JSON.stringify({ op: "ne", a, v }),
  lt: (a: string, v: unknown) => JSON.stringify({ op: "lt", a, v }),
};
function evaluate(expr: string, row: Row): boolean {
  return expr.split(" OR ").some((clause) => {
    const c = JSON.parse(clause) as { op: string; a: string; v?: unknown };
    const value = row[c.a];
    if (c.op === "notExists") return value === undefined;
    if (c.op === "eq") return value === c.v;
    if (c.op === "ne") return value !== c.v;
    if (c.op === "lt") return value !== undefined && String(value) < String(c.v);
    return false;
  });
}

function patcher(find: () => Row | undefined, onWrite?: (row: Row) => void) {
  let sets: Row = {};
  let removes: string[] = [];
  let condition: ((attr: Record<string, string>, op: typeof ops) => string) | null = null;
  const builder = {
    set(values: Row) {
      sets = { ...sets, ...values };
      return builder;
    },
    remove(names: string[]) {
      removes = [...removes, ...names];
      return builder;
    },
    where(cb: (attr: Record<string, string>, op: typeof ops) => string) {
      condition = cb;
      return builder;
    },
    async go() {
      const row = find();
      if (!row) throw new ConditionalCheckFailed("item does not exist");
      if (condition && !evaluate(condition(attrProxy, ops), row)) throw new ConditionalCheckFailed("condition failed");
      Object.assign(row, sets);
      for (const name of removes) delete row[name];
      onWrite?.(row);
      return { data: row };
    },
  };
  return builder;
}

export function createFakeDb() {
  const users = new Map<string, Row>();
  const members: Row[] = [];
  const templates = new Map<string, Row>();
  const domains: Row[] = [];
  const clock = { tick: 0 };
  const stamp = () => new Date(Date.UTC(2026, 9, 10, 12, 0, clock.tick++)).toISOString();

  const User = {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: users.has(id) ? { ...users.get(id)! } : null }) }),
    patch: ({ id }: { id: string }) => patcher(() => users.get(id)),
    scan: { go: async () => ({ data: [...users.values()].map((u) => ({ ...u })), cursor: null }) },
  };
  const Member = {
    query: { byUser: ({ userId }: { userId: string }) => ({ go: async () => ({ data: members.filter((m) => m.userId === userId) }) }) },
  };
  const Template = {
    get: ({ id }: { id: string }) => ({
      go: async () => ({ data: templates.has(id) ? { ...templates.get(id)! } : null }),
      params: () => ({ TableName: "content", Key: { pk: `template#${id}`, sk: "template" } }),
    }),
    // An ElectroDB patch stamps updatedAt (watch: "*") — the fake does too, so a test can
    // prove the lifecycle's page writes DON'T go through it.
    patch: ({ id }: { id: string }) => patcher(() => templates.get(id), (row) => (row.updatedAt = stamp())),
    query: {
      byOrg: ({ organizationId }: { organizationId: string }) => ({
        go: async () => ({ data: [...templates.values()].filter((t) => t.organizationId === organizationId).map((t) => ({ ...t })) }),
      }),
      byParent: ({ parentId }: { parentId: string }) => ({
        go: async () => ({ data: [...templates.values()].filter((t) => t.parentId === parentId).map((t) => ({ ...t })) }),
      }),
    },
  };
  const PublishedDomain = {
    get: ({ templateId, id }: { templateId: string; id: string }) => ({
      go: async () => ({ data: domains.find((d) => d.templateId === templateId && d.id === id) ?? null }),
    }),
    patch: ({ templateId, id }: { templateId: string; id: string }) => patcher(() => domains.find((d) => d.templateId === templateId && d.id === id)),
    create: (item: Row) => ({
      go: async () => {
        if (domains.some((d) => d.domain === item.domain)) throw new ConditionalCheckFailed("exists");
        domains.push({ active: true, ...item });
        return { data: item };
      },
    }),
    query: {
      primary: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: domains.filter((d) => d.templateId === templateId).map((d) => ({ ...d })) }) }),
      byDomain: ({ domain }: { domain: string }) => ({ go: async () => ({ data: domains.filter((d) => d.domain === domain).map((d) => ({ ...d })) }) }),
    },
  };

  // Raw UpdateCommand (lib/plan/sitesStore.ts setPagePublishFlags).
  async function send(command: { input: { Key: { pk: string }; UpdateExpression: string; ExpressionAttributeValues: Row } }) {
    const id = command.input.Key.pk.replace(/^template#/, "");
    const row = templates.get(id);
    if (!row) throw new ConditionalCheckFailed("missing");
    const values = command.input.ExpressionAttributeValues;
    row.isPublished = values[":p"];
    if (command.input.UpdateExpression.includes("REMOVE")) delete row.planArchivedAt;
    else row.planArchivedAt = values[":a"];
    return {};
  }

  return { users, members, templates, domains, User, Member, Template, PublishedDomain, docClient: { send } };
}

/** One shared instance: every vi.mock factory and the test itself import this same object. */
export const fakeDb = createFakeDb();

export function resetFakeDb(): void {
  fakeDb.users.clear();
  fakeDb.members.length = 0;
  fakeDb.templates.clear();
  fakeDb.domains.length = 0;
}

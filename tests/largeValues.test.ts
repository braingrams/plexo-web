import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { HttpResponse } from "@smithy/protocol-http";
import { Entity } from "electrodb";
import { OFFLOAD_MIN_CHARS, markerFor, setValueBackend, withLargeValues, type ValueBackend } from "@/lib/db/largeValues";

// "No row is ever too big": big text values leave the row for storage and come back whole on read, through the real
// DynamoDB document client (with a stand-in for the network), so this proves the wiring and not just the helpers.

const objects = new Map<string, Buffer>();
const backend: ValueBackend = {
  put: vi.fn(async (hash, gz) => void objects.set(hash, gz)),
  get: vi.fn(async (hash) => objects.get(hash) ?? null),
};

// A minimal DynamoDB: PutItem / GetItem / Query / UpdateItem over an in-memory table, speaking the wire format.
const table = new Map<string, Record<string, unknown>>();
const wire: Array<{ target: string; body: any }> = [];
const fakeHandler = {
  async handle(request: { headers: Record<string, string>; body: string }) {
    const target = request.headers["x-amz-target"].split(".")[1];
    const body = JSON.parse(request.body);
    wire.push({ target, body });
    let out: unknown = {};
    const keyOf = (o: any) => (o.pk ?? o.id).S as string;
    if (target === "PutItem") table.set(keyOf(body.Item), body.Item);
    else if (target === "GetItem") out = { Item: table.get(keyOf(body.Key)) };
    else if (target === "Query") out = { Items: [...table.values()], Count: table.size };
    else if (target === "UpdateItem") {
      const row: Record<string, unknown> = table.get(body.Key.id.S) ?? { id: body.Key.id };
      const [name] = Object.values(body.ExpressionAttributeNames ?? {}) as string[];
      const [value] = Object.values(body.ExpressionAttributeValues ?? {}) as unknown[];
      row[name] = value;
      table.set(body.Key.id.S, row);
    }
    return { response: new HttpResponse({ statusCode: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: Readable.from([Buffer.from(JSON.stringify(out))]) }) };
  },
  updateHttpClientConfig() {},
  httpHandlerConfigs: () => ({}),
};

function client() {
  const ddb = new DynamoDB({ region: "us-east-1", credentials: { accessKeyId: "x", secretAccessKey: "y" }, requestHandler: fakeHandler as never });
  return withLargeValues(DynamoDBDocument.from(ddb, { marshallOptions: { removeUndefinedValues: true } }));
}

const big = (n: number, seed = "a") => seed.repeat(n);

beforeEach(() => {
  objects.clear();
  table.clear();
  wire.length = 0;
  vi.mocked(backend.put).mockClear();
  vi.mocked(backend.get).mockClear();
  setValueBackend(backend);
});

describe("big values leave the row and come back whole", () => {
  it("a value over the limit is stored outside, the row keeps a short marker, and a read returns the original", async () => {
    const db = client();
    const text = big(OFFLOAD_MIN_CHARS * 20);
    await db.put({ TableName: "t", Item: { id: "p1", title: "Home", designJson: text } });
    const stored = wire[0].body.Item;
    expect(stored.title.S).toBe("Home");
    expect(stored.designJson.S).toMatch(/^plx-value:v1:[a-f0-9]{64}:\d+$/);
    expect(JSON.stringify(wire[0].body).length).toBeLessThan(1000);
    expect(objects.size).toBe(1);
    const { Item } = await db.get({ TableName: "t", Key: { id: "p1" } });
    expect(Item).toEqual({ id: "p1", title: "Home", designJson: text });
  });

  it("holds far more than a row could: several multi-megabyte values in one item", async () => {
    const db = client();
    const item = { id: "p2", designJson: big(3_000_000, "d"), draftJson: big(3_000_000, "e"), compiledHtml: big(4_000_000, "h"), draftHtml: big(4_000_000, "i") };
    await db.put({ TableName: "t", Item: item });
    expect(JSON.stringify(wire[0].body).length).toBeLessThan(2000); // ~14 MB of text, a 400 KB limit, and the row is tiny
    const { Item } = await db.get({ TableName: "t", Key: { id: "p2" } });
    expect(Item).toEqual(item);
  });

  it("small values never touch storage, and rows written before this existed read exactly as they were", async () => {
    const db = client();
    await db.put({ TableName: "t", Item: { id: "s", note: big(OFFLOAD_MIN_CHARS) } });
    expect(backend.put).not.toHaveBeenCalled();
    table.set("old", { id: { S: "old" }, designJson: { S: big(150_000, "z") } }); // an old row, stored inline
    const { Item } = await db.get({ TableName: "t", Key: { id: "old" } });
    expect(Item!.designJson).toBe(big(150_000, "z"));
    expect(backend.get).not.toHaveBeenCalled();
  });

  it("works for updates and for lists of rows too", async () => {
    const db = client();
    await db.put({ TableName: "t", Item: { id: "u1", n: 1 } });
    const text = big(500_000, "q");
    await db.update({ TableName: "t", Key: { id: "u1" }, UpdateExpression: "SET #d = :d", ExpressionAttributeNames: { "#d": "draftJson" }, ExpressionAttributeValues: { ":d": text } });
    expect(JSON.stringify(wire.at(-1)!.body)).not.toContain("qqqq");
    const { Items } = await db.query({ TableName: "t", KeyConditionExpression: "id = :i", ExpressionAttributeValues: { ":i": "u1" } });
    expect(Items![0].draftJson).toBe(text);
  });

  it("identical text is stored once (content-addressed)", async () => {
    const db = client();
    const text = big(200_000, "k");
    await db.put({ TableName: "t", Item: { id: "a", designJson: text, draftJson: text } });
    await db.put({ TableName: "t", Item: { id: "b", designJson: text } });
    expect(objects.size).toBe(1);
  });

  it("keeps the value in the row, rather than failing the save, when storage can't be written to", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setValueBackend({ put: async () => { throw new Error("AccessDenied"); }, get: async () => null });
    const db = client();
    const text = big(100_000);
    await db.put({ TableName: "t", Item: { id: "f", designJson: text } });
    expect(wire[0].body.Item.designJson.S).toBe(text);
  });

  it("fails a read with a plain message (never a marker) when the stored value is gone", async () => {
    const db = client();
    table.set("m", { id: { S: "m" }, designJson: { S: markerFor("a".repeat(64), 123) } });
    await expect(db.get({ TableName: "t", Key: { id: "m" } })).rejects.toThrow(/missing from storage|couldn't be loaded/);
  });
});

describe("through ElectroDB, which is how the app really talks to the table", () => {
  it("an entity saves and reads a multi-megabyte attribute whole, and the row stays tiny", async () => {
    const db = client();
    const Page = new Entity(
      {
        model: { entity: "page", version: "1", service: "test" },
        attributes: { id: { type: "string", required: true }, name: { type: "string" }, designJson: { type: "any" } },
        indexes: { primary: { pk: { field: "pk", composite: ["id"] }, sk: { field: "sk", composite: [] } } },
      },
      { table: "t", client: db },
    );
    const designJson = { rows: Array.from({ length: 60_000 }, (_, i) => ({ id: `row-${i}`, text: "lorem ipsum ".repeat(5) })) };
    expect(JSON.stringify(designJson).length).toBeGreaterThan(5_000_000);
    await Page.put({ id: "pg1", name: "Home", designJson: JSON.stringify(designJson) }).go();
    expect(JSON.stringify(wire.at(-1)!.body).length).toBeLessThan(3000);
    const { data } = await Page.get({ id: "pg1" }).go();
    expect(JSON.parse(data!.designJson as string)).toEqual(designJson);
    expect(data!.name).toBe("Home");
  });
});

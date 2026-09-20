/**
 * A stand-in for the Anthropic Messages API, for end-to-end tests.
 *
 * The application talks to the provider from the server, so there is nothing
 * for the browser to intercept. Pointing ANTHROPIC_BASE_URL at this server
 * lets the whole V2 flow run for real — job creation, both gates, the module
 * loop, evidence validation, pruning, the report — without an API key or a
 * paid request.
 *
 * It does not carry canned answers per module. It reads the JSON Schema the
 * SDK sends in `output_config.format` and builds a value that satisfies it, so
 * a module added later is covered without touching this file. Message ids are
 * taken from the excerpts in the request, so the evidence the application
 * validates is evidence it actually sent.
 */

import http from "node:http";

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  description?: string;
  $ref?: string;
  $defs?: Record<string, SchemaNode>;
}

/** The SDK encodes Zod's constraints into the description, e.g. `{maxItems: 4}`. */
function constraint(node: SchemaNode, name: string): number | null {
  const match = node.description?.match(new RegExp(`${name}:\\s*(\\d+)`));
  return match?.[1] ? Number(match[1]) : null;
}

function enumValues(node: SchemaNode): string[] | null {
  const match = node.description?.match(/enum:\s*\[(.*?)\]/);
  if (!match?.[1]) return null;
  return match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => entry.length > 0);
}

const SENTENCES: Record<string, string> = {
  title: "Stubbed finding",
  // Several of these name participants by their pseudonym, because that is
  // what the application stores and what the browser has to substitute a real
  // name into before showing it.
  summary:
    "Stubbed summary: Participant A opens most conversations and Participant B replies briefly.",
  observation:
    "Stubbed observation: Participant A sends more follow-up messages than Participant B.",
  interpretation: "Stubbed interpretation, offered as one reading among several.",
  uncertainty: "Stubbed uncertainty: the messages alone cannot settle intent.",
  excerpt: "Stubbed excerpt reference.",
  description: "Stubbed description.",
  headline: "Stubbed headline for Participant A.",
  basis: "Stubbed basis, drawn from the excerpts.",
  label: "Stubbed label",
  do: "Stubbed thing to try.",
  avoid: "Stubbed thing to avoid.",
  topic: "Stubbed topic",
  frequency: "most months",
  trigger: "Stubbed trigger for the exchange.",
  repair: "Stubbed repair attempt.",
  earlier: "Stubbed description of the earlier period.",
  later: "Stubbed description of the later period.",
  reading: "Stubbed reading of the moment.",
  text: "Stubbed suggested reply.",
  why: "Stubbed reason this might land well.",
  pattern: "Stubbed wording pattern.",
  alternative: "Stubbed alternative phrasing.",
  caution: "Stubbed caution.",
  note: "Stubbed note.",
};

function sentenceFor(key: string, node: SchemaNode): string {
  const base = SENTENCES[key] ?? `Stubbed ${key || "value"}.`;
  const max = constraint(node, "maxLength") ?? 400;
  const min = constraint(node, "minLength") ?? 0;
  const text = base.length > max ? base.slice(0, max) : base;
  return text.length >= min ? text : text.padEnd(min, ".");
}

class Generator {
  constructor(
    private readonly defs: Record<string, SchemaNode>,
    private readonly messageIds: string[],
    private readonly participantIds: string[],
  ) {}

  private resolve(node: SchemaNode): SchemaNode {
    if (!node.$ref) return node;
    const key = node.$ref.replace("#/$defs/", "");
    return this.defs[key] ?? {};
  }

  /**
   * `index` is the position within the enclosing array, carried down so that a
   * list of per-participant objects gets one entry per participant rather than
   * the same one twice.
   */
  build(raw: SchemaNode, key: string, depth = 0, index = 0): unknown {
    const node = this.resolve(raw);

    if (node.type === "object") {
      const out: Record<string, unknown> = {};
      for (const name of node.required ?? Object.keys(node.properties ?? {})) {
        const child = node.properties?.[name];
        if (child) out[name] = this.build(child, name, depth + 1, index);
      }
      return out;
    }

    if (node.type === "array") {
      const max = constraint(node, "maxItems") ?? 4;
      const min = constraint(node, "minItems") ?? 0;
      // Two items where the schema allows it: enough for the UI to show a
      // list rather than a single row, without bloating the response.
      const count = Math.max(min, Math.min(max, depth > 2 ? 1 : 2));

      if (key === "messageIds") {
        return this.messageIds.slice(0, Math.max(1, Math.min(count, 3)));
      }
      const items = node.items ?? {};
      const length = key === "profiles" ? this.participantIds.length || count : count;
      return Array.from({ length }, (_unused, position) =>
        this.build(items, key, depth + 1, position),
      );
    }

    if (node.type === "number" || node.type === "integer") {
      return constraint(node, "minimum") ?? 1;
    }
    if (node.type === "boolean") return true;

    const options = enumValues(node);
    if (options) return options[0] ?? "";
    if (key === "participantId") {
      return this.participantIds[index] ?? this.participantIds[0] ?? "A";
    }
    return sentenceFor(key, node);
  }
}

/** Everything the application put in front of the model, as text. */
function promptText(request: MessagesRequest): string {
  const parts: string[] = [];

  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      collect(record.text);
      collect(record.content);
    }
  };

  collect(request.system);
  collect(request.messages);
  return parts.join("\n");
}

/**
 * Excerpt lines are rendered as `[<id>] Participant A: text`, with ids taken
 * from the Telegram export, where they are numbers. Citing real ids matters:
 * the application drops evidence pointing at anything it did not send.
 */
function messageIdsFrom(prompt: string): string[] {
  const ids = new Set<string>();
  for (const match of prompt.matchAll(/^\[(\d{1,12})\].*?Participant/gm)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

/** `PARTICIPANTS: Participant A (A), Participant B (B)` → ["A", "B"]. */
function participantIdsFrom(prompt: string): string[] {
  const line = prompt.match(/^PARTICIPANTS:.*$/m)?.[0] ?? "";
  return [...line.matchAll(/\(([^)]+)\)/g)].map((match) => match[1] ?? "").filter(Boolean);
}

interface MessagesRequest {
  system?: unknown;
  messages?: unknown;
  output_config?: { format?: { schema?: SchemaNode } };
}

export interface MockProvider {
  url: string;
  close: () => Promise<void>;
}

/**
 * Tests run in worker processes and the mock runs in Playwright's main one, so
 * what the application sent is read back over HTTP rather than from memory.
 */
export const CAPTURE_PATH = "/__requests";

export async function startMockAnthropic(port: number): Promise<MockProvider> {
  const requests: string[] = [];

  const server = http.createServer((request, response) => {
    if (request.url?.startsWith(CAPTURE_PATH)) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ requests }));
      return;
    }

    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (!request.url?.includes("/v1/messages")) {
        response.writeHead(404).end("{}");
        return;
      }
      requests.push(raw);

      let parsed: MessagesRequest;
      try {
        parsed = JSON.parse(raw) as MessagesRequest;
      } catch {
        response.writeHead(400).end("{}");
        return;
      }

      const schema = parsed.output_config?.format?.schema;
      if (!schema) {
        response.writeHead(400).end(JSON.stringify({ error: "no output schema" }));
        return;
      }

      const prompt = promptText(parsed);
      const generator = new Generator(
        schema.$defs ?? {},
        messageIdsFrom(prompt),
        participantIdsFrom(prompt),
      );
      const payload = generator.build({ ...schema, $defs: undefined }, "", 0);

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: `msg_mock_${requests.length}`,
          type: "message",
          role: "assistant",
          model: "claude-opus-5",
          content: [{ type: "text", text: JSON.stringify(payload) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 400 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

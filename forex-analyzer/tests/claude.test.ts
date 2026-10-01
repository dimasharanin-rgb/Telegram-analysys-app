import { describe, expect, it } from "vitest";
import { ClaudeAnalyst } from "@/ai/claudeAnalyst";
import { AiError } from "@/ai/errors";
import type { ClaudePayload } from "@/ai/payload";
import { validAssessment } from "./fixtures";

const payload = { pair: "EURUSD", direction: "LONG" } as unknown as ClaudePayload;

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeApi(respond: (captured: Captured) => Response) {
  const captured: Captured[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? "{}")) };
    captured.push(c);
    return respond(c);
  }) as typeof fetch;
  return { fetchImpl, captured };
}

function message(text: string, stop_reason = "end_turn", model = "claude-opus-5-5") {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function analyst(fetchImpl: typeof fetch, timeoutMs = 5000) {
  return new ClaudeAnalyst({ apiKey: "sk-ant-test", model: "claude-opus-5-5", timeoutMs, effort: "high", fetch: fetchImpl });
}

describe("ClaudeAnalyst", () => {
  it("sends structured data with a strict output schema and parses the answer", async () => {
    const { fetchImpl, captured } = fakeApi(() => message(JSON.stringify(validAssessment())));
    const result = await analyst(fetchImpl).analyze(payload);

    expect(result.assessment.verdict).toBe("ACCEPTABLE");
    expect(result.info).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", servedBy: "claude-opus-5-5" });

    const req = captured[0]!;
    expect(req.url).toMatch(/\/v1\/messages/);
    expect(req.headers.get("x-api-key")).toBe("sk-ant-test");
    expect(req.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(req.body.model).toBe("claude-opus-5-5");
    expect(req.body.fallbacks).toBe("default");
    const outputConfig = req.body.output_config as { effort: string; format: { type: string; schema: { properties: Record<string, unknown> } } };
    expect(outputConfig.effort).toBe("high");
    expect(outputConfig.format.type).toBe("json_schema");
    expect(Object.keys(outputConfig.format.schema.properties)).toContain("setupQuality");
    expect(String(req.body.system)).toMatch(/NOT a probability/);
    expect(JSON.stringify(req.body.messages)).toContain('\\"pair\\": \\"EURUSD\\"');
  });

  it("notes when a fallback model answered", async () => {
    const { fetchImpl } = fakeApi(() => message(JSON.stringify(validAssessment()), "end_turn", "claude-opus-4-8"));
    const result = await analyst(fetchImpl).analyze(payload);
    expect(result.info.servedBy).toBe("claude-opus-4-8");
    expect(result.info.notes.join(" ")).toMatch(/fallback model claude-opus-4-8/);
  });

  it("rejects malformed output", async () => {
    const { fetchImpl } = fakeApi(() => message("I think this is a good trade."));
    await expect(analyst(fetchImpl).analyze(payload)).rejects.toMatchObject({ code: "MALFORMED" });
  });

  it("surfaces a refusal and a truncated answer as errors", async () => {
    await expect(analyst(fakeApi(() => message("", "refusal")).fetchImpl).analyze(payload)).rejects.toMatchObject({ code: "REFUSAL" });
    await expect(analyst(fakeApi(() => message("{", "max_tokens")).fetchImpl).analyze(payload)).rejects.toMatchObject({ code: "TRUNCATED" });
  });

  it("maps a rejected key to AUTHENTICATION", async () => {
    const { fetchImpl } = fakeApi(
      () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } }),
    );
    const err = await analyst(fetchImpl).analyze(payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("AUTHENTICATION");
  });

  it("times out instead of hanging", async () => {
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const err = await analyst(hanging, 50).analyze(payload).catch((e: unknown) => e);
    expect((err as AiError).code).toBe("TIMEOUT");
  }, 10_000);
});

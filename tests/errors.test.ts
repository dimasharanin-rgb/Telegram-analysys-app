import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError, asAppError, errorResponseBody } from "@/lib/errors";
import { log } from "@/lib/logger";
import { resetServerConfigCache } from "@/lib/config";

describe("AppError", () => {
  it("carries a user-facing message without internal detail", () => {
    const error = new AppError("AI_TIMEOUT", {
      detail: "provider call to https://internal.example took too long",
    });
    const facing = error.toUserFacing();
    expect(facing.code).toBe("AI_TIMEOUT");
    expect(facing.message).not.toContain("internal.example");
    expect(facing.retryable).toBe(true);
    // The detail is still available to server logs.
    expect(error.message).toContain("internal.example");
  });

  it("maps codes to sensible HTTP statuses", () => {
    expect(new AppError("INVALID_JSON").status).toBe(400);
    expect(new AppError("TOO_LARGE").status).toBe(413);
    expect(new AppError("RATE_LIMITED").status).toBe(429);
    expect(new AppError("NOT_CONFIGURED").status).toBe(503);
    expect(new AppError("AI_TIMEOUT").status).toBe(504);
    expect(new AppError("UNKNOWN").status).toBe(500);
  });

  it("marks only the genuinely retryable codes as retryable", () => {
    expect(new AppError("AI_RATE_LIMITED").retryable).toBe(true);
    expect(new AppError("NETWORK").retryable).toBe(true);
    expect(new AppError("SINGLE_PARTICIPANT").retryable).toBe(false);
    expect(new AppError("UNSUPPORTED_EXPORT").retryable).toBe(false);
  });

  it("wraps unknown throwables without leaking them to the user", () => {
    const wrapped = asAppError(new Error("ENOENT: /srv/secret/key.pem"));
    expect(wrapped.code).toBe("UNKNOWN");
    expect(wrapped.toUserFacing().message).not.toContain("key.pem");
    expect(errorResponseBody("boom").error.code).toBe("UNKNOWN");
  });

  it("passes an existing AppError straight through", () => {
    const original = new AppError("PDF_FAILED");
    expect(asAppError(original)).toBe(original);
  });
});

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerConfigCache();
    delete process.env.ANALYZER_DEBUG;
  });

  it("redacts anything that looks like a credential", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    log.info("test", { note: "key sk-ant-api03-ABCDEFGH1234 used" });
    const line = spy.mock.calls[0]![0] as string;
    expect(line).not.toContain("sk-ant-api03-ABCDEFGH1234");
    expect(line).toContain("[redacted]");
  });

  it("truncates long values so message text cannot sprawl into a log", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.warn("test", { note: "x".repeat(1000) });
    const line = spy.mock.calls[0]![0] as string;
    expect(line.length).toBeLessThan(400);
  });

  it("writes debug lines only when debugging is switched on", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    resetServerConfigCache();
    log.debug("quiet", {});
    expect(spy).not.toHaveBeenCalled();

    process.env.ANALYZER_DEBUG = "1";
    resetServerConfigCache();
    log.debug("loud", {});
    expect(spy).toHaveBeenCalledOnce();
  });
});

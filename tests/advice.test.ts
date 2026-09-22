import { beforeEach, describe, expect, it } from "vitest";

import { ADVICE_LIBRARY, getAdviceTopic } from "@/lib/advice/library";
import {
  adviceAllowanceFor,
  adviceLimits,
  adviceTierFor,
  describeAllowance,
} from "@/lib/advice/limits";
import { AppError } from "@/lib/errors";
import {
  adviceAllowance,
  countAdviceRequests,
  releaseAdviceRequest,
  reserveAdviceRequest,
} from "@/server/advice/allowance";
import { getDb } from "@/server/db/client";
import { seedConversation, withTestDatabase } from "./support/db";
import { createJob } from "@/server/repositories/jobs";

withTestDatabase();

/** A job row to hang advice requests off, without running an analysis. */
function seedJob(productId = "free") {
  const { ownerId, conversation } = seedConversation();
  const job = createJob({
    ownerId,
    conversationId: conversation.id,
    productId,
    analysisType: "text",
    modules: ["COMMUNICATION"],
    contentTypes: ["TEXT"],
    depth: "standard",
    status: "COMPLETED",
    inputMessageCount: 100,
    inputExcerptChars: 1000,
    estimatedCostMicros: 0,
  });
  return { ownerId, job };
}

beforeEach(() => {
  delete process.env.ADVICE_REQUESTS_FREE;
  delete process.env.ADVICE_REQUESTS_BASIC;
  delete process.env.ADVICE_REQUESTS_PREMIUM;
});

describe("advice limits are configuration, not constants", () => {
  it("has a documented default per tier", () => {
    expect(adviceLimits()).toEqual({ free: 3, basic: 10, premium: 50 });
  });

  it("can be overridden from the environment", () => {
    process.env.ADVICE_REQUESTS_FREE = "7";
    expect(adviceLimits().free).toBe(7);
    expect(adviceAllowanceFor("free")).toBe(7);
  });

  it("maps products onto tiers, and anything unknown to free", () => {
    expect(adviceTierFor("free")).toBe("free");
    expect(adviceTierFor("deep-text")).toBe("basic");
    expect(adviceTierFor("pro-credits")).toBe("premium");
    // A product added later does not silently inherit a large allowance.
    expect(adviceTierFor("something-new")).toBe("free");
  });

  it("describes what is left", () => {
    expect(describeAllowance("free", 1)).toEqual({
      total: 3,
      used: 1,
      remaining: 2,
      tier: "free",
    });
    // Never negative, however the count got there.
    expect(describeAllowance("free", 9).remaining).toBe(0);
  });
});

describe("spending the allowance", () => {
  it("starts with the full allowance and counts down", () => {
    const { ownerId, job } = seedJob("free");
    expect(adviceAllowance(job.id, ownerId, "free").remaining).toBe(3);

    const first = reserveAdviceRequest(job.id, ownerId, "free", "respond");
    expect(first.allowance.remaining).toBe(2);
    expect(countAdviceRequests(job.id, ownerId)).toBe(1);
  });

  it("refuses once the allowance is gone, and says so without jargon", () => {
    const { ownerId, job } = seedJob("free");
    for (let i = 0; i < 3; i += 1) {
      reserveAdviceRequest(job.id, ownerId, "free", "respond");
    }

    let thrown: AppError | null = null;
    try {
      reserveAdviceRequest(job.id, ownerId, "free", "respond");
    } catch (error) {
      thrown = error as AppError;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown!.code).toBe("ENTITLEMENT_REQUIRED");
    expect(thrown!.toUserFacing().message).toContain("all 3 advice requests");
    // The refusal still points at something the user can do.
    expect(thrown!.toUserFacing().hint).toContain("written guidance");
  });

  it("hands the request back when the model produced nothing", () => {
    const { ownerId, job } = seedJob("free");
    const reserved = reserveAdviceRequest(job.id, ownerId, "free", "respond");
    expect(countAdviceRequests(job.id, ownerId)).toBe(1);

    releaseAdviceRequest(reserved.id);
    expect(countAdviceRequests(job.id, ownerId)).toBe(0);
    expect(adviceAllowance(job.id, ownerId, "free").remaining).toBe(3);
  });

  it("cannot be raced past its limit", () => {
    const { ownerId, job } = seedJob("free");

    // The guard lives in the INSERT, so even without any application-level
    // locking the fourth attempt finds the count already at the limit.
    const outcomes = [0, 1, 2, 3, 4].map(() => {
      try {
        reserveAdviceRequest(job.id, ownerId, "free", "respond");
        return "granted";
      } catch {
        return "refused";
      }
    });

    expect(outcomes.filter((o) => o === "granted")).toHaveLength(3);
    expect(outcomes.filter((o) => o === "refused")).toHaveLength(2);
    expect(countAdviceRequests(job.id, ownerId)).toBe(3);
  });

  it("keeps one analysis's allowance away from another's", () => {
    const first = seedJob("free");
    const second = seedJob("free");

    reserveAdviceRequest(first.job.id, first.ownerId, "free", "respond");

    expect(countAdviceRequests(first.job.id, first.ownerId)).toBe(1);
    expect(countAdviceRequests(second.job.id, second.ownerId)).toBe(0);
  });

  it("gives a paid product a larger allowance", () => {
    const { ownerId, job } = seedJob("deep-text");
    expect(adviceAllowance(job.id, ownerId, "deep-text").total).toBe(10);
  });

  it("goes away with the analysis it belonged to", () => {
    const { ownerId, job } = seedJob("free");
    reserveAdviceRequest(job.id, ownerId, "free", "respond");

    getDb().prepare("DELETE FROM analysis_jobs WHERE id = ?").run(job.id);

    expect(countAdviceRequests(job.id, ownerId)).toBe(0);
  });
});

describe("the written library", () => {
  it("covers the topics someone arrives with", () => {
    const ids = ADVICE_LIBRARY.map((topic) => topic.id);
    expect(ids).toContain("difficult-conversation");
    expect(ids).toContain("apologising");
    expect(ids).toContain("boundary");
    expect(ids).toContain("de-escalating");
    expect(ids).toContain("silence");
    expect(ids).toContain("recurring-issue");
    expect(ids).toContain("ending-respectfully");
  });

  it("is usable without a model call: every topic is complete", () => {
    for (const topic of ADVICE_LIBRARY) {
      expect(topic.steps.length).toBeGreaterThan(1);
      expect(topic.avoid.length).toBeGreaterThan(0);
      expect(topic.example.length).toBeGreaterThan(20);
    }
  });

  it("looks a topic up, and refuses an unknown one", () => {
    expect(getAdviceTopic("apologising")?.title).toBe("Apologising");
    expect(getAdviceTopic("nonsense")).toBeNull();
  });
});

import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { fieldErrors } from "@/lib/schemas";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Parses untrusted input with a zod schema, turning failures into a 400 with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "Invalid input", fieldErrors(result.error));
  return result.data;
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, fields: error.fields });
    return;
  }
  if (error && typeof error === "object" && "type" in error && error.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON" });
    return;
  }
  if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }
  console.error("[api] unexpected error", error);
  res.status(500).json({ error: "Internal server error" });
}

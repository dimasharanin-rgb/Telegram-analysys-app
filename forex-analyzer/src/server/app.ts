import express, { type Express } from "express";
import { createApiRouter } from "@/server/api/router";
import type { Services } from "@/server/container";

export function createApp(services: Services): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use("/api", createApiRouter(services));
  return app;
}

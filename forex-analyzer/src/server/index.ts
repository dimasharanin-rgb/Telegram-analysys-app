import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "@/server/app";
import { loadConfig } from "@/server/config";
import { createServices } from "@/server/container";

async function main(): Promise<void> {
  const config = loadConfig();
  const services = createServices(config);
  const app = createApp(services);
  const server = createServer(app);

  if (config.production) {
    const dist = resolve("dist");
    if (!existsSync(resolve(dist, "index.html"))) {
      throw new Error('No production build found. Run "npm run build" first.');
    }
    app.use(express.static(dist, { index: false }));
    app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  server.listen(config.port, config.host, () => {
    const url = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
    console.log(`\n  FX Trade Analyzer running at ${url}`);
    console.log(`  Data mode:   ${services.market.mode}${services.market.mode === "LIVE" && !services.market.liveConfigured ? " — LIVE DATA UNAVAILABLE (TWELVE_DATA_API_KEY not set)" : ""}`);
    console.log(`  AI analyst:  ${services.analyst.provider === "mock" ? "MOCK rules (set ANTHROPIC_API_KEY to use Claude)" : services.analyst.model}`);
    console.log("  Trade execution: none (analysis only)\n");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

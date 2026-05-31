import { VectorEngine } from "./engine";
import { logger } from "./logger";

export function startHttpServer(engine: VectorEngine) {
  Bun.serve({
    port: 4321,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/search") {
        try {
          const body = await req.json() as { query: string; limit?: number };
          const results = await engine.search(body.query, body.limit || 3);
          return Response.json({ success: true, results });
        } catch (err: any) {
          logger.error(err, "HTTP Endpoint request error encountered");
          return Response.json({ error: "Invalid Request Payload Data" }, { status: 400 });
        }
      }
      return new Response("Not Found", { status: 404 });
    }
  });
  logger.info("HTTP Server online running on port 4321.");
}

import { VectorEngine } from "./engine";
import { logger } from "./logger";
import * as path from "path";
import pdf2md from "pdf2md-ts";
import { readdir } from "node:fs/promises";

export function startHttpServer(engine: VectorEngine) {
  Bun.serve({
    port: 4321,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);
      
      // Serve index.html on the root path
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const indexPath = path.join(process.cwd(), "index.html");
        return new Response(Bun.file(indexPath));
      }

      if (req.method === "GET" && url.pathname === "/list-docs") {
        try {
          const docsDir = path.join(process.cwd(), "docs");
          const files = await readdir(docsDir, { recursive: true });
          const docs = files.filter(f => f.endsWith(".md") || !f.includes(".")); // Simple filter for md and folders
          return Response.json({ success: true, docs });
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 500 });
        }
      }

      if (req.method === "GET" && url.pathname === "/read") {
        const filePath = url.searchParams.get("path");
        if (!filePath) return Response.json({ error: "Missing path parameter" }, { status: 400 });
        
        try {
          const content = await engine.readDocument(filePath);
          if (content === null) return Response.json({ error: "File not found" }, { status: 404 });
          return Response.json({ success: true, content });
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 403 });
        }
      }

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

      if (req.method === "POST" && url.pathname === "/ingest-pdf") {
        try {
          const formData = await req.formData();
          const file = formData.get("file") as File;
          if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 });

          const buffer = await file.arrayBuffer();
          const markdown = await pdf2md(new Uint8Array(buffer));
          
          const filename = file.name.replace(".pdf", ".md");
          const targetPath = path.join("docs", filename);
          
          await Bun.write(targetPath, markdown);
          
          // Re-index the document immediately so it's searchable in the database
          await engine.indexSingleFile(path.resolve(process.cwd(), targetPath));
          
          return Response.json({ success: true, path: targetPath });
        } catch (err: any) {
          logger.error(err, "PDF ingestion error");
          return Response.json({ error: err.message }, { status: 500 });
        }
      }

      return new Response("Not Found", { status: 404 });
    }
  });
  logger.info("HTTP Server online running on 0.0.0.0:4321.");
}

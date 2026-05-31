import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { VectorEngine } from "./engine";
import { logger } from "./logger";

export async function startMcpServer(engine: VectorEngine) {
  const server = new Server(
    { name: "raglike-md", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "semantic_markdown_search",
        description: "Searches through nested workspace markdown files using local pgvector embeddings.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The conceptual query text string." },
            limit: { type: "number", default: 3 }
          },
          required: ["query"]
        }
      },
      {
        name: "get_full_document",
        description: "Retrieves the full raw markdown content of a file. Use this after finding a relevant file via semantic search.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "The relative path to the markdown file (e.g., 'docs/architecture/overview.md')." }
          },
          required: ["file_path"]
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "semantic_markdown_search") {
      const query = String(req.params.arguments?.query || "");
      const limit = Number(req.params.arguments?.limit || 3);

      const matches = await engine.search(query, limit);
      const output = matches.map(m => `### File: \`${m.file_path}\` > \`${m.heading}\` (Score: ${m.distance.toFixed(4)})\n---\n${m.content}\n---\n`).join("\n");

      return { content: [{ type: "text", text: output }] };
    }

    if (req.params.name === "get_full_document") {
      const filePath = String(req.params.arguments?.file_path || "");
      try {
        const content = await engine.readDocument(filePath);
        if (!content) return { content: [{ type: "text", text: `Error: File '${filePath}' not found.` }], isError: true };
        return { content: [{ type: "text", text: content }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }

    throw new Error("Tool unexpected.");
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP Layer linked cleanly via standard IO streams.");
}

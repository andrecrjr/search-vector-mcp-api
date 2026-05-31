# search-docs-api 🚀

A high-performance, local semantic search engine for Markdown documentation. Built with **Bun**, **PGlite (pgvector)**, and **Xenova Transformers**.

`search-docs-api` recursively crawls your documentation folders, generates embeddings locally using the `all-MiniLM-L6-v2` model, and provides a semantic search interface via **Model Context Protocol (MCP)** or a **REST API**.

---

## 🏗️ Architecture

The system follows a "RAG-lite" (Retrieval-Augmented Generation) architecture, focusing on the retrieval layer:

1.  **Crawler:** Recursively scans the `./docs` directory for `.md` files.
2.  **Parser:** Segments files based on Markdown headings (`##`, `###`, etc.) to create granular chunks.
3.  **Embedding Engine:** Uses `@xenova/transformers` to run the `all-MiniLM-L6-v2` model locally. No API keys are required; everything stays on your machine.
4.  **Vector Store:** Uses `PGlite` with the `pgvector` extension. It's a WASM-powered Postgres build that runs inside the Bun process, providing industry-standard vector similarity search (`<=>` cosine distance).
5.  **Delivery Layer:** 
    *   **MCP Server:** Standard Stdio transport for integration with AI tools (Cursor, Claude, etc.).
    *   **REST API:** Simple HTTP POST endpoint for custom integrations.

---

## 🐳 Running with Docker (Recommended)

Docker is the easiest way to run `search-docs-api` as it comes pre-packaged with all native dependencies and model weights.

### 1. Build the Image
```bash
docker build -t search-docs-api .
```

### 2. Run as a REST API
Mount your local documentation folder to the container's `/app/docs` directory:
```bash
docker run -d \
  -p 4321:4321 \
  -v /path/to/your/docs:/app/docs \
  --name search-docs-api \
  search-docs-api --api
```

### 3. Run as an MCP Server
Configure your MCP host (e.g., Cursor or Claude Desktop) to use the Docker container:
```json
"search-docs-api": {
  "command": "docker",
  "args": [
    "run",
    "-i",
    "--rm",
    "-v", "/path/to/your/docs:/app/docs",
    "search-docs-api"
  ]
}
```

---

## 🛠️ Local Development

If you have [Bun](https://bun.sh) installed, you can run the project directly:

### Setup
```bash
bun install
```

### Run Search API
```bash
bun run src/index.ts --api
```

### Run Unit Tests
```bash
bun test
```

---

## 📡 API Usage

### Semantic Search
**Endpoint:** `POST http://localhost:4321/search`

**Payload:**
```json
{
  "query": "How do I configure the protocol?",
  "limit": 3
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "file_path": "docs/architecture/protocol.md",
      "heading": "# Protocol",
      "content": "Detailed documentation content...",
      "distance": 0.4215
    }
  ]
}
```

---

## 📝 Logging
Logs are stored in `.logs/app.log` using the **Pino** logger. The system is tuned for production with minimal I/O overhead.

## ⚖️ License
MIT

# raglike-md 🚀

A high-performance, local semantic search engine for Markdown documentation. Built with **Bun**, **PGlite (pgvector)**, **External Postgres Support**, and **Xenova Transformers**.

`raglike-md` recursively crawls your documentation, generates granular embeddings locally using the `all-MiniLM-L6-v2` model, and provides a semantic search interface via **Model Context Protocol (MCP)** or a **REST API**.

---

## ✨ Key Features

- **Hybrid Search (Vector + Full-Text):** Combines conceptual similarity (pgvector) with exact keyword matching (tsvector). Ranked using **Reciprocal Rank Fusion (RRF)** for superior precision.
- **HNSW Acceleration:** Automatically implements Hierarchical Navigable Small World indexing for sub-second searches across massive datasets.
- **Smart Chunking:** Uses a sliding window strategy with overlap (~600 chars) to ensure AI models receive complete context without losing semantic continuity.
- **Dual Database Architecture:** Automatically switches between local persistent **PGlite** (WASM-powered) and external **Postgres**.
- **Parallel Ingestion:** High-speed indexing that embeds and batches multiple document chunks simultaneously.
- **MCP & REST API:** Native support for the Model Context Protocol and standard HTTP interfaces.


---

## 🏗️ Architecture & Documentation

The system follows a "RAG-lite" (Retrieval-Augmented Generation) architecture, focusing on the retrieval layer.

- **[Quick Setup Guide](docs/setup.md)**: How to get up and running quickly.
- **[Architecture Overview](docs/architecture/overview.md)**: High-level system design and component breakdown.
- **[Server Modes & Usage](docs/architecture/server-modes.md)**: Deep dive into MCP Tools and API Endpoints.
- **[Search Protocol](docs/architecture/protocol.md)**: API and MCP tool communication specifications.

---

## 📡 Model Context Protocol (MCP) Setup

`raglike-md` can be used as a tool provider for AI assistants like Claude Desktop.

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "raglike-md": {
      "command": "bun",
      "args": ["run", "/path/to/raglike-md/src/index.ts", "--mcp"],
      "env": {
        "POSTGRES_URL": "postgres://user:pass@localhost:5432/raglike"
      }
    }
  }
}
```

---

## 🌐 API Usage

Start the API server:
```bash
bun start --api
```

### 1. Semantic Search
**Endpoint:** `POST http://localhost:4321/search`

```json
{
  "query": "How do I configure the protocol?",
  "limit": 3
}
```

### 2. Upload Document
**Endpoint:** `POST http://localhost:4321/upload` (multipart/form-data)

Upload a `.md` or `.pdf` file to be indexed immediately.

---

## 🐳 Running with Docker Compose (Recommended)

The easiest way to run the full stack (Search Engine + Postgres Database).

```yaml
services:
  db:
    image: ankane/pgvector:latest
    environment:
      - POSTGRES_DB=raglike
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - pgdata:/var/lib/postgresql/data

  raglike-md:
    image: raglike-md
    ports:
      - "4321:4321"
    environment:
      - ENABLE_API=true
      - ENABLE_MCP=true
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./docs:/app/docs
```

Run it with:
```bash
docker compose up -d
```

---

## 🛠️ Local Development

If you have [Bun](https://bun.sh) installed, you can run the project directly:

### Setup
```bash
bun install
```

### Environment Variables
- `POSTGRES_URL`: (Optional) Connection string for an external Postgres database.
- `ENABLE_API`: Set to `true` to enable the REST API.
- `ENABLE_MCP`: Set to `true` to enable the MCP server.
- `HOST`: The hostname/interface to bind to (default: `0.0.0.0`).

---

## 📝 Logging
Logs are stored in `.logs/app.log` using the **Pino** logger. The system detects its environment and logs database connection status accordingly.

## ⚖️ License
MIT

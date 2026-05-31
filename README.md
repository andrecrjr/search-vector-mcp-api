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

## 🏗️ Architecture

The system follows a "RAG-lite" (Retrieval-Augmented Generation) architecture, focusing on the retrieval layer. For detailed information, see our [Architecture Documentation](docs/architecture/overview.md).

- **[Overview](docs/architecture/overview.md)**: High-level system design and component breakdown.
- **[Vector Engine](docs/architecture/vector-engine.md)**: Deep dive into persistence, Dual DB, and granular chunking.
- **[Search Protocol](docs/architecture/protocol.md)**: API and MCP tool communication specifications.

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

### Run Search API
```bash
bun run src/index.ts --api
```

### Environment Variables
- `POSTGRES_URL`: (Optional) Connection string for an external Postgres database.
- `ENABLE_API`: Set to `true` to enable the REST API.
- `ENABLE_MCP`: Set to `true` to enable the MCP server.

---

## 📡 API Usage

### 1. Semantic Search (Granular)
**Endpoint:** `POST http://localhost:4321/search`

Returns relevant paragraphs with hierarchical context.

```json
{
  "query": "How do I configure the protocol?",
  "limit": 3
}
```

### 2. Read Full Document
**Endpoint:** `GET http://localhost:4321/read?path=docs/setup.md`

Retrieves the raw Markdown content of a specific file.

---

## 📝 Logging
Logs are stored in `.logs/app.log` using the **Pino** logger. The system detects its environment and logs database connection status accordingly.

## ⚖️ License
MIT

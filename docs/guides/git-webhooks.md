# Setting up Git Webhooks for Zero-UI Ingestion

`raglike-md` supports automatic indexing of your repositories via webhooks. This guide explains how to set them up for GitHub and GitLab.

## 1. Prerequisites

- Your `raglike-md` instance must be accessible from the internet (e.g., via ngrok, Cloudflare Tunnel, or a public IP).
- You have configured a `WEBHOOK_SECRET` environment variable on your `raglike-md` server.

## 2. GitHub Setup

1. Go to your repository on GitHub.
2. Navigate to **Settings** > **Webhooks** > **Add webhook**.
3. **Payload URL:** `http://your-server.com:4321/api/v1/sync/webhook`
4. **Content type:** `application/json`
5. **Secret:** (Matches your `WEBHOOK_SECRET`)
6. **Which events would you like to trigger this webhook?** Select **Just the push event**.
7. Click **Add webhook**.

## 3. GitLab Setup

1. Go to your project on GitLab.
2. Navigate to **Settings** > **Webhooks**.
3. **URL:** `http://your-server.com:4321/api/v1/sync/webhook`
4. **Secret token:** (Matches your `WEBHOOK_SECRET`)
5. **Trigger:** Select **Push events**.
6. Click **Add webhook**.

## 4. How it Works

When a push occurs:
1. GitHub/GitLab sends a POST request to `raglike-md`.
2. `raglike-md` validates the signature or secret token.
3. If valid, it extracts the repository URL and name.
4. It clones (if first time) or pulls the repository into the `.repos/` directory.
5. It recursively indexes all `.md` files in the repository, tagging them with the `repository_id` (e.g., `owner-repo`).

## 5. Security Notes

- **Signature Validation:** `raglike-md` uses HMAC-SHA256 for GitHub and a plain token for GitLab.
- **Scoping:** Use the `repository` argument in the `semantic_markdown_search` tool to search within specific repositories.

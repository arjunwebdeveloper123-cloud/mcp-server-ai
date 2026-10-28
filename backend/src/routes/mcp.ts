import { Router } from "express";
import { McpServer } from "../models/index.js";
import { callTool, connectServer, disconnectServer, listServers, setToolEnabled } from "../mcp/manager.js";
import { asyncH, HttpError } from "../http.js";

export const mcpRouter = Router();

function parseBody(b: Record<string, unknown>) {
  const transport: "http" | "stdio" = b.transport === "http" ? "http" : "stdio";
  const name = String(b.name ?? "").trim();
  const slug = String(b.slug ?? "").trim().toLowerCase();
  if (!name) throw new HttpError(400, "Name is required");
  if (!/^[a-z0-9-]{2,30}$/.test(slug)) throw new HttpError(400, "Slug: 2–30 chars, a-z 0-9 and - only");

  if (transport === "stdio") {
    const command = String(b.command ?? "").trim();
    if (!command) throw new HttpError(400, "Command is required for stdio");
    const args = Array.isArray(b.args) ? b.args.map(String).filter(Boolean) : [];
    return { name, slug, transport, command, args, env: (b.env as Record<string, string>) ?? {} };
  }

  const url = String(b.url ?? "").trim();
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw new HttpError(400, "Valid http(s) URL is required");
  }
  return { name, slug, transport, url, headers: (b.headers as Record<string, string>) ?? {} };
}

mcpRouter.get(
  "/servers",
  asyncH(async (_req, res) => {
    res.json(await listServers());
  })
);

mcpRouter.post(
  "/servers",
  asyncH(async (req, res) => {
    const data = parseBody(req.body ?? {});
    if (await McpServer.exists({ slug: data.slug })) throw new HttpError(409, "Slug already in use");
    const doc = await McpServer.create(data);
    await connectServer(String(doc._id));
    res.status(201).json({ id: doc._id });
  })
);

mcpRouter.put(
  "/servers/:id",
  asyncH(async (req, res) => {
    const doc = await McpServer.findById(req.params.id);
    if (!doc) throw new HttpError(404, "Not found");
    const data = parseBody(req.body ?? {});
    if (data.slug !== doc.slug && (await McpServer.exists({ slug: data.slug })))
      throw new HttpError(409, "Slug already in use");
    // Masked header values ("abcd••••") ko overwrite mat karo
    if ("headers" in data && data.headers) {
      const old = doc.headers instanceof Map ? Object.fromEntries(doc.headers) : {};
      for (const [k, v] of Object.entries(data.headers)) if (String(v).includes("••••") && old[k]) data.headers[k] = old[k];
    }
    doc.set(data);
    await doc.save();
    await connectServer(String(doc._id));
    res.json({ ok: true });
  })
);

mcpRouter.patch(
  "/servers/:id/enabled",
  asyncH(async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    const r = await McpServer.updateOne({ _id: req.params.id }, { enabled });
    if (!r.matchedCount) throw new HttpError(404, "Not found");
    await connectServer(String(req.params.id));
    res.json({ ok: true });
  })
);

mcpRouter.post(
  "/servers/:id/reconnect",
  asyncH(async (req, res) => {
    const c = await connectServer(String(req.params.id));
    res.json({ status: c.status, error: c.error });
  })
);

mcpRouter.delete(
  "/servers/:id",
  asyncH(async (req, res) => {
    await disconnectServer(String(req.params.id));
    await McpServer.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  })
);

mcpRouter.patch(
  "/servers/:id/tools/:tool",
  asyncH(async (req, res) => {
    await setToolEnabled(String(req.params.id), String(req.params.tool), Boolean(req.body?.enabled));
    res.json({ ok: true });
  })
);

/** Dashboard se tool ko seedha run karna (testing) */
mcpRouter.post(
  "/tools/:fullName/run",
  asyncH(async (req, res) => {
    const args = req.body?.args ?? {};
    if (typeof args !== "object" || Array.isArray(args)) throw new HttpError(400, "args must be a JSON object");
    try {
      res.json(await callTool(String(req.params.fullName), args));
    } catch (err) {
      res.json({ text: err instanceof Error ? err.message : String(err), isError: true });
    }
  })
);

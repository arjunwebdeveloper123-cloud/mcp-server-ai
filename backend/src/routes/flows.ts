import { Router } from "express";
import { Flow, Settings, getSettings } from "../models/index.js";
import { validateFlow, type FlowEdge, type FlowNode } from "../services/flow.js";
import { blankFlow, templateFlow } from "../services/flowTemplate.js";
import { listAllToolNames } from "../mcp/manager.js";
import { testNodeAiKey } from "../services/providers/nodeAi.js";
import { asyncH, HttpError } from "../http.js";

export const flowsRouter = Router();

const NODE_TYPES = new Set(["start", "message", "question", "buttons", "condition", "ai", "tool", "webhook", "handoff", "end"]);

/** Browser se aaya data saaf karo — sirf zaroori fields */
function sanitize(body: Record<string, unknown>) {
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const edges = Array.isArray(body.edges) ? body.edges : [];
  if (nodes.length > 300) throw new HttpError(400, "A flow can have at most 300 boxes");
  const cleanNodes: FlowNode[] = nodes.map((n: Record<string, unknown>) => {
    if (!NODE_TYPES.has(String(n.type))) throw new HttpError(400, `Unknown box type: ${String(n.type)}`);
    const pos = (n.position as { x?: number; y?: number }) ?? {};
    return {
      id: String(n.id),
      type: n.type as FlowNode["type"],
      position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0 },
      data: typeof n.data === "object" && n.data ? (n.data as Record<string, unknown>) : {},
    };
  });
  const ids = new Set(cleanNodes.map((n) => n.id));
  const cleanEdges: FlowEdge[] = edges
    .map((e: Record<string, unknown>) => ({
      id: String(e.id),
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle ? String(e.sourceHandle) : null,
    }))
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes: cleanNodes, edges: cleanEdges };
}

flowsRouter.get(
  "/",
  asyncH(async (_req, res) => {
    const s = await getSettings();
    const flows = await Flow.find().sort({ updatedAt: -1 }).lean();
    res.json(
      flows.map((f) => ({
        _id: f._id,
        name: f.name,
        boxes: (f.nodes as unknown[]).length,
        updatedAt: f.updatedAt,
        active: String(s.activeFlowId ?? "") === String(f._id),
      }))
    );
  })
);

flowsRouter.post(
  "/",
  asyncH(async (req, res) => {
    const name = String(req.body?.name ?? "").trim() || "Untitled flow";
    const start = req.body?.template ? templateFlow() : blankFlow();
    const f = await Flow.create({ name: name.slice(0, 80), ...start });
    res.status(201).json({ _id: f._id });
  })
);

/** Real-time verification of an AI API key and model */
flowsRouter.post(
  "/test-ai-key",
  asyncH(async (req, res) => {
    const provider = String(req.body?.provider || "gemini");
    const apiKey = String(req.body?.apiKey || "");
    const model = req.body?.model ? String(req.body.model) : undefined;
    const baseUrl = req.body?.baseUrl ? String(req.body.baseUrl) : undefined;
    const result = await testNodeAiKey({ provider, apiKey, model, baseUrl });
    res.json(result);
  })
);

flowsRouter.get(
  "/:id",
  asyncH(async (req, res) => {
    const f = await Flow.findById(req.params.id).lean();
    if (!f) throw new HttpError(404, "Flow not found");
    const s = await getSettings();
    res.json({ ...f, active: String(s.activeFlowId ?? "") === String(f._id), tools: listAllToolNames() });
  })
);

flowsRouter.put(
  "/:id",
  asyncH(async (req, res) => {
    const { nodes, edges } = sanitize(req.body ?? {});
    const name = String(req.body?.name ?? "").trim().slice(0, 80) || "Untitled flow";
    const f = await Flow.findByIdAndUpdate(req.params.id, { name, nodes, edges }, { new: true });
    if (!f) throw new HttpError(404, "Flow not found");
    res.json({ ok: true, updatedAt: f.updatedAt, ...validateFlow(nodes, edges, listAllToolNames()) });
  })
);

/** Publish = bot ab isi flow se chalega */
flowsRouter.post(
  "/:id/publish",
  asyncH(async (req, res) => {
    const f = await Flow.findById(req.params.id).lean();
    if (!f) throw new HttpError(404, "Flow not found");
    const check = validateFlow(f.nodes as FlowNode[], f.edges as FlowEdge[], listAllToolNames());
    if (check.errors.length) return res.status(400).json({ error: "Fix these before publishing", ...check });
    await getSettings();
    await Settings.updateOne({ _id: "global" }, { activeFlowId: f._id });
    res.json({ ok: true, ...check });
  })
);

flowsRouter.post(
  "/unpublish",
  asyncH(async (_req, res) => {
    await Settings.updateOne({ _id: "global" }, { activeFlowId: null });
    res.json({ ok: true });
  })
);

flowsRouter.post(
  "/:id/duplicate",
  asyncH(async (req, res) => {
    const f = await Flow.findById(req.params.id).lean();
    if (!f) throw new HttpError(404, "Flow not found");
    const copy = await Flow.create({ name: `${f.name} (copy)`.slice(0, 80), nodes: f.nodes, edges: f.edges });
    res.status(201).json({ _id: copy._id });
  })
);

flowsRouter.delete(
  "/:id",
  asyncH(async (req, res) => {
    await Settings.updateOne({ _id: "global", activeFlowId: req.params.id }, { activeFlowId: null });
    await Flow.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  })
);

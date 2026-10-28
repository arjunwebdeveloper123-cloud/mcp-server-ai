import { Router } from "express";
import multer from "multer";
import { KnowledgeChunk, KnowledgeDoc, Settings, getSettings } from "../models/index.js";
import { addDocument, invalidateIndex, searchKnowledge } from "../services/knowledge.js";
import { asyncH, HttpError } from "../http.js";

export const knowledgeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }, // 10 MB per file, 10 files ek baar me
});

knowledgeRouter.get(
  "/",
  asyncH(async (_req, res) => {
    const s = await getSettings();
    const docs = await KnowledgeDoc.find().sort({ createdAt: -1 }).lean();
    res.json({
      settings: { enabled: s.knowledgeEnabled, topK: s.knowledgeTopK, maxChars: s.knowledgeMaxChars },
      docs,
      totals: { docs: docs.length, chunks: docs.reduce((n, d) => n + (d.chunkCount ?? 0), 0) },
    });
  })
);

/** Ek ya zyada files upload (field name: "files") */
knowledgeRouter.post("/upload", (req, res, next) => {
  upload.array("files", 10)(req, res, async (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code;
      return res.status(400).json({ error: code === "LIMIT_FILE_SIZE" ? "Each file must be under 10 MB" : code === "LIMIT_FILE_COUNT" ? "Upload up to 10 files at a time" : "Upload failed" });
    }
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) return res.status(400).json({ error: "Choose at least one file" });
      const results = [];
      for (const f of files) {
        // multer latin1 me naam deta hai — Hindi / special characters ke liye utf8
        const name = Buffer.from(f.originalname, "latin1").toString("utf8");
        try {
          const doc = await addDocument(name, f.buffer);
          results.push({ name, ok: true, chunks: doc.chunkCount, id: doc._id });
        } catch (e) {
          results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      res.json({ results });
    } catch (e) {
      next(e);
    }
  });
});

knowledgeRouter.patch(
  "/docs/:id",
  asyncH(async (req, res) => {
    const r = await KnowledgeDoc.updateOne({ _id: req.params.id }, { enabled: Boolean(req.body?.enabled) });
    if (!r.matchedCount) throw new HttpError(404, "File not found");
    invalidateIndex();
    res.json({ ok: true });
  })
);

knowledgeRouter.delete(
  "/docs/:id",
  asyncH(async (req, res) => {
    await KnowledgeChunk.deleteMany({ docId: req.params.id });
    await KnowledgeDoc.deleteOne({ _id: req.params.id });
    invalidateIndex();
    res.json({ ok: true });
  })
);

/** File ke tukde dekhna (kaise toda gaya) */
knowledgeRouter.get(
  "/docs/:id/chunks",
  asyncH(async (req, res) => {
    res.json(await KnowledgeChunk.find({ docId: req.params.id }).sort({ order: 1 }).select("title text order").lean());
  })
);

/** "Try a question" — dikhata hai is sawaal par LLM ko kya-kya jayega */
knowledgeRouter.get(
  "/search",
  asyncH(async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 500);
    const s = await getSettings();
    const hits = await searchKnowledge(q, { topK: s.knowledgeTopK, maxChars: s.knowledgeMaxChars });
    const totalChars = (await KnowledgeDoc.find({ enabled: true }).select("chars").lean()).reduce((n, d) => n + (d.chars ?? 0), 0);
    res.json({ hits, sentChars: hits.reduce((n, h) => n + h.text.length, 0), totalChars });
  })
);

knowledgeRouter.put(
  "/settings",
  asyncH(async (req, res) => {
    const patch: Record<string, unknown> = {};
    if ("enabled" in (req.body ?? {})) patch.knowledgeEnabled = Boolean(req.body.enabled);
    if ("topK" in (req.body ?? {})) patch.knowledgeTopK = Math.min(Math.max(Number(req.body.topK) || 4, 1), 10);
    if ("maxChars" in (req.body ?? {})) patch.knowledgeMaxChars = Math.min(Math.max(Number(req.body.maxChars) || 2500, 500), 8000);
    await getSettings();
    await Settings.updateOne({ _id: "global" }, patch);
    const s = await Settings.findById("global");
    res.json({ enabled: s!.knowledgeEnabled, topK: s!.knowledgeTopK, maxChars: s!.knowledgeMaxChars });
  })
);

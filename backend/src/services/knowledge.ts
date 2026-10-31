import fs from "node:fs";
import path from "node:path";
import { KnowledgeChunk, KnowledgeDoc, Settings, getSettings } from "../models/index.js";

/*  Knowledge base = "sirf zaroorat jitna data LLM ko"
    1. File upload → text nikalo (md / txt / pdf / docx)
    2. Text ko chhote tukdon (chunks) me todo — headings ke hisaab se, ~800 characters
    3. Customer ke har sawaal par BM25 search (keyword relevance) se sirf top 3–5 tukde chuno
    4. Sirf wahi tukde LLM ke system prompt me jaate hain — poori file kabhi nahi
    BM25 ke liye koi embedding API nahi chahiye, isliye ye har provider (aur Demo mode) ke saath chalta hai. */

export type FileType = "md" | "txt" | "pdf" | "docx";
export type KnowledgeHit = { docName: string; title: string; text: string; score: number };

const TARGET = 800; // ek chunk lagbhag itne characters
const MAX = 1200;

/* ───────────────────────── 1. File → text ───────────────────────── */

export function fileTypeOf(filename: string): FileType | null {
  const ext = path.extname(filename).toLowerCase().slice(1);
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt") return "txt";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  return null;
}

export async function extractText(buf: Buffer, type: FileType): Promise<string> {
  if (type === "md" || type === "txt") return buf.toString("utf8").replace(/^﻿/, "");
  if (type === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [text]).join("\n\n");
  }
  // docx → markdown (headings bache rehte hain, chunking behtar hoti hai)
  const mammoth = (await import("mammoth")).default;
  try {
    const r = await (mammoth as unknown as { convertToMarkdown: (i: { buffer: Buffer }) => Promise<{ value: string }> }).convertToMarkdown({ buffer: buf });
    // mammoth markdown me "\." jaise escapes daalta hai — hata do
    if (r.value.trim()) return r.value.replace(/__(.+?)__/g, "**$1**").replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
  } catch {
    /* neeche raw text try karo */
  }
  return (await mammoth.extractRawText({ buffer: buf })).value;
}

/* ───────────────────────── 2. Text → chunks ───────────────────────── */

const clean = (s: string) =>
  s
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Bada paragraph → sentence boundaries par todo */
function splitLong(text: string): string[] {
  if (text.length <= MAX) return [text];
  const sentences = text.match(/[^.!?।\n]+[.!?।]?\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > TARGET && cur) {
      out.push(cur.trim());
      cur = "";
    }
    if (s.length > MAX) {
      for (let i = 0; i < s.length; i += TARGET) out.push(s.slice(i, i + TARGET).trim());
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Ek section ke paragraphs ko ~800 char ke tukdon me jodo */
function pack(paragraphs: string[]): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of paragraphs.flatMap(splitLong)) {
    if (cur && (cur + "\n\n" + p).length > TARGET) {
      out.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkText(raw: string, docName: string, type: FileType): { title: string; text: string }[] {
  const text = clean(raw);
  if (!text) return [];
  const base = docName.replace(/\.[^.]+$/, "");

  // Markdown headings (# ## ###) se sections — docx bhi markdown ban ke aata hai
  const sections: { title: string; body: string[] }[] = [];
  const stack: string[] = [];
  let current = { title: base, body: [] as string[] };
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) current.body.push(para.join("\n").trim());
    para = [];
  };
  for (const line of text.split("\n")) {
    const h = (type === "md" || type === "docx") && line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flushPara();
      if (current.body.length) sections.push(current);
      const level = h[1].length;
      stack.splice(level - 1);
      stack[level - 1] = h[2].replace(/[*_`]/g, "").trim();
      current = { title: stack.filter(Boolean).join(" › "), body: [] };
    } else if (!line.trim()) flushPara();
    else para.push(line);
  }
  flushPara();
  if (current.body.length) sections.push(current);

  const chunks: { title: string; text: string }[] = [];
  for (const s of sections) {
    const parts = pack(s.body.filter(Boolean));
    parts.forEach((p, i) => chunks.push({ title: parts.length > 1 ? `${s.title} (${i + 1})` : s.title, text: p }));
  }
  return chunks;
}

/* ───────────────────────── 3. BM25 search ───────────────────────── */

const STOP = new Set(
  (
    "a an the is are was were be been am i me my we our you your he she it they them this that these those of to in on at for from by with and or not no do does did " +
    "can could will would should shall may might what which who whom how when where why there here please tell about any some more most also just than then so if " +
    "hai hain ho hoga hogi tha thi the ka ki ke ko me mein se par pe aur ya bhi kya kaise kab kahan kaun kitna kitne kitni kyu kyun koi kuch ye yeh wo woh is us " +
    "mujhe mera meri mere hum hamara humara aap aapka aapki aapke apna apni batao bataiye bataye batayein chahiye chaiye hota hoti karna karni karte kar raha rahi " +
    "ji haan nahi nhi ok okay hello hi namaste sir madam do de dijiye dena milega milegi sakta sakte sakti number"
  ).split(/\s+/)
);

/* Ek hi matlab ke alag shabd → ek shabd. Customer "rate" / "kimat" bolta hai, file me "pricing" likha hota hai. */
const SAME = new Map<string, string>(
  Object.entries({
    price: "price pricing rate cost charge fee fees kimat keemat daam",
    timing: "timing time hour schedule samay",
    refund: "refund return",
  }).flatMap(([key, words]) => words.split(" ").map((w) => [w, key] as [string, string]))
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ₹]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)) // services → service
    .map((w) => SAME.get(w) ?? w);
}

type IndexedChunk = { docId: string; docName: string; title: string; text: string; tf: Map<string, number>; len: number };
let index: { chunks: IndexedChunk[]; df: Map<string, number>; avgLen: number; sig: string } | null = null;

/** Upload / delete / on-off ke baad cache hata do — agla search naya index banayega */
export function invalidateIndex() {
  index = null;
}

async function getIndex() {
  // Knowledge MCP server alag process me chalta hai — use backend ka invalidateIndex() pata nahi chalta.
  // Isliye har search par ek chhota check: enabled files ki list / updatedAt badli to index dobara banao.
  const enabledDocs = await KnowledgeDoc.find({ enabled: true }).select("_id updatedAt").lean();
  const sig = enabledDocs.map((d) => `${d._id}:${d.updatedAt ? new Date(d.updatedAt).getTime() : 0}`).sort().join(",");
  if (index && index.sig === sig) return index;
  const rows = enabledDocs.length
    ? await KnowledgeChunk.find({ docId: { $in: enabledDocs.map((d) => d._id) } }).select("docId docName title text").lean()
    : [];
  const df = new Map<string, number>();
  const chunks: IndexedChunk[] = rows.map((r: any) => {
    // Sirf apni heading (aakhri hissa) 2 baar — wo shabd zyada important.
    // File ka main title ("Company — WhatsApp, SMS & RCS") har tukde me hota hai; use score me jodne se
    // "whatsapp" jaisa shabd har jagah dikhta aur bekaar ho jaata — isliye wo nahi jodte.
    const own = (r.title ?? "").split(" › ").pop() ?? "";
    const tokens = tokenize(`${own} ${own} ${r.text ?? ""}`);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { docId: String(r.docId || ""), docName: r.docName ?? "", title: r.title ?? "", text: r.text ?? "", tf, len: tokens.length };
  });
  const avgLen = chunks.reduce((n, c) => n + c.len, 0) / Math.max(1, chunks.length);
  return (index = { chunks, df, avgLen, sig });
}

export async function searchKnowledge(
  query: string,
  opts: { topK: number; maxChars: number; docId?: string }
): Promise<KnowledgeHit[]> {
  const terms = [...new Set(tokenize(query))];
  const { chunks, df, avgLen } = await getIndex();
  if (!chunks.length) return [];

  const targetChunks = opts.docId && opts.docId !== "all"
    ? chunks.filter((c) => String(c.docId) === String(opts.docId))
    : chunks;

  if (!targetChunks.length) return [];

  // If query terms empty but specific doc requested, return top chunks of that doc
  if (!terms.length) {
    return targetChunks.slice(0, opts.topK).map((c) => ({
      docName: c.docName,
      title: c.title,
      text: c.text,
      score: 1.0,
    }));
  }

  const N = targetChunks.length;
  const k1 = 1.2;
  const b = 0.75;
  const scored = targetChunks
    .map((c) => {
      let score = 0;
      for (const t of terms) {
        const f = c.tf.get(t);
        if (!f) continue;
        const n = df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.len) / avgLen)));
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, z) => z.score - a.score);

  if (!scored.length) {
    if (opts.docId && opts.docId !== "all") {
      return targetChunks.slice(0, opts.topK).map((c) => ({
        docName: c.docName,
        title: c.title,
        text: c.text,
        score: 0.5,
      }));
    }
    return [];
  }
  const best = scored[0].score;
  const hits: KnowledgeHit[] = [];
  let chars = 0;
  const seen = new Set<string>();
  for (const { c, score } of scored) {
    if (hits.length >= opts.topK) break;
    if (seen.has(c.text)) continue; // ek jaisa tukda do baar mat bhejo
    seen.add(c.text);
    if (score < best * 0.35) break; // bahut kam relevant → mat bhejo
    if (chars + c.text.length > opts.maxChars && hits.length) break; // character limit
    hits.push({ docName: c.docName, title: c.title, text: c.text, score: Math.round(score * 100) / 100 });
    chars += c.text.length;
  }
  return hits;
}

/** LLM ke system prompt me jaane wala hissa */
export function knowledgeBlock(hits: KnowledgeHit[]) {
  if (!hits.length) return "";
  return (
    "\n\nCompany knowledge relevant to the customer's latest message (from uploaded files). " +
    "Use it when it answers the question; if it does not cover the question, say you will check with the team. " +
    "Do not mention these notes or file names to the customer.\n" +
    hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.text}`).join("\n\n")
  );
}

/* ───────── "AI khud maange" mode ─────────
   Backend data nahi bhejta — sirf batata hai ki kaunsi files hain aur tool kaise use karna hai.
   Data Knowledge MCP server (src/mcp-servers/knowledge.ts) se aata hai, jab LLM tool call kare. */
export type KnowledgeMode = "tool" | "inject" | "off";

export const KNOWLEDGE_TOOL_PREFIX = "knowledge__";

/** Setting + provider + kya knowledge server connected hai → is message ke liye final mode */
export function resolveKnowledgeMode(
  setting: string | undefined | null,
  providerName: string,
  opts: { enabled: boolean; toolAvailable: boolean }
): KnowledgeMode {
  if (!opts.enabled) return "off";
  if (!opts.toolAvailable) return "inject"; // knowledge server band / disconnected → purana tarika
  if (setting === "inject") return "inject";
  if (setting === "tool") return providerName === "demo" ? "inject" : "tool"; // Demo me LLM hi nahi
  // auto: tool calling achhi tarah karne wale providers → tool; baaki → inject
  return providerName === "claude" || providerName === "openai" ? "tool" : "inject";
}

export async function knowledgeToolPrompt() {
  const docs = await KnowledgeDoc.find({ enabled: true }).select("name").lean();
  if (!docs.length) return "";
  return (
    "\n\nCompany knowledge: the company's files are NOT included in this prompt. " +
    `Before answering any question about the company, its services, prices, timings, policies or other facts, call the ${KNOWLEDGE_TOOL_PREFIX}search_knowledge tool with a short keyword query ` +
    "(call it again with different keywords if the first result does not answer, or once per item when comparing). " +
    `If a result is cut short, use ${KNOWLEDGE_TOOL_PREFIX}read_document. ` +
    "Answer only from what the tools return; if they have nothing, say the team will confirm. " +
    "Do not call these tools for greetings or small talk. Do not mention tools or file names to the customer.\n" +
    `Files available: ${docs.map((d) => d.name).join(", ")}`
  );
}

/* ───────────────────────── Save a file ───────────────────────── */

export async function addDocument(name: string, buf: Buffer) {
  const type = fileTypeOf(name);
  if (!type) throw new Error("Only .md, .txt, .pdf and .docx files are supported");
  const text = await extractText(buf, type);
  if (!text.trim()) throw new Error(type === "pdf" ? "No text found — scanned PDFs (images) can't be read" : "File is empty");
  const chunks = chunkText(text, name, type);
  // Same naam ki file pehle se hai → purani hata do (dobara upload = update)
  const old = await KnowledgeDoc.find({ name }).select("_id").lean();
  if (old.length) {
    await KnowledgeChunk.deleteMany({ docId: { $in: old.map((d) => d._id) } });
    await KnowledgeDoc.deleteMany({ _id: { $in: old.map((d) => d._id) } });
  }
  const doc = await KnowledgeDoc.create({ name, type, size: buf.length, chars: text.length, chunkCount: chunks.length });
  await KnowledgeChunk.insertMany(chunks.map((c, i) => ({ docId: doc._id, docName: name, title: c.title, text: c.text, order: i })));
  invalidateIndex();
  return doc;
}

/* ───────── Project ke saath aane wali files (knowledge-files/) ─────────
   Pehli baar backend chalne par ye apne aap Knowledge base me aa jaati hain — bot turant company ke baare me bol sake.
   Har file sirf EK BAAR: dashboard se delete karoge to wapas nahi aayegi. Badli hui file dashboard se dobara upload karo. */
const SEED_DIR = path.resolve("../knowledge-files");

export async function seedKnowledgeFiles() {
  if (!fs.existsSync(SEED_DIR)) return;
  const s = await getSettings();
  const done = new Set(s.seededKnowledge ?? []);
  for (const name of fs.readdirSync(SEED_DIR).sort()) {
    if (done.has(name) || !fileTypeOf(name)) continue;
    try {
      if (!(await KnowledgeDoc.exists({ name }))) {
        const doc = await addDocument(name, fs.readFileSync(path.join(SEED_DIR, name)));
        console.log(`[knowledge] added "${name}" (${doc.chunkCount} parts)`);
      }
      done.add(name);
    } catch (err) {
      console.error(`[knowledge] could not add "${name}":`, err instanceof Error ? err.message : err);
    }
  }
  await Settings.updateOne({ _id: "global" }, { seededKnowledge: [...done] });
}

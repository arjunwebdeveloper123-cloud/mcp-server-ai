import mongoose, { Schema, model } from "mongoose";

// ---- Lead model (MongoDB collection: "leads") ----
const leadSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    service: { type: String, required: true },
    company: { type: String, trim: true },
    volume: { type: String, trim: true }, // kitne messages / month, jaise "1 lakh"
    message: { type: String },
    status: { type: String, enum: ["new", "contacted", "converted"], default: "new" },
  },
  { timestamps: true }
);

export const Lead = model("Lead", leadSchema);

// ---- Services list: backend/src/company.ts (ek hi jagah — bot, demo mode, flow template sab wahi se) ----
export { COMPANY, SERVICES, SERVICE_IDS } from "../../company.js";

export async function connectDB(uri: string) {
  await mongoose.connect(uri);
  // IMPORTANT: stdio MCP server me console.log() mat use karo — stdout sirf MCP messages ke liye hai.
  console.error("[leads-server] MongoDB connected");
}

import mongoose, { Schema, model } from "mongoose";

// ---- Lead model (MongoDB collection: "leads") ----
const leadSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    service: { type: String, required: true },
    message: { type: String },
    status: { type: String, enum: ["new", "contacted", "converted"], default: "new" },
  },
  { timestamps: true }
);

export const Lead = model("Lead", leadSchema);

// ---- Services list (aap ise bhi DB me rakh sakte ho) ----
export const SERVICES = [
  { id: "website", name: "Website design & development", startingPrice: "₹15,000" },
  { id: "seo", name: "SEO", startingPrice: "₹8,000 / month" },
  { id: "gmb", name: "Google Business Profile management", startingPrice: "₹5,000 / month" },
  { id: "social", name: "Social media management", startingPrice: "₹10,000 / month" },
];

export async function connectDB(uri: string) {
  await mongoose.connect(uri);
  // IMPORTANT: stdio MCP server me console.log() mat use karo — stdout sirf MCP messages ke liye hai.
  console.error("[mcp-server] MongoDB connected");
}

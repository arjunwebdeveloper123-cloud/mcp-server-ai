import crypto from "node:crypto";
import mongoose, { Schema, model } from "mongoose";

/* ───────── Appointment model (MongoDB collection: "appointments") ───────── */
const appointmentSchema = new Schema(
  {
    bookingId: { type: String, required: true, unique: true }, // jaise APT-7K2Q
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD (IST)
    time: { type: String, required: true }, // HH:MM (IST)
    topic: { type: String, trim: true },
    status: { type: String, enum: ["booked", "cancelled"], default: "booked" },
  },
  { timestamps: true }
);

export const Appointment = model("Appointment", appointmentSchema);

/** Chhota, padhne layak booking id (0/O, 1/I jaise confusing characters nahi) */
export function newBookingId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(5);
  return "APT-" + Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function connectDB(uri: string) {
  await mongoose.connect(uri);
  // stdio MCP server: console.log() mat karo — stdout sirf MCP messages ke liye hai
  console.error("[appointment-server] MongoDB connected");
}

/*  Company ki basic jaankari — EK hi jagah.
    Lead server (get_services / save_lead), Demo mode, Flow template aur bot ka welcome message sab yahin se padhte hain.
    Kisi aur company ka bot banana ho to sirf ye file (aur Knowledge base ki .md file) badlo.

    Source: https://cloudgateway.in (home, services aur pricing pages) — prices + 18% GST.  */

export const COMPANY = {
  name: "Sequence Cloud Gateway",
  short: "Cloud Gateway",
  about: "India ka CPaaS (Communications Platform as a Service) — SMS, WhatsApp, Voice, Email, RCS aur SMPP ek hi platform se.",
  phone: "+91-9599300365",
  whatsapp: "https://wa.me/919599300365",
  email: "info@cloudgateway.in",
  website: "https://cloudgateway.in",
  demoUrl: "https://cloudgateway.in/demo_regi.html",
  pricingUrl: "https://cloudgateway.in/pricing-sms-voice-email-wa.html",
  headOffice: "8th Floor, Aggarwal Corporate Height, 803, Netaji Subhash Place, Pitampura, Delhi 110034",
  otherOffices: "Mumbai, Bengaluru, Gurugram, Karnal (Haryana), Dubai",
};

export type Service = {
  id: string;
  name: string;
  short: string; // buttons / dashboard ke liye chhota naam
  startingPrice: string;
  summary: string;
  page: string;
  words: RegExp; // Demo mode me customer ke message se service pehchanna
};

export const SERVICES: Service[] = [
  {
    id: "whatsapp_marketing",
    name: "Bulk WhatsApp Marketing",
    short: "Bulk WhatsApp",
    startingPrice: "₹15,000 + GST per 1 lakh messages (15 paise/message); 10 lakh = ₹1,10,000 + GST (11 paise)",
    summary: "Managed bulk WhatsApp campaigns with images, videos, PDFs, catalogs and CTA buttons (+2 paise/message for button campaigns).",
    page: "https://cloudgateway.in/whatsapp-marketing-services",
    words: /\b(bulk whatsapp|whatsapp marketing|whatsapp campaign|whatsapp bulk)\b/,
  },
  {
    id: "whatsapp_api",
    name: "WhatsApp Business API",
    short: "WhatsApp API",
    startingPrice: "Marketing 95 paise, Utility 19 paise per message + GST; one-time activation ₹10,000 + GST",
    summary: "Official WhatsApp Business API — verified profile, chatbot, multi-agent inbox, CRM integration, OTP and transactional messages.",
    page: "https://cloudgateway.in/whatsapp-business-api.html",
    words: /\b(whatsapp (business )?api|wa api|green tick|blue tick|whatsapp chatbot)\b/,
  },
  {
    id: "bulk_sms",
    name: "Bulk SMS (Promotional / Transactional)",
    short: "Bulk SMS",
    startingPrice: "₹13,000 + GST per 1 lakh SMS (13 paise); 10 lakh = ₹1,00,000 + GST (10 paise). DLT registration mandatory",
    summary: "Promotional, transactional and OTP SMS across India with DLT compliance, DND filtering, Hindi/regional languages and delivery reports.",
    page: "https://cloudgateway.in/bulk-sms.html",
    words: /\b(bulk sms|sms|text message|otp|dlt|sender id|promotional|transactional)\b/,
  },
  {
    id: "sms_api",
    name: "Bulk SMS API",
    short: "SMS API",
    startingPrice: "₹15,000 + GST per 1 lakh SMS; 10 lakh = ₹1,30,000 + GST",
    summary: "SMS API for websites, apps, CRMs and ERPs — OTP, alerts, smart retry, URL shortener with click tracking.",
    page: "https://cloudgateway.in/sms-api-services-providers",
    words: /\b(sms api|sms gateway|otp api|api)\b/,
  },
  {
    id: "voice_call",
    name: "Bulk Voice Call",
    short: "Voice Call",
    startingPrice: "₹11,000 + GST per 1 lakh calls; 10 lakh = ₹90,000 + GST",
    summary: "Pre-recorded / text-to-speech voice broadcast in many languages, auto retry, keypress surveys, live reports.",
    page: "https://cloudgateway.in/bulk-voicecall.html",
    words: /\b(voice|voice calls?|bulk calls?|ivr|obd|recorded calls?|calling)\b/,
  },
  {
    id: "email",
    name: "Bulk Email Campaigns",
    short: "Bulk Email",
    startingPrice: "₹5,000 + GST per 1 lakh emails (5 paise); 10 lakh = ₹45,000 + GST (4.5 paise)",
    summary: "Email campaigns with templates, segmentation, scheduling, automation and open/click analytics.",
    page: "https://cloudgateway.in/bulk-email-marketing.html",
    words: /\b(email|e-mail|mail|newsletter)\b/,
  },
  {
    id: "rcs",
    name: "RCS Messaging",
    short: "RCS",
    startingPrice: "30 paise per message (text or media), minimum 1 lakh; one-time activation ₹9,999; charged only on delivery",
    summary: "Rich branded messages in the Android messaging app — verified brand, images, videos, carousels and buttons, no app download.",
    page: "https://cloudgateway.in/rcs-messaging-services",
    words: /\b(rcs|rich message|rich sms|google messages)\b/,
  },
  {
    id: "smpp",
    name: "SMPP SMS",
    short: "SMPP",
    startingPrice: "Custom quote (volume based, starts from 1 lakh messages)",
    summary: "SMPP binds for enterprises and aggregators — direct operator routes, high throughput, real-time DLRs.",
    page: "https://cloudgateway.in/smpp-services-providers",
    words: /\b(smpp|bind|aggregator|reseller|tps)\b/,
  },
];

export const SERVICE_IDS = SERVICES.map((s) => s.id) as [string, ...string[]];

export const serviceLabel = (id?: string) => SERVICES.find((s) => s.id === id)?.short ?? id ?? "";

/** Customer ke message se service pehchano — specific (API, marketing) pehle, general (sms) baad me */
export function detectService(lower: string): string | undefined {
  const order = ["whatsapp_api", "whatsapp_marketing", "sms_api", "smpp", "rcs", "voice_call", "email", "bulk_sms"];
  for (const id of order) if (SERVICES.find((s) => s.id === id)!.words.test(lower)) return id;
  if (/\bwhatsapp\b/.test(lower)) return "whatsapp_marketing";
  return undefined;
}

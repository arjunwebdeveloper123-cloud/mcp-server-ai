/* Cloud Gateway PinBot API & WhatsApp integration */

export type SendWhatsAppMessageParams = {
  provider?: "cloudgateway" | "pinbot" | "meta" | "custom";
  apiUrl?: string;
  phoneNumberId?: string;
  apiKey?: string;
  to: string;
  text?: string;
  template?: {
    name: string;
    language: { code: string };
    components?: unknown[];
  };
};

export type WhatsAppSendResult = {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  provider: string;
  to: string;
};

/**
 * Send WhatsApp message via Cloud Gateway (PinBot v3 API)
 * Target URL: https://partnersv1.pinbot.ai/v3/<<phone_id>>/messages
 * Header: apikey: <<apikey_value>>
 */
export async function sendWhatsAppMessage({
  provider = "cloudgateway",
  apiUrl,
  phoneNumberId,
  apiKey,
  to,
  text,
  template,
}: SendWhatsAppMessageParams): Promise<WhatsAppSendResult> {
  const cleanTo = to.replace(/[^0-9]/g, "");

  // Priority: function parameter -> env vars
  const phoneId = (
    phoneNumberId ||
    process.env.CLOUDGATEWAY_PHONE_ID ||
    process.env.PINBOT_PHONE_ID ||
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    ""
  ).trim();

  const key = (
    apiKey ||
    process.env.CLOUDGATEWAY_API_KEY ||
    process.env.PINBOT_API_KEY ||
    process.env.WHATSAPP_API_KEY ||
    process.env.WHATSAPP_TOKEN ||
    ""
  ).trim();

  if (!phoneId) {
    return {
      ok: false,
      provider,
      to: cleanTo,
      error: "WhatsApp Phone Number ID (phone_id) is missing. Please set it in Deploy Bot or Webhook node settings.",
    };
  }

  if (!key) {
    return {
      ok: false,
      provider,
      to: cleanTo,
      error: "Panel API Key (apikey) is missing. Please set it in Deploy Bot or Webhook node settings.",
    };
  }

  const isMetaDirect = provider === "meta";
  const defaultBaseUrl = isMetaDirect
    ? "https://graph.facebook.com/v21.0"
    : "https://partnersv1.pinbot.ai/v3";
  const rawUrl = (apiUrl || defaultBaseUrl).trim().replace(/\/+$/, "");

  // Intelligently handle base URL, placeholder URL, or full endpoint URL
  let targetUrl: string;
  if (rawUrl.includes("<<phone_id>>")) {
    targetUrl = rawUrl.replace(/<<phone_id>>/g, encodeURIComponent(phoneId));
  } else if (rawUrl.includes("{phone_id}")) {
    targetUrl = rawUrl.replace(/\{phone_id\}/g, encodeURIComponent(phoneId));
  } else if (rawUrl.includes("{{phone_id}}")) {
    targetUrl = rawUrl.replace(/\{\{phone_id\}\}/g, encodeURIComponent(phoneId));
  } else if (rawUrl.endsWith("/messages")) {
    targetUrl = rawUrl;
  } else {
    targetUrl = `${rawUrl}/${encodeURIComponent(phoneId)}/messages`;
  }

  // Headers: PinBot uses 'apikey: <<key>>', Meta uses 'Authorization: Bearer <<key>>'
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isMetaDirect) {
    headers["Authorization"] = `Bearer ${key}`;
  } else {
    headers["apikey"] = key;
  }

  // Request Body: template or text
  const body = template
    ? {
        messaging_product: "whatsapp",
        to: cleanTo,
        type: "template",
        template,
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanTo,
        type: "text",
        text: { preview_url: true, body: text || "" },
      };

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(18_000),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const errObj = (data.error as Record<string, unknown>) ?? {};
      const errMsg =
        (errObj.message as string) ||
        (typeof data.message === "string" ? data.message : null) ||
        res.statusText ||
        `HTTP ${res.status}`;
      return {
        ok: false,
        status: res.status,
        provider,
        to: cleanTo,
        error: `Cloud Gateway WhatsApp error (${res.status}): ${errMsg}`,
        data,
      };
    }

    return {
      ok: true,
      status: res.status,
      provider,
      to: cleanTo,
      data,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      provider,
      to: cleanTo,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

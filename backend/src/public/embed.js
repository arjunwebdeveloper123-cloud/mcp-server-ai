/* Website par chatbot embed karne ki script.
   Usage:
   <script src="https://YOUR-BACKEND/embed.js" defer></script>
   (optional) data-widget-url="https://YOUR-FRONTEND/widget"                         */
(function () {
  if (window.__mcpChatbotLoaded) return;
  window.__mcpChatbotLoaded = true;

  var script = document.currentScript;
  var backend = new URL(script.src).origin;
  var widgetUrl = script.getAttribute("data-widget-url") || "__WIDGET_URL__";

  fetch(backend + "/api/widget/config")
    .then(function (r) { return r.json(); })
    .catch(function () { return {}; })
    .then(function (cfg) {
      var color = cfg.brandColor || "#0f6e56";
      var side = cfg.widgetPosition === "left" ? "left" : "right";

      var btn = document.createElement("button");
      btn.setAttribute("aria-label", "Open chat");
      btn.innerHTML =
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      Object.assign(btn.style, {
        position: "fixed", bottom: "20px", width: "58px", height: "58px", borderRadius: "50%",
        border: "0", background: color, cursor: "pointer", zIndex: 2147483646,
        boxShadow: "0 6px 20px rgba(0,0,0,.2)", display: "grid", placeItems: "center",
      });
      btn.style[side] = "20px";

      var frame = document.createElement("iframe");
      frame.src = widgetUrl;
      frame.title = cfg.botName || "Chat";
      Object.assign(frame.style, {
        position: "fixed", bottom: "90px", width: "380px", height: "560px",
        maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 110px)",
        border: "0", borderRadius: "16px", boxShadow: "0 12px 40px rgba(0,0,0,.18)",
        zIndex: 2147483647, display: "none", background: "#fff",
      });
      frame.style[side] = "20px";

      btn.onclick = function () {
        var open = frame.style.display === "none";
        frame.style.display = open ? "block" : "none";
        btn.setAttribute("aria-label", open ? "Close chat" : "Open chat");
      };

      document.body.appendChild(frame);
      document.body.appendChild(btn);
    });
})();

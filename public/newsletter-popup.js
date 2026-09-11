/*!
 * Plexo newsletter popup runtime.
 *
 * Injected by the page shell (app/pub/[domain]/[[...slug]]/route.ts) only when a site owner
 * has turned this on AND configured a MailDrip newsletter group (CommerceSettings.
 * newsletterPopupEnabled + maildripNewsletterGroupId) — independent of Commerce/payments
 * being enabled, since newsletter capture isn't a commerce-only feature. Posts to
 * /api/public/commerce/newsletter, the same per-site endpoint the embeddable newsletter
 * form block already uses, so both paths tag a subscriber into the SAME site-owned
 * MailDrip group.
 */
(function () {
  "use strict";

  var DISMISS_KEY = "plexo_newsletter_popup_dismissed_at";
  var DISMISS_DAYS = 30;
  var DELAY_MS = 5000;
  var shown = false;
  var activePopup = null;

  function wasRecentlyDismissed() {
    try {
      var raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      var dismissedAt = Number(raw);
      if (!isFinite(dismissedAt)) return false;
      return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch (e) {
      // Private browsing / storage blocked — fail open (show it) rather than never showing.
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) {
      // Worst case it shows again next visit.
    }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === "style") {
        Object.assign(node.style, attrs.style);
      } else if (key.indexOf("on") === 0 && typeof attrs[key] === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
      } else {
        node.setAttribute(key, attrs[key]);
      }
    });
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function close() {
    if (activePopup && activePopup.parentNode) activePopup.parentNode.removeChild(activePopup);
    activePopup = null;
    markDismissed();
  }

  function showPopup() {
    if (activePopup) return;

    var closeBtn = el(
      "button",
      {
        type: "button",
        "aria-label": "Close",
        onclick: close,
        style: {
          position: "absolute", top: "12px", right: "12px", width: "28px", height: "28px",
          display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.05)",
          border: "none", borderRadius: "8px", color: "#565F72", cursor: "pointer", fontSize: "14px", lineHeight: "1",
        },
      },
      ["✕"]
    );

    var heading = el("h3", { style: { margin: "0 0 8px", fontSize: "19px", fontWeight: "800", color: "#16233F", fontFamily: "inherit" } }, ["Stay in the loop"]);
    var subtext = el(
      "p",
      { style: { margin: "0 0 18px", fontSize: "13.5px", color: "#565F72", lineHeight: "1.5", fontFamily: "inherit" } },
      ["Sign up for updates — no spam, unsubscribe anytime."]
    );

    var emailInput = el("input", {
      type: "email",
      placeholder: "you@example.com",
      style: {
        width: "100%", padding: "12px 14px", fontSize: "14px", border: "1px solid #E4E1D6",
        borderRadius: "8px", marginBottom: "10px", boxSizing: "border-box", fontFamily: "inherit",
      },
    });

    var message = el("p", { style: { margin: "0 0 10px", fontSize: "12.5px", display: "none", fontFamily: "inherit" } }, []);

    var submitBtn = el(
      "button",
      {
        type: "button",
        style: {
          width: "100%", padding: "12px", fontSize: "14px", fontWeight: "700", color: "#fff",
          background: "#16233F", border: "none", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit",
        },
        onclick: function () {
          var email = emailInput.value.trim();
          if (!email || email.indexOf("@") === -1) {
            message.style.display = "block";
            message.style.color = "#8C3A2E";
            message.textContent = "Enter a valid email address.";
            return;
          }
          submitBtn.disabled = true;
          submitBtn.textContent = "Subscribing…";
          fetch("/api/public/commerce/newsletter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email }),
          })
            .then(function (res) {
              return res.json().catch(function () { return {}; }).then(function (data) {
                if (!res.ok) throw new Error(data.error || "Something went wrong.");
                return data;
              });
            })
            .then(function () {
              markDismissed();
              heading.textContent = "You're in!";
              subtext.textContent = "Thanks for subscribing.";
              emailInput.style.display = "none";
              submitBtn.style.display = "none";
              message.style.display = "none";
              setTimeout(close, 2500);
            })
            .catch(function (err) {
              submitBtn.disabled = false;
              submitBtn.textContent = "Subscribe";
              message.style.display = "block";
              message.style.color = "#8C3A2E";
              message.textContent = err.message || "Something went wrong.";
            });
        },
      },
      ["Subscribe"]
    );

    var card = el(
      "div",
      {
        style: {
          position: "relative", width: "100%", maxWidth: "380px", background: "#FFFFFF",
          borderRadius: "16px", padding: "28px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          fontFamily: "'Public Sans', system-ui, sans-serif",
        },
      },
      [closeBtn, heading, subtext, emailInput, message, submitBtn]
    );

    var overlay = el(
      "div",
      {
        style: {
          position: "fixed", inset: "0", zIndex: "997", background: "rgba(15,15,25,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", boxSizing: "border-box",
        },
        onclick: function (e) {
          if (e.target === overlay) close();
        },
      },
      [card]
    );

    document.body.appendChild(overlay);
    activePopup = overlay;
  }

  function trigger() {
    if (shown || wasRecentlyDismissed()) return;
    shown = true;
    showPopup();
  }

  function init() {
    if (wasRecentlyDismissed()) return;
    setTimeout(trigger, DELAY_MS);
    document.addEventListener("mouseleave", function (e) {
      if (e.clientY <= 0) trigger();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

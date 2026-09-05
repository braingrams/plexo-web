/*!
 * Plexo Funnel/LMS signup runtime.
 *
 * Injected by the page shell (app/pub/[domain]/[[...slug]]/route.ts) whenever a page's own
 * HTML contains a `data-plexo-lms-signup` marker — a plain div a funnel admin drops
 * anywhere in their own page (hand-typed into a raw HTML upload, or pasted into an 'html'
 * block on the visual canvas — see Funnel Settings' "Embed your signup form" for the exact
 * copyable snippet). Not a native plexo-sdk element type — same "plain marker attribute,
 * no SDK change needed" pattern commerce.js's own data-plexo-commerce-product-count already
 * proves out for a different marker. Finds every marker and mounts a real signup form into
 * it client-side. Plain vanilla JS, no build step, no dependency on anything else this page
 * loads — sanitizeCompiledHtml.ts strips <script> tags from the compiled body itself, so
 * this file is the ONLY place this behavior can live.
 */
(function () {
  "use strict";

  var STYLE_ID = "plexo-lms-signup-style";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      ".pls-root{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-sizing:border-box;}",
      ".pls-root *{box-sizing:border-box;}",
      ".pls-card{background:#ffffff;border:1px solid rgba(15,23,42,0.08);border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(15,23,42,0.08);max-width:420px;margin:0 auto;}",
      ".pls-title{font-size:19px;font-weight:800;color:#0f172a;margin-bottom:4px;line-height:1.3;}",
      ".pls-subtitle{font-size:13.5px;color:#64748b;margin-bottom:18px;line-height:1.5;}",
      ".pls-price{display:inline-flex;font-size:13px;font-weight:700;color:#7c3aed;background:rgba(139,92,246,0.1);padding:5px 12px;border-radius:100px;margin-bottom:18px;}",
      ".pls-price-free{color:#16a34a;background:rgba(22,163,74,0.1);}",
      ".pls-label{display:block;font-size:12.5px;font-weight:600;color:#334155;margin:0 0 6px;}",
      ".pls-input{width:100%;padding:11px 14px;font-size:14px;border:1px solid #e2e8f0;border-radius:10px;font-family:inherit;color:#0f172a;background:#fff;margin-bottom:14px;}",
      ".pls-input:focus{outline:2px solid #8b5cf6;outline-offset:0;border-color:transparent;}",
      ".pls-btn{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;padding:13px 20px;font-size:14.5px;font-weight:700;cursor:pointer;border-radius:10px;font-family:inherit;box-shadow:0 4px 14px rgba(139,92,246,0.35);}",
      ".pls-btn:hover{filter:brightness(1.05);}",
      ".pls-btn:disabled{opacity:0.6;cursor:not-allowed;}",
      ".pls-error{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:9px 12px;border-radius:9px;font-size:13px;margin-bottom:14px;}",
      ".pls-success-icon{width:44px;height:44px;border-radius:50%;background:rgba(22,163,74,0.12);display:flex;align-items:center;justify-content:center;color:#16a34a;margin-bottom:14px;}",
      ".pls-muted{font-size:13.5px;color:#64748b;line-height:1.55;}",
      ".pls-spin{width:22px;height:22px;border-radius:50%;border:2.5px solid rgba(139,92,246,0.2);border-top-color:#8b5cf6;animation:pls-spin 0.7s linear infinite;}",
      "@keyframes pls-spin{to{transform:rotate(360deg);}}",
    ];
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css.join("\n");
    document.head.appendChild(style);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(path, Object.assign({ credentials: "same-origin" }, opts, { headers: headers })).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
          return data;
        });
    });
  }

  // ---------------------------------------------------------------------
  // Stripe embedded checkout — copied verbatim from commerce.js (same self-contained
  // shape, no shared dependency between the two runtimes). Mounted in-page instead of
  // redirecting to checkout.stripe.com.
  // ---------------------------------------------------------------------
  var stripeJsPromise = null;
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (!stripeJsPromise) {
      stripeJsPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = "https://js.stripe.com/v3/";
        script.onload = function () {
          resolve(window.Stripe);
        };
        script.onerror = function () {
          reject(new Error("Couldn't load Stripe."));
        };
        document.head.appendChild(script);
      });
    }
    return stripeJsPromise;
  }

  function openStripeEmbeddedCheckout(checkout, onError) {
    var overlay = el("div", {
      style: {
        position: "fixed", inset: "0", zIndex: "999999", background: "rgba(6,7,15,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
      },
    });
    var box = el("div", {
      style: {
        background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "560px", maxHeight: "90vh",
        overflow: "auto", position: "relative", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      },
    });
    var mountPoint = el("div", { id: "pls-stripe-embedded-checkout" });
    var closeBtn = el(
      "button",
      {
        type: "button",
        onclick: function () {
          close();
        },
        style: {
          position: "absolute", top: "12px", right: "12px", zIndex: "1", width: "30px", height: "30px",
          display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,15,25,0.06)",
          border: "none", borderRadius: "8px", color: "rgba(15,15,25,0.6)", cursor: "pointer", fontSize: "16px", lineHeight: "1",
        },
      },
      ["✕"]
    );
    box.appendChild(closeBtn);
    box.appendChild(mountPoint);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var embeddedInstance = null;
    function close() {
      if (embeddedInstance) {
        try {
          embeddedInstance.destroy();
        } catch (e) {}
      }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });

    loadStripeJs()
      .then(function (Stripe) {
        var stripe = Stripe(checkout.publishableKey);
        return stripe.initEmbeddedCheckout({ clientSecret: checkout.clientSecret });
      })
      .then(function (instance) {
        embeddedInstance = instance;
        instance.mount("#pls-stripe-embedded-checkout");
      })
      .catch(function (err) {
        close();
        if (onError) onError(err instanceof Error ? err : new Error("Couldn't start payment. Please try again."));
      });

    return close;
  }

  function money(minor, currency) {
    currency = currency || "NGN";
    var major = (minor || 0) / 100;
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency }).format(major);
    } catch (e) {
      return currency + " " + major.toFixed(2);
    }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var val = attrs[key];
      if (val === null || val === undefined) return;
      if (key === "style" && typeof val === "object") {
        Object.keys(val).forEach(function (prop) {
          node.style[prop] = val[prop];
        });
      } else if (key === "html") {
        node.innerHTML = val;
      } else if (key.indexOf("on") === 0 && typeof val === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === "class") {
        node.className = val;
      } else {
        node.setAttribute(key, val);
      }
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Same reasoning as commerce.js's own prepareNode: the marker's authored height (an
  // editor placeholder size) isn't a runtime constraint — a real form needs more room than
  // an empty placeholder did.
  function prepareNode(node) {
    node.className = (node.className || "") + " pls-root";
    node.style.height = "auto";
    node.style.overflow = "visible";
  }

  function showSpinner(node) {
    clear(node);
    prepareNode(node);
    node.appendChild(el("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" } }, [el("div", { class: "pls-spin" })]));
  }

  function showFatalError(node, message) {
    clear(node);
    prepareNode(node);
    node.appendChild(el("div", { class: "pls-card" }, [el("div", { class: "pls-error", style: { marginBottom: "0" } }, [message])]));
  }

  function renderForm(node, templateId, meta) {
    var nameInput = null;
    var phoneInput = null;
    var emailInput;
    var submitBtn;
    var errorBox = el("div", {});
    var ctaLabel = meta.price ? "Continue" : "Start now — it's free";

    function renderIdle() {
      clear(errorBox);
      var children = [
        el("div", { class: "pls-title" }, [meta.name]),
        meta.price
          ? el("div", { class: "pls-price" }, [money(meta.price.priceMinor, meta.price.currency) + " — one-time"])
          : el("div", { class: "pls-price pls-price-free" }, ["Free"]),
      ];

      if (meta.requireName) {
        nameInput = el("input", { class: "pls-input", type: "text", placeholder: "Your name" });
        children.push(el("label", { class: "pls-label" }, ["Name"]), nameInput);
      }
      emailInput = el("input", { class: "pls-input", type: "email", placeholder: "you@example.com" });
      children.push(el("label", { class: "pls-label" }, ["Email"]), emailInput);
      if (meta.collectPhone) {
        phoneInput = el("input", { class: "pls-input", type: "tel", placeholder: "Optional" });
        children.push(el("label", { class: "pls-label" }, ["Phone number"]), phoneInput);
      }
      children.push(errorBox);
      submitBtn = el("button", { class: "pls-btn", type: "button", onclick: submit }, [ctaLabel]);
      children.push(submitBtn);

      clear(node);
      prepareNode(node);
      node.appendChild(el("div", { class: "pls-card" }, children));
    }

    function fieldError(message) {
      clear(errorBox);
      errorBox.appendChild(el("div", { class: "pls-error" }, [message]));
    }

    function submit() {
      var email = (emailInput.value || "").trim();
      if (!email || email.indexOf("@") === -1) {
        fieldError("Enter a valid email address.");
        return;
      }
      if (meta.requireName && (!nameInput.value || !nameInput.value.trim())) {
        fieldError("Name is required.");
        return;
      }
      clear(errorBox);
      submitBtn.disabled = true;
      submitBtn.textContent = meta.price ? "Redirecting…" : "Sending…";

      var payload = {
        name: nameInput ? nameInput.value.trim() : undefined,
        email: email,
        phone: phoneInput ? phoneInput.value.trim() : undefined,
      };

      if (!meta.price) {
        api("/api/public/lms/" + templateId + "/signup", { method: "POST", body: JSON.stringify(payload) })
          .then(function () {
            renderSent(email);
          })
          .catch(function (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = ctaLabel;
            fieldError(err.message || "Something went wrong.");
          });
        return;
      }

      // PAID — starts real payment via the same Commerce checkout infrastructure a normal
      // digital-product purchase uses (see .../signup/checkout/route.ts). returnUrl is this
      // exact page, so the visitor lands right back where they started once payment
      // completes (Stripe navigates there itself; Paystack redirects there).
      payload.returnUrl = window.location.href;
      api("/api/public/lms/" + templateId + "/signup/checkout", { method: "POST", body: JSON.stringify(payload) })
        .then(function (result) {
          if (result.checkout && result.checkout.provider === "stripe") {
            submitBtn.disabled = false;
            submitBtn.textContent = ctaLabel;
            openStripeEmbeddedCheckout(result.checkout, function (err) {
              fieldError(err.message || "Couldn't start payment. Please try again.");
            });
          } else if (result.authorizationUrl) {
            window.location.href = result.authorizationUrl;
          } else {
            throw new Error("Couldn't start payment. Please try again.");
          }
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = ctaLabel;
          fieldError(err.message || "Something went wrong.");
        });
    }

    function renderSent(email) {
      clear(node);
      prepareNode(node);
      node.appendChild(
        el("div", { class: "pls-card" }, [
          el("div", {
            class: "pls-success-icon",
            html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
          }),
          el("div", { class: "pls-title" }, ["Check your email"]),
          el("div", { class: "pls-muted" }, ["We sent a link to " + email + " — click it to start " + meta.name + "."]),
        ])
      );
    }

    renderIdle();
  }

  // Set on the returnUrl the checkout-initiation call sends Stripe/Paystack, so the
  // visitor's OWN browser (already on this exact page) shows a confirmation the moment
  // Stripe/Paystack navigates it back here — real enrollment activation happens
  // asynchronously via the payment webhook, not from this page load, so this is honestly a
  // "payment received, you're almost in" state, not proof of enrollment yet.
  function hasPaidReturnMarker() {
    return /[?&]plexo_lms_signup_paid=1(&|$)/.test(window.location.search);
  }

  function renderPaymentReceived(node, meta) {
    clear(node);
    prepareNode(node);
    node.appendChild(
      el("div", { class: "pls-card" }, [
        el("div", {
          class: "pls-success-icon",
          html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        }),
        el("div", { class: "pls-title" }, ["Payment received"]),
        el("div", { class: "pls-muted" }, ["We're finishing setting up your access to " + meta.name + " — check your email in a moment for your link in."]),
      ])
    );
  }

  function renderSignup(node) {
    var templateId = node.getAttribute("data-plexo-template-id");
    if (!templateId) {
      showFatalError(node, "This signup form is missing its funnel ID.");
      return;
    }
    showSpinner(node);
    api("/api/public/lms/" + templateId)
      .then(function (meta) {
        if (hasPaidReturnMarker()) {
          renderPaymentReceived(node, meta);
        } else {
          renderForm(node, templateId, meta);
        }
      })
      .catch(function (err) {
        showFatalError(node, err.message || "This funnel isn't available right now.");
      });
  }

  function init() {
    injectStyles();
    document.querySelectorAll("[data-plexo-lms-signup]").forEach(renderSignup);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/*!
 * Plexo form connector.
 *
 * Makes any <form> on a published Plexo site send its answers to the site's Form Submissions inbox
 * (with the owner's email notification, MailDrip list and webhook, thank-you page and spam
 * protection) — with no change to the form's own markup beyond, at most, one attribute:
 *
 *   <form data-plexo-form="Contact us"> … </form>
 *
 * Connected automatically: forms with no real destination (no action, "#", or a mailto: link), which
 * today go nowhere. Never touched: forms that already post to somewhere else, search/login forms,
 * and anything marked data-plexo-form="off".
 *
 * Optional attributes on the form:
 *   data-plexo-form      the name shown in the inbox ("Contact us"); defaults to the form's name/id
 *   data-plexo-success   the message shown after sending
 *   data-plexo-redirect  a page on this site to go to after sending (overrides the success message)
 *
 * One delegated listener on the document, so it works for forms that are added later (React and
 * other single-page apps) and for forms in the visual builder, raw HTML uploads and React projects.
 * The script tag carries data-template-id (the site) and data-auto ("false" for React projects,
 * where only explicitly marked forms are connected).
 */
(function () {
  "use strict";
  if (window.__plexoFormsLoaded) return;
  window.__plexoFormsLoaded = true;

  var script = document.currentScript;
  var TEMPLATE_ID = script && script.getAttribute("data-template-id");
  var AUTO = !(script && script.getAttribute("data-auto") === "false");
  if (!TEMPLATE_ID) return;

  var HONEYPOT = "_hp_field"; // must match lib/v2/forms.ts V2_FORM_HONEYPOT_FIELD_NAME
  var DEFAULT_SUCCESS = "Thank you! We've received your message and someone will reach out to you soon.";
  var ERROR_TEXT = "Sorry, that didn't send. Please check your details and try again.";

  function marker(form) {
    var v = form.getAttribute("data-plexo-form");
    return v === null ? null : v.trim();
  }

  // Forms that belong to the shop — checkout, order tracking, donations — already have their own
  // working handler that creates the order or payment. Taking one over would swallow the real
  // submit and show "message sent" while NO order is made (the buyer has paid, the owner sees
  // nothing). So on a commerce site the connector never auto-connects a form on the storefront or
  // checkout pages, nor one carrying another Plexo runtime's marker. data-plexo-form still wins.
  function isShopForm(form) {
    var i, attrs = form.attributes;
    for (i = 0; i < attrs.length; i++) {
      var a = attrs[i].name;
      if (a.indexOf("data-plexo-") === 0 && a !== "data-plexo-form" && a !== "data-plexo-success" && a !== "data-plexo-redirect" && a !== "data-plexo-ignore") return true;
    }
    var cfg = window.__PLEXO_COMMERCE__;
    if (!cfg) return false;
    var path = location.pathname.replace(/\/+$/, "") || "/";
    var norm = function (p) { return typeof p === "string" && p ? "/" + p.replace(/^\/+|\/+$/g, "") : null; };
    var checkout = norm(cfg.checkoutPath), store = norm(cfg.storefrontPath);
    if (checkout && path === checkout) return true;
    if (store && (path === store || path.indexOf(store + "/") === 0)) return true;
    return /\/checkout$/.test(path);
  }

  function isClaimed(form) {
    var m = marker(form);
    if (m === "off") return false;
    if (m !== null) return true; // explicitly connected
    if (!AUTO) return false;
    if (isShopForm(form)) return false;
    if (form.hasAttribute("data-plexo-ignore")) return false;
    // Already posts somewhere real (another service, or Plexo's own native form action)?
    var action = (form.getAttribute("action") || "").trim();
    if (action && action !== "#" && !/^(javascript|mailto):/i.test(action)) return false;
    if ((form.getAttribute("method") || "").toLowerCase() === "get" && action === "") {
      // A GET form with no action is almost always a search box.
      if (form.querySelector('input[type="search"]') || form.getAttribute("role") === "search") return false;
    }
    if (form.querySelector('input[type="password"]')) return false;
    if (form.getAttribute("role") === "search") return false;
    // Nothing a visitor can fill in → nothing to collect.
    return !!form.querySelector("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select");
  }

  function formName(form) {
    var m = marker(form);
    if (m) return m;
    var n = form.getAttribute("name") || form.getAttribute("aria-label") || form.id;
    return (n || "Website Form").replace(/[-_]+/g, " ").slice(0, 100);
  }

  function labelFor(el) {
    var text = "";
    if (el.id) {
      var l = el.ownerDocument.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (l) text = l.textContent;
    }
    if (!text) { var wrap = el.closest("label"); if (wrap) text = wrap.textContent; }
    text = text || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.id || "";
    return text.replace(/\s+/g, " ").replace(/[*:]+$/, "").trim().slice(0, 60);
  }

  // A form built without name="" attributes would lose every answer — name each field after its label.
  function ensureNames(form) {
    var used = {};
    var fields = form.querySelectorAll("input, textarea, select");
    for (var i = 0; i < fields.length; i++) if (fields[i].name) used[fields[i].name] = 1;
    for (var j = 0; j < fields.length; j++) {
      var f = fields[j];
      if (f.name || f.type === "submit" || f.type === "button" || f.type === "file") continue;
      var base = labelFor(f) || "Field " + (j + 1), name = base, n = 2;
      while (used[name]) name = base + " (" + n++ + ")";
      used[name] = 1;
      f.name = name;
    }
  }

  function ensureHoneypot(form) {
    if (form.querySelector('input[name="' + HONEYPOT + '"]')) return;
    var hp = document.createElement("input");
    hp.type = "text"; hp.name = HONEYPOT; hp.tabIndex = -1; hp.autocomplete = "off";
    hp.setAttribute("aria-hidden", "true");
    hp.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
    form.appendChild(hp);
  }

  // A clear "we got it" card in the middle of the screen. A form inside a pop-up, a menu or a long page is often out of sight
  // by the time the answer comes back, so the confirmation can never depend on where the form is. Plain, neutral colours: this is
  // the owner's page, not ours.
  function showCard(text, isError) {
    var old = document.querySelector("[data-plexo-thanks]");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var wrap = document.createElement("div");
    wrap.setAttribute("data-plexo-thanks", "");
    wrap.setAttribute("role", isError ? "alert" : "status");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,15,20,.5);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
    var card = document.createElement("div");
    card.style.cssText = "width:100%;max-width:420px;box-sizing:border-box;padding:30px 26px 24px;border-radius:18px;background:#fff;color:#16161a;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.3)";
    var icon = document.createElement("div");
    var color = isError ? "#b91c1c" : "#15803d";
    icon.style.cssText = "width:56px;height:56px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:" + (isError ? "#fee2e2" : "#dcfce7");
    icon.innerHTML = isError
      ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6m0 4h.01"/></svg>'
      : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    var h = document.createElement("div");
    h.style.cssText = "font-size:20px;font-weight:700;line-height:1.3;margin-bottom:8px";
    h.textContent = isError ? "Please try again" : "Message received";
    var p = document.createElement("p");
    p.style.cssText = "margin:0 0 20px;font-size:15.5px;line-height:1.55;color:#3f3f46";
    p.textContent = text;
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = "Close";
    b.style.cssText = "min-width:120px;padding:11px 22px;border:0;border-radius:10px;background:#16161a;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer";
    card.appendChild(icon); card.appendChild(h); card.appendChild(p); card.appendChild(b);
    wrap.appendChild(card);
    function close() {
      document.removeEventListener("keydown", onKey);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    b.addEventListener("click", close);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    try { b.focus(); } catch (err) { /* old browsers */ }
  }

  // Forms moved over from WordPress carry their own small "thank you" note next to the form, which is out of sight for a pop-up. Replace it.
  function removeOldThanks() {
    var notes = document.querySelectorAll('[role="status"]');
    for (var i = 0; i < notes.length; i++) {
      if (/^Thank you — your submission has been received/.test(notes[i].textContent || "") && notes[i].parentNode) notes[i].parentNode.removeChild(notes[i]);
    }
  }

  // Back from a migrated form: the form address sends the visitor to "<page>?plexo_form=<form>". Say thank you, once.
  function showMigratedReturn() {
    var m = location.search.match(/[?&]plexo_form=([^&#]*)/);
    if (!m) return;
    removeOldThanks();
    showCard(DEFAULT_SUCCESS, false);
    try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])plexo_form=[^&#]*(&|$)/, function (_, a, b) { return b ? a : ""; }).replace(/\?$/, "") + location.hash); } catch (err) { /* old browsers */ }
  }

  function showMessage(form, text, isError) {
    var box = form.querySelector("[data-plexo-form-message]");
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("data-plexo-form-message", "");
      box.setAttribute("role", isError ? "alert" : "status");
      box.style.cssText = "margin-top:14px;padding:12px 14px;border-radius:8px;font-size:.95em;line-height:1.5";
      form.appendChild(box);
    }
    box.setAttribute("role", isError ? "alert" : "status");
    box.style.background = isError ? "rgba(185,28,28,.1)" : "rgba(22,101,52,.1)";
    box.style.color = isError ? "#991b1b" : "#14532d";
    box.textContent = text;
  }

  function sameSitePath(p) {
    return typeof p === "string" && p.charAt(0) === "/" && p.charAt(1) !== "/" ? p : null;
  }

  // Back from a plain (no-script) form post: the server sends the visitor to "?submitted=1". Say thank you.
  function showReturnThanks() {
    if (!/[?&]submitted=1(&|$)/.test(location.search)) return;
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      if (isClaimed(forms[i]) || forms[i].querySelector("[data-plexo-form-message]")) {
        showMessage(forms[i], forms[i].getAttribute("data-plexo-success") || DEFAULT_SUCCESS, false);
        showCard(forms[i].getAttribute("data-plexo-success") || DEFAULT_SUCCESS, false);
        return;
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { showReturnThanks(); showMigratedReturn(); });
  else { showReturnThanks(); showMigratedReturn(); }

  // Back from a plain form post that the captcha turned away: say what to do, next to the form.
  function showReturnError() {
    if (!/[?&]plexo_form_error=captcha(&|$)/.test(location.search)) return;
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      if (nativeFormName(forms[i]) !== null || isClaimed(forms[i])) {
        showMessage(forms[i], "Please complete the verification box, then send again.", true);
        showCard("Please complete the verification box, then send your message again.", true);
        return;
      }
    }
  }

  // The name of a form that already posts to this site's own Plexo form address (a migrated form), else null.
  function nativeFormName(form) {
    var action = form.getAttribute("action") || "";
    if (action.indexOf("/api/public/forms/" + TEMPLATE_ID + "/submit") === -1) return null;
    var m = action.match(/[?&]form=([^&#]*)/);
    try { return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "Website Form"; } catch (err) { return "Website Form"; }
  }

  // The "I'm not a robot" box the owner had on WordPress (Turnstile, reCAPTCHA or hCaptcha), drawn
  // above the send button for any form that has one saved on Plexo. Asked once per form name.
  var CAPTCHA_SCRIPTS = {
    turnstile: ["https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", function () { return window.turnstile; }],
    recaptcha: ["https://www.google.com/recaptcha/api.js?render=explicit", function () { return window.grecaptcha && window.grecaptcha.render ? window.grecaptcha : null; }],
    hcaptcha: ["https://js.hcaptcha.com/1/api.js?render=explicit", function () { return window.hcaptcha; }]
  };
  var captchaConfigs = {};
  var scriptLoads = {};
  function loadCaptchaScript(provider, done) {
    var spec = CAPTCHA_SCRIPTS[provider];
    if (!spec) return;
    if (spec[1]()) return done(spec[1]());
    if (!scriptLoads[provider]) {
      scriptLoads[provider] = [];
      var tag = document.createElement("script");
      tag.src = spec[0]; tag.async = true;
      tag.onload = function () {
        var tries = 0;
        (function wait() {
          var api = spec[1]();
          if (api) { var q = scriptLoads[provider]; scriptLoads[provider] = null; for (var i = 0; i < q.length; i++) q[i](api); }
          else if (tries++ < 50) setTimeout(wait, 100);
        })();
      };
      document.head.appendChild(tag);
    }
    if (scriptLoads[provider]) scriptLoads[provider].push(done);
    else done(spec[1]());
  }
  function drawCaptcha(form, cfg) {
    if (!cfg || !cfg.provider || form.__plexoCaptchaDrawn) return;
    form.__plexoCaptchaDrawn = true;
    var holder = document.createElement("div");
    holder.setAttribute("data-plexo-captcha", cfg.provider);
    holder.style.cssText = "margin:12px 0";
    var btn = form.querySelector('button:not([type="button"]), input[type="submit"]');
    if (btn && btn.parentNode && form.contains(btn)) btn.parentNode.insertBefore(holder, btn); else form.appendChild(holder);
    loadCaptchaScript(cfg.provider, function (api) {
      try { var id = api.render(holder, { sitekey: cfg.siteKey }); form.__plexoCaptchaReset = function () { try { api.reset(id); } catch (err) { /* already gone */ } }; } catch (err) { /* a bad key: the server still decides */ }
    });
  }
  function setupCaptcha(form) {
    if (form.__plexoCaptchaAsked) return;
    var name = nativeFormName(form);
    if (name === null) { if (!isClaimed(form)) return; name = formName(form); }
    form.__plexoCaptchaAsked = true;
    if (!captchaConfigs[name]) {
      captchaConfigs[name] = fetch("/api/public/forms/" + encodeURIComponent(TEMPLATE_ID) + "/captcha?form=" + encodeURIComponent(name), { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    captchaConfigs[name].then(function (cfg) { drawCaptcha(form, cfg); });
  }
  function scanCaptchas() {
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) setupCaptcha(forms[i]);
  }
  var scanTimer = null;
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scanCaptchas, 150); }
  function startCaptchaWatch() {
    scanCaptchas();
    showReturnError();
    if (window.MutationObserver) new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startCaptchaWatch);
  else startCaptchaWatch();

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || form.tagName !== "FORM" || !isClaimed(form)) return;
    // Our handler takes over; the form's own handlers (a React onSubmit etc.) don't also fire a second send.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (form.__plexoSending) return;
    if (form.checkValidity && !form.checkValidity()) { form.reportValidity && form.reportValidity(); return; }

    ensureNames(form);
    ensureHoneypot(form);

    var url = "/api/public/forms/" + encodeURIComponent(TEMPLATE_ID) + "/submit?form=" + encodeURIComponent(formName(form)) +
      "&redirect=" + encodeURIComponent(location.pathname);
    var buttons = form.querySelectorAll('button:not([type="button"]), input[type="submit"]');
    var labels = [];
    form.__plexoSending = true;
    for (var i = 0; i < buttons.length; i++) { labels.push(buttons[i].tagName === "BUTTON" ? buttons[i].innerHTML : buttons[i].value); buttons[i].disabled = true; }
    var firstBtn = buttons[0];
    if (firstBtn && firstBtn.tagName === "BUTTON") firstBtn.textContent = "Sending…";

    fetch(url, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || ERROR_TEXT); return d; }); })
      .then(function (d) {
        var go = sameSitePath(form.getAttribute("data-plexo-redirect")) || (d.redirect && (sameSitePath(d.redirect) || (/^https:\/\//i.test(d.redirect) ? d.redirect : null)));
        if (go) { location.assign(go); return; }
        form.reset();
        showMessage(form, form.getAttribute("data-plexo-success") || DEFAULT_SUCCESS, false);
        showCard(form.getAttribute("data-plexo-success") || DEFAULT_SUCCESS, false);
        try { form.dispatchEvent(new CustomEvent("plexo:form-sent", { bubbles: true })); } catch (err) { /* old browsers */ }
      })
      .catch(function (err) {
        showMessage(form, (err && err.message) || ERROR_TEXT, true);
      })
      .then(function () {
        form.__plexoSending = false;
        // An answer works once — ask again for the next send.
        if (form.__plexoCaptchaReset) form.__plexoCaptchaReset();
        for (var k = 0; k < buttons.length; k++) {
          buttons[k].disabled = false;
          if (buttons[k].tagName === "BUTTON") buttons[k].innerHTML = labels[k]; else buttons[k].value = labels[k];
        }
      });
  }, true);
})();

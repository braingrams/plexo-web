/*!
 * Plexo Commerce runtime.
 *
 * Injected by the page shell (app/pub/[domain]/[[...slug]]/route.ts) only when
 * CommerceSettings.enabled is true for the site — a page with Commerce off pays nothing
 * extra. Finds every data-plexo-commerce-* marker div a native block (or a hand-embedded
 * snippet) left in the compiled HTML and fills it with real, live data client-side. Plain
 * vanilla JS, no build step, no framework, no dependency on anything else this page loads
 * — sanitizeCompiledHtml.ts strips <script> tags from the compiled body itself, so this
 * file is the ONLY place Commerce's client behavior can live.
 *
 * Styling defaults to a neutral navy/gold look (not tied to any one site's brand), but is
 * now theme-aware: window.__PLEXO_COMMERCE__.theme (set by injectCommerceScript, resolved
 * by an explicit CommerceSettings override or, failing that, auto-detected from the site's
 * own button choices — see lib/commerce/deriveCommerceTheme.ts) drives the primary button's
 * accent color and the shared corner radius. `theme` is absent/null whenever neither exists
 * (a brand-new site with no filled buttons yet), in which case every value below falls back
 * to these exact literals — a site with nothing to detect renders identically to before
 * theming existed.
 */
(function () {
  "use strict";

  var STYLE_ID = "plexo-commerce-style";
  // The storefront's own URL segment is renameable per-site (default "store") — read from
  // the inline config the page shell emits just before this script tag (see
  // injectCommerceScript in app/pub/[domain]/[[...slug]]/route.ts). "/shop" is only a
  // last-resort fallback for a page that somehow loads this script without that config.
  var STOREFRONT_PATH = (window.__PLEXO_COMMERCE__ && window.__PLEXO_COMMERCE__.storefrontPath) || "/shop";
  // The checkout page's own REAL resolved path (see getCheckoutPath in
  // lib/commerce/storefrontLayout.ts) — NOT assumed to be "{STOREFRONT_PATH}/checkout"
  // anymore. That assumption only held for the auto-provisioned flow (checkout genuinely a
  // child of the storefront page); a hand-built site can have its checkout page anywhere
  // in the tree, including a sibling of the storefront rather than a child — confirmed
  // live: a real site's checkout 404ed under that assumption. Falls back to the old
  // concatenation only if the config predates this (null), never as the normal case.
  var CHECKOUT_PATH = (window.__PLEXO_COMMERCE__ && window.__PLEXO_COMMERCE__.checkoutPath) || (STOREFRONT_PATH + "/checkout");
  var CART_EVENT = "plexo:cart-updated";
  var CHECKOUT_STATE_EVENT = "plexo:checkout-state-changed";
  // Shared between the checkout page's two independent marker blocks — checkout_flow
  // (delivery method + contact details + discount code) and cart_summary (the order
  // summary sidebar, which needs the current delivery method's real fee to compute the
  // total, and the contact details to actually submit payment). Module-level rather than
  // passed through props since the two markers render into separate DOM nodes with no
  // direct reference to each other — see renderCheckoutFlow/renderCartSummary.
  // deliveryMethodId/deliveryFeeMinor are re-validated server-side at checkout anyway
  // (see resolveOrderDeliveryMethod) — deliveryFeeMinor here is only ever used for the
  // sidebar's displayed total, never trusted for the actual charge.
  var checkoutFormState = {
    deliveryMethodId: null,
    deliveryFeeMinor: 0,
    shippingCountry: "",
    shippingState: "",
    shippingCity: "",
    shippingCityIsOther: false,
    shippingAddressLine: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    discountCode: "",
    // "delivery" | "pickup" — which kind of option the customer is choosing between (see
    // renderCheckoutFlow). Pickup never needs an address typed in.
    fulfillmentMode: null,
    // "ONLINE" | "BANK_TRANSFER" — picked in the order summary (renderCartSummary), right
    // next to the total it applies to. null until checkout-config says what's available.
    paymentMethod: null,
    // Answers to the site owner's own checkout questions, keyed by question id —
    // re-validated server-side (lib/commerce/checkoutFields.ts), never trusted.
    customFields: {},
  };

  // ---------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var theme = (window.__PLEXO_COMMERCE__ && window.__PLEXO_COMMERCE__.theme) || null;
    var accent = (theme && theme.accentColor) || "#16233F";
    var radius = { sharp: "2px", rounded: "10px", pill: "100px" }[theme && theme.buttonRadius] || "2px";
    // Large rectangular containers (cards, inputs, selects) use a capped radius even when
    // the site's own button style is "pill" — a 100px corner radius reads fine on a small
    // button (the whole point of a pill shape) but turns a tall card into a stretched oval/
    // stadium blob, confirmed live on the checkout page's order-summary card. "Pill" here
    // means "generously rounded," not "literally capsule-shaped," for anything taller than
    // a button.
    var containerRadius = { sharp: "2px", rounded: "10px", pill: "16px" }[theme && theme.buttonRadius] || "2px";
    // Any derived/configured accent could be light or dark — picking the on-accent text
    // color unconditionally (the old hardcoded #FBFAF6) only happened to work because
    // #16233F is dark. Relative luminance (WCAG's simplified sRGB formula) keeps button
    // text legible regardless of what accent a given site resolves to.
    var accentTextColor = (function () {
      var hex = accent.replace("#", "");
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#FBFAF6";
      var r = parseInt(hex.slice(0, 2), 16) / 255;
      var g = parseInt(hex.slice(2, 4), 16) / 255;
      var b = parseInt(hex.slice(4, 6), 16) / 255;
      var luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return luminance > 0.6 ? "#16233F" : "#FBFAF6";
    })();
    var css = [
      ".pc-root{font-family:'Public Sans',system-ui,sans-serif;box-sizing:border-box;color:#1B2333;}",
      ".pc-root *{box-sizing:border-box;}",
      ".pc-mono{font-family:'IBM Plex Mono',monospace;}",
      ".pc-serif{font-family:'Fraunces',serif;}",
      ".pc-muted{color:#565F72;}",
      ".pc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:" + accent + ";color:" + accentTextColor + ";border:none;padding:14px 22px;font-size:14.5px;font-weight:600;cursor:pointer;border-radius:" + radius + ";font-family:'Public Sans',sans-serif;line-height:1.2;}",
      ".pc-btn:hover{filter:brightness(1.12);}",
      ".pc-btn:disabled{opacity:0.5;cursor:not-allowed;}",
      // Historically a fixed gold variant; now just the theme's accent again — kept as a
      // separate class (rather than folded into .pc-btn) since call sites combine it with
      // .pc-btn for layout/sizing overrides while relying on this rule for color/radius.
      ".pc-btn-gold{background:" + accent + ";color:" + accentTextColor + ";border-radius:" + radius + ";}",
      ".pc-btn-gold:hover{filter:brightness(1.12);}",
      ".pc-btn-outline{background:transparent;color:#16233F;border:1.5px solid #E4E1D6;}",
      ".pc-btn-outline:hover{background:#F3F1EA;}",
      ".pc-input{width:100%;padding:14px 16px;font-size:14px;border:1px solid #E4E1D6;border-radius:" + containerRadius + ";font-family:'Public Sans',sans-serif;color:#1B2333;background:#FFFFFF;}",
      ".pc-input:focus{outline:1.5px solid #16233F;outline-offset:-1px;}",
      ".pc-label{display:block;font-size:12.5px;font-weight:600;color:#16233F;margin-bottom:8px;}",
      ".pc-card{background:#FFFFFF;border:1px solid #E4E1D6;border-radius:" + containerRadius + ";overflow:hidden;}",
      ".pc-error{background:#F3E4E1;border:1px solid #E3B8AE;color:#8C3A2E;padding:10px 14px;border-radius:2px;font-size:13.5px;margin:10px 0;}",
      ".pc-badge{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:9.5px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;padding:4px 8px;border-radius:0;}",
      ".pc-badge-ok{background:#E4F0E7;color:#1F5C3C;}",
      ".pc-badge-low{background:#FBEFD8;color:#8A5A22;}",
      ".pc-badge-out{background:#F3E4E1;color:#8C3A2E;}",
      ".pc-grid{display:grid;gap:24px;}",
      ".pc-select{padding:12px 32px 12px 14px;font-size:13.5px;border:1px solid #E4E1D6;border-radius:" + containerRadius + ";font-family:'Public Sans',sans-serif;color:#1B2333;background-color:#FFFFFF;appearance:none;-webkit-appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23565F72' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 12px center;}",
      ".pc-newsletter-input::placeholder{color:#8FA0C4;}",
      ".pc-spin{width:22px;height:22px;border-radius:50%;border:2.5px solid #E4E1D6;border-top-color:#16233F;animation:pc-spin 0.7s linear infinite;}",
      "@keyframes pc-spin{to{transform:rotate(360deg);}}",
      ".pc-pill{display:inline-flex;align-items:center;padding:9px 18px;border-radius:100px;font-size:13px;font-weight:500;border:1px solid #E4E1D6;background:#fff;color:#3C4356;cursor:pointer;}",
      ".pc-pill.active{background:#16233F;color:#FBFAF6;border-color:#16233F;font-weight:600;}",
      ".pc-slot{text-align:center;padding:8px 0;border:1.5px solid #E4E1D6;border-radius:0;font-family:'IBM Plex Mono',monospace;font-size:10.5px;cursor:pointer;background:#fff;color:#16233F;}",
      ".pc-slot:hover{border-color:#E3B23C;}",
      ".pc-slot.active{background:#E3B23C;color:#16233F;border-color:#E3B23C;font-weight:600;}",
      ".pc-slot[disabled]{opacity:0.35;cursor:not-allowed;}",
    ];
    // Generic pc-grid-cols-N (N 1-6) — the shop_grid marker's itemsPerRow setting (see
    // ShopGridPropertiesAccordion in plexo-sdk) picks one of these rather than a single
    // hardcoded column count, in both storeMode and curated mode. Caps at 2 columns on
    // tablet and 1 on mobile regardless of the desktop count, same idea as every other
    // responsive grid on this site.
    for (var gridN = 1; gridN <= 6; gridN++) {
      css.push(".pc-grid-cols-" + gridN + "{display:grid;gap:20px;grid-template-columns:repeat(" + gridN + ", minmax(0, 1fr));}");
      css.push("@media (max-width:900px){.pc-grid-cols-" + gridN + "{grid-template-columns:repeat(" + Math.min(gridN, 2) + ", minmax(0, 1fr));}}");
      css.push("@media (max-width:520px){.pc-grid-cols-" + gridN + "{grid-template-columns:1fr;}}");
    }
    css.push("@media (max-width:640px){.pc-shop-controls{flex-direction:column;align-items:stretch;}.pc-shop-controls-right{flex-direction:column;width:100%;margin-left:0 !important;}.pc-select,.pc-shop-search{width:100% !important;}}");
    css = css.join("\n");
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
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
  // Stripe embedded checkout — mounted in-page instead of redirecting to
  // checkout.stripe.com. Loaded lazily (only once a Stripe order actually needs it) since
  // most sites use Paystack and would otherwise pay for an unused script fetch.
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

  // `checkout` is the {provider:"stripe", clientSecret, publishableKey} object the checkout
  // routes return in place of authorizationUrl for Stripe orders. Opens a full-screen modal,
  // mounts Stripe's own embedded Checkout iframe into it, and lets the visitor close it
  // (Stripe still does one final same-tab navigation to the order-confirmation return_url
  // once payment actually completes — only the card-entry step is embedded).
  function openStripeEmbeddedCheckout(checkout, onError) {
    var overlay = el("div", {
      style: {
        position: "fixed", inset: "0", zIndex: "999", background: "rgba(6,7,15,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
      },
    });
    var box = el("div", {
      style: {
        background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "560px", maxHeight: "90vh",
        overflow: "auto", position: "relative", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      },
    });
    var mountPoint = el("div", { id: "pc-stripe-embedded-checkout" });
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
        instance.mount("#pc-stripe-embedded-checkout");
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
    if (currency === "NGN") {
      return "₦" + major.toLocaleString("en-NG", { minimumFractionDigits: major % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
    }
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

  // The marker div's own authored `height`/`minHeight` (set by whoever placed the block,
  // in the editor, as a reasonable empty-state placeholder size) is not a runtime layout
  // constraint — real rendered content (an image plus name plus price plus a button, say)
  // can easily need more room than an empty placeholder did, and a fixed `height` on the
  // marker would silently clip it. Every render function calls this before painting real
  // content so the block always grows to fit what it actually contains.
  function prepareNode(node) {
    node.className = (node.className || "") + " pc-root";
    node.style.height = "auto";
    node.style.overflow = "visible";
  }

  function showSpinner(node) {
    clear(node);
    prepareNode(node);
    node.appendChild(el("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", minHeight: "160px" } }, [el("div", { class: "pc-spin" })]));
  }

  function showError(node, message) {
    clear(node);
    prepareNode(node);
    node.appendChild(el("div", { class: "pc-error" }, [message]));
  }

  // Delivery methods are configured with ISO-3166-1 alpha-2 codes and free-text state names
  // (lib/commerce/delivery.ts matches address.country/state against exactly those, case-
  // insensitively) — a free-text field expecting a customer to already know a country's ISO
  // code, or to spell a state exactly as the merchant typed it, is a real dead end (confirmed
  // live: "Nigeria" typed into a plain text box silently failed to match a method scoped to
  // "NG"). COUNTRIES is a standard ISO-3166-1 list for the dropdown; STATES_BY_COUNTRY gives
  // a proper state dropdown for countries this covers (currently Nigeria, the common case for
  // this platform's merchants) — any other country falls back to a plain text state input,
  // same as before, rather than pretending to have every country's subdivisions memorized.
  var COUNTRIES = [
    ["NG", "Nigeria"], ["GH", "Ghana"], ["KE", "Kenya"], ["ZA", "South Africa"], ["EG", "Egypt"],
    ["MA", "Morocco"], ["ET", "Ethiopia"], ["TZ", "Tanzania"], ["UG", "Uganda"], ["CI", "Côte d'Ivoire"],
    ["SN", "Senegal"], ["CM", "Cameroon"], ["ZW", "Zimbabwe"], ["ZM", "Zambia"], ["RW", "Rwanda"],
    ["BJ", "Benin"], ["TG", "Togo"], ["SL", "Sierra Leone"], ["LR", "Liberia"], ["NE", "Niger"],
    ["ML", "Mali"], ["BF", "Burkina Faso"], ["GM", "Gambia"], ["GW", "Guinea-Bissau"], ["GN", "Guinea"],
    ["MR", "Mauritania"], ["TD", "Chad"], ["CD", "DR Congo"], ["CG", "Congo"], ["GA", "Gabon"],
    ["GQ", "Equatorial Guinea"], ["AO", "Angola"], ["NA", "Namibia"], ["BW", "Botswana"], ["MZ", "Mozambique"],
    ["MW", "Malawi"], ["MG", "Madagascar"], ["SS", "South Sudan"], ["SD", "Sudan"], ["SO", "Somalia"],
    ["DJ", "Djibouti"], ["ER", "Eritrea"], ["LY", "Libya"], ["TN", "Tunisia"], ["DZ", "Algeria"],
    ["CV", "Cabo Verde"], ["ST", "São Tomé and Príncipe"], ["SC", "Seychelles"], ["MU", "Mauritius"],
    ["KM", "Comoros"], ["SZ", "Eswatini"], ["LS", "Lesotho"], ["BI", "Burundi"], ["US", "United States"],
    ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"], ["NZ", "New Zealand"], ["IE", "Ireland"],
    ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["PT", "Portugal"], ["IT", "Italy"],
    ["NL", "Netherlands"], ["BE", "Belgium"], ["CH", "Switzerland"], ["AT", "Austria"], ["SE", "Sweden"],
    ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"], ["PL", "Poland"], ["GR", "Greece"],
    ["TR", "Türkiye"], ["RU", "Russia"], ["UA", "Ukraine"], ["AE", "United Arab Emirates"],
    ["SA", "Saudi Arabia"], ["QA", "Qatar"], ["KW", "Kuwait"], ["BH", "Bahrain"], ["OM", "Oman"],
    ["JO", "Jordan"], ["LB", "Lebanon"], ["IL", "Israel"], ["IN", "India"], ["PK", "Pakistan"],
    ["BD", "Bangladesh"], ["CN", "China"], ["JP", "Japan"], ["KR", "South Korea"], ["SG", "Singapore"],
    ["MY", "Malaysia"], ["ID", "Indonesia"], ["PH", "Philippines"], ["TH", "Thailand"], ["VN", "Vietnam"],
    ["BR", "Brazil"], ["MX", "Mexico"], ["AR", "Argentina"], ["CO", "Colombia"], ["CL", "Chile"],
    ["PE", "Peru"], ["JM", "Jamaica"], ["TT", "Trinidad and Tobago"],
  ];

  var STATES_BY_COUNTRY = {
    NG: [
      "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
      "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo", "Jigawa",
      "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger",
      "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe",
      "Zamfara", "FCT (Abuja)",
    ],
  };

  // City is informational only — captured as part of the shipping address, never used to
  // gate delivery-method eligibility (that stays country/state, same as
  // lib/commerce/delivery.ts's isMethodApplicable always has). Each state's own capital
  // plus a small number of other well-known major cities — not an exhaustive LGA list
  // (Nigeria has 774 of those, too large and too easy to get subtly wrong to hardcode here
  // with confidence) — "Other" always falls back to free text for anywhere not listed.
  var MAJOR_CITIES_BY_STATE = {
    Abia: ["Umuahia", "Aba"], Adamawa: ["Yola", "Mubi"], "Akwa Ibom": ["Uyo"],
    Anambra: ["Awka", "Onitsha", "Nnewi"], Bauchi: ["Bauchi"], Bayelsa: ["Yenagoa"],
    Benue: ["Makurdi"], Borno: ["Maiduguri"], "Cross River": ["Calabar"],
    Delta: ["Asaba", "Warri"], Ebonyi: ["Abakaliki"], Edo: ["Benin City"],
    Ekiti: ["Ado-Ekiti"], Enugu: ["Enugu"], Gombe: ["Gombe"], Imo: ["Owerri"],
    Jigawa: ["Dutse"], Kaduna: ["Kaduna", "Zaria"], Kano: ["Kano"], Katsina: ["Katsina"],
    Kebbi: ["Birnin Kebbi"], Kogi: ["Lokoja"], Kwara: ["Ilorin"],
    Lagos: ["Ikeja", "Lagos Island", "Lekki", "Surulere"], Nasarawa: ["Lafia"],
    Niger: ["Minna"], Ogun: ["Abeokuta"], Ondo: ["Akure"], Osun: ["Osogbo"],
    Oyo: ["Ibadan"], Plateau: ["Jos"], Rivers: ["Port Harcourt"], Sokoto: ["Sokoto"],
    Taraba: ["Jalingo"], Yobe: ["Damaturu"], Zamfara: ["Gusau"], "FCT (Abuja)": ["Abuja"],
  };
  var OTHER_CITY_VALUE = "__other__";

  // ---------------------------------------------------------------------
  // Checkout config — payment options, extra questions, delivery/pickup switches
  // ---------------------------------------------------------------------

  // One fetch per page load, shared by checkout_flow, cart_summary and booking — see
  // app/api/public/commerce/checkout-config/route.ts. Falls back to "card only, no extra
  // questions" so an older site (or a hiccup) still gets the checkout it always had.
  var checkoutConfigPromise = null;
  function fetchCheckoutConfig() {
    if (!checkoutConfigPromise) {
      checkoutConfigPromise = api("/api/public/commerce/checkout-config").catch(function () {
        return { payment: { online: true, gateway: "paystack", bankTransfer: null }, fields: [], fulfillment: { deliveryEnabled: true, pickupEnabled: true, pickupLocation: null } };
      });
    }
    return checkoutConfigPromise;
  }

  function defaultPaymentMethod(config) {
    if (checkoutFormState.paymentMethod === "BANK_TRANSFER" && config.payment.bankTransfer) return "BANK_TRANSFER";
    if (checkoutFormState.paymentMethod === "ONLINE" && config.payment.online) return "ONLINE";
    return config.payment.online ? "ONLINE" : config.payment.bankTransfer ? "BANK_TRANSFER" : null;
  }

  // A selectable bordered card with a radio dot — the same look the delivery options
  // always had, reused for delivery-vs-pickup and card-vs-bank-transfer choices.
  function optionCard(opts) {
    var wrap = el(
      "div",
      {
        role: "radio",
        "aria-checked": opts.selected ? "true" : "false",
        tabindex: "0",
        style: {
          border: "1.5px solid " + (opts.selected ? "#16233F" : "#E4E1D6"),
          padding: "14px 16px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
          flex: "1",
          minWidth: opts.minWidth || "160px",
          background: "#FFFFFF",
        },
        onclick: opts.onSelect,
        onkeydown: function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            opts.onSelect();
          }
        },
      },
      [
        el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" } }, [
          el("span", { style: { fontSize: "13.5px", fontWeight: "600", color: "#16233F" } }, [opts.title]),
          opts.subtitle ? el("span", { class: "pc-muted", style: { fontSize: "12px", lineHeight: "1.5" } }, [opts.subtitle]) : null,
        ]),
        el("span", {
          style: { width: "16px", height: "16px", borderRadius: "50%", border: "1.5px solid #16233F", background: opts.selected ? "#16233F" : "transparent", flexShrink: "0", marginTop: "2px" },
        }),
      ]
    );
    return wrap;
  }

  // A question with `countries` is only asked when the order ships to one of them (mirrors
  // isCheckoutFieldShown in lib/commerce/checkoutFields.ts — the server re-checks). `country`
  // is null whenever there's no delivery address: pickup, bookings.
  function isFieldShown(f, country) {
    if (!f.countries || !f.countries.length) return true;
    return Boolean(country) && f.countries.indexOf(String(country).toUpperCase()) !== -1;
  }

  // The cart checkout's current delivery country — only while the customer is actually
  // choosing delivery, never a leftover from before they switched to pickup.
  function checkoutDeliveryCountry() {
    return checkoutFormState.fulfillmentMode === "delivery" ? checkoutFormState.shippingCountry || null : null;
  }

  // The site owner's own checkout questions (Settings → Checkout). `values` is the object
  // answers are written into — checkoutFormState.customFields for the cart checkout, a
  // local object for a booking. `getCountry` (optional) returns the current delivery country;
  // call the returned node's refresh() whenever it may have changed, so country-limited
  // questions appear/disappear in place without losing anything already typed.
  function customFieldsSection(fields, values, heading, getCountry) {
    if (!fields || !fields.length) return null;
    var rows = fields.map(function (f) {
      var label = f.label + (f.required ? " *" : "");
      var common = {
        class: f.type === "select" ? "pc-select" : "pc-input",
        style: f.type === "select" ? { width: "100%" } : null,
        placeholder: f.placeholder || null,
      };
      var input;
      if (f.type === "select") {
        input = el(
          "select",
          Object.assign({}, common, {
            onchange: function (e) {
              values[f.id] = e.target.value;
            },
          }),
          [el("option", { value: "" }, ["Select…"])].concat(
            (f.options || []).map(function (o) {
              return el("option", { value: o, selected: values[f.id] === o ? "selected" : null }, [o]);
            })
          )
        );
      } else if (f.type === "textarea") {
        input = el("textarea", Object.assign({}, common, { rows: "3", oninput: function (e) { values[f.id] = e.target.value; } }));
        input.value = values[f.id] || "";
      } else {
        input = el(
          "input",
          Object.assign({}, common, {
            type: f.type === "date" ? "date" : f.type === "phone" ? "tel" : "text",
            value: values[f.id] || "",
            oninput: function (e) {
              values[f.id] = e.target.value;
            },
          })
        );
      }
      return el("div", {}, [el("label", { class: "pc-label" }, [label]), input]);
    });
    var section = el("div", {}, [
      heading ? el("h3", { style: { margin: "0 0 14px", fontFamily: "'Fraunces', serif", fontWeight: "600", fontSize: "17px", color: "#16233F" } }, [heading]) : null,
      el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } }, rows),
    ]);
    section.refresh = function () {
      var country = getCountry ? getCountry() : null;
      var anyShown = false;
      fields.forEach(function (f, i) {
        var shown = isFieldShown(f, country);
        rows[i].style.display = shown ? "" : "none";
        if (shown) anyShown = true;
      });
      section.style.display = anyShown ? "" : "none";
    };
    section.refresh();
    return section;
  }

  // Client-side mirror of resolveCheckoutFieldAnswers' required check — just for a fast,
  // friendly message before submitting; the server re-validates everything.
  function missingRequiredField(fields, values, country) {
    for (var i = 0; i < (fields || []).length; i++) {
      var f = fields[i];
      if (!isFieldShown(f, country)) continue;
      if (f.required && !String(values[f.id] || "").trim()) return f.label;
    }
    return null;
  }

  // Where to send the money, shown at checkout and again on the order confirmation page.
  function bankDetailsCard(bank, amountText, referenceText) {
    function row(label, value, copyable) {
      var copyBtn = copyable
        ? el(
            "button",
            {
              type: "button",
              style: { border: "1px solid #E4E1D6", background: "#fff", fontSize: "11px", padding: "3px 8px", cursor: "pointer", color: "#16233F" },
              onclick: function () {
                try {
                  navigator.clipboard.writeText(value);
                  copyBtn.textContent = "Copied";
                  setTimeout(function () { copyBtn.textContent = "Copy"; }, 1500);
                } catch (e) {}
              },
            },
            ["Copy"]
          )
        : null;
      return el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", fontSize: "13px", padding: "4px 0" } }, [
        el("span", { class: "pc-muted" }, [label]),
        el("span", { style: { display: "flex", alignItems: "center", gap: "8px", fontWeight: "600", color: "#16233F", textAlign: "right", wordBreak: "break-word" } }, [value, copyBtn]),
      ]);
    }
    return el("div", { style: { background: "#F3F1EA", border: "1px solid #E4E1D6", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "2px" } }, [
      row("Pay via", bank.bankName),
      row("Account name", bank.accountName),
      row("Account number", bank.accountNumber, true),
      amountText ? row("Amount", amountText) : null,
      referenceText ? row("Reference", referenceText) : null,
      bank.instructions ? el("p", { class: "pc-muted", style: { margin: "8px 0 0", fontSize: "12px", lineHeight: "1.5" } }, [bank.instructions]) : null,
    ]);
  }

  // Card vs. bank transfer choice + (for bank transfer) the details to pay into. Returns
  // null when there's only one way to pay AND it's the card gateway — the checkout then
  // looks exactly like it always did.
  function paymentChoiceSection(config, amountText, onChange) {
    var hasOnline = config.payment.online;
    var bank = config.payment.bankTransfer;
    if (!bank) return null;
    var children = [el("span", { class: "pc-label", style: { marginBottom: "0" } }, ["Payment"])];
    if (hasOnline) {
      children.push(
        el("div", { role: "radiogroup", style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
          optionCard({
            title: "Pay online",
            subtitle: "Card, via " + (config.payment.gateway === "stripe" ? "Stripe" : "Paystack"),
            selected: checkoutFormState.paymentMethod === "ONLINE",
            minWidth: "130px",
            onSelect: function () { onChange("ONLINE"); },
          }),
          optionCard({
            title: "Bank transfer",
            subtitle: "Pay directly into our account",
            selected: checkoutFormState.paymentMethod === "BANK_TRANSFER",
            minWidth: "130px",
            onSelect: function () { onChange("BANK_TRANSFER"); },
          }),
        ])
      );
    }
    if (checkoutFormState.paymentMethod === "BANK_TRANSFER") {
      children.push(
        el("p", { class: "pc-muted", style: { margin: "0", fontSize: "12.5px", lineHeight: "1.55" } }, [
          "Transfer the total to the account below, then place your order. We'll email your order number — your order is confirmed as soon as the store sees your payment.",
        ])
      );
      children.push(bankDetailsCard(bank, amountText, "Your full name"));
    }
    return el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } }, children);
  }

  function stockBadge(stockQuantity) {
    if (stockQuantity === null || stockQuantity === undefined) return el("span", { class: "pc-badge pc-badge-ok" }, ["In Stock"]);
    if (stockQuantity <= 0) return el("span", { class: "pc-badge pc-badge-out" }, ["Out of Stock"]);
    if (stockQuantity <= 5) return el("span", { class: "pc-badge pc-badge-low" }, ["Low Stock"]);
    return el("span", { class: "pc-badge pc-badge-ok" }, ["In Stock"]);
  }

  function broadcastCart(snapshot) {
    document.dispatchEvent(new CustomEvent(CART_EVENT, { detail: snapshot }));
    document.querySelectorAll("[data-plexo-cart-count]").forEach(function (badge) {
      var count = (snapshot.items || []).reduce(function (sum, item) {
        return sum + item.quantity;
      }, 0);
      badge.textContent = String(count);
      badge.style.display = count > 0 ? "" : "none";
    });
  }

  // Takes the full product (not just its id) so the one shared add-to-cart path can also
  // trigger the "added to cart" flyout below — every one of the 5 Add-to-Cart buttons
  // already has the full product object in scope at their call site.
  function addToCart(product, quantity) {
    var qty = quantity || 1;
    return api("/api/public/commerce/cart/items", { method: "POST", body: JSON.stringify({ productId: product.id, quantity: qty }) }).then(function (snapshot) {
      broadcastCart(snapshot);
      showAddedToCartFlyout(product, qty);
      return snapshot;
    });
  }

  function fetchCart() {
    return api("/api/public/commerce/cart");
  }

  // Lets shopCard/renderProduct/renderProductDetail mark a product's Add-to-Cart button
  // as already "Added ✓" on initial paint, not only right after a fresh in-page click —
  // the cart itself already persists across reloads (CART_COOKIE), but until now nothing
  // re-checked it when a button was first built, so the button silently forgot its own
  // product was already in the cart the moment the page reloaded or was navigated to.
  // Memoized per page load (one fetch shared by every card) and kept in sync by
  // broadcastCart's own CART_EVENT, which every add/update/remove already dispatches.
  var cartProductIdsPromise = null;
  function cartItemsToIdSet(items) {
    var ids = {};
    (items || []).forEach(function (item) {
      ids[item.productId] = true;
    });
    return ids;
  }
  function getCartProductIds() {
    if (!cartProductIdsPromise) {
      cartProductIdsPromise = fetchCart()
        .then(function (snapshot) {
          return cartItemsToIdSet(snapshot.items);
        })
        .catch(function () {
          return {};
        });
    }
    return cartProductIdsPromise;
  }
  document.addEventListener(CART_EVENT, function (e) {
    cartProductIdsPromise = Promise.resolve(cartItemsToIdSet(e.detail.items));
  });

  // ---------------------------------------------------------------------
  // Added-to-cart flyout — appears immediately on a successful add, showing what was
  // just added plus a direct "View Cart" link into the checkout page. Only one shown at
  // a time; adding again (even mid-animation) replaces it rather than stacking.
  // ---------------------------------------------------------------------
  var activeCartFlyout = null;

  function dismissCartFlyout() {
    if (!activeCartFlyout) return;
    var node = activeCartFlyout.node;
    var timer = activeCartFlyout.timer;
    activeCartFlyout = null;
    clearTimeout(timer);
    node.style.transform = "translateX(120%)";
    node.style.opacity = "0";
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 220);
  }

  function showAddedToCartFlyout(product, quantity) {
    injectStyles();
    dismissCartFlyout();

    var closeBtn = el(
      "button",
      {
        type: "button",
        "aria-label": "Dismiss",
        onclick: function () {
          dismissCartFlyout();
        },
        style: {
          position: "absolute", top: "10px", right: "10px", width: "24px", height: "24px",
          display: "flex", alignItems: "center", justifyContent: "center", background: "transparent",
          border: "none", color: "#8A93A6", cursor: "pointer", fontSize: "14px", lineHeight: "1", padding: "0",
        },
      },
      ["✕"]
    );

    var media = product.imageUrl
      ? el("img", { src: product.imageUrl, alt: product.name, style: { width: "56px", height: "56px", objectFit: "cover", flexShrink: "0" } })
      : el("div", { style: { width: "56px", height: "56px", flexShrink: "0", background: "#F3F1EA" } });

    var node = el(
      "div",
      {
        class: "pc-root pc-card",
        style: {
          position: "fixed", top: "20px", right: "20px", zIndex: "998", width: "320px", maxWidth: "calc(100vw - 40px)",
          padding: "18px", boxShadow: "0 10px 30px rgba(22,35,63,0.18)", transition: "transform 0.22s ease, opacity 0.22s ease",
          transform: "translateX(120%)", opacity: "0",
        },
      },
      [
        closeBtn,
        el("div", { class: "pc-mono", style: { fontSize: "11px", color: "#1F5C3C", fontWeight: "600", marginBottom: "12px" } }, ["✓ ADDED TO CART"]),
        el("div", { style: { display: "flex", gap: "12px", alignItems: "center" } }, [
          media,
          el("div", { style: { minWidth: "0", flex: "1" } }, [
            el("div", { style: { fontSize: "13.5px", fontWeight: "600", color: "#16233F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [product.name]),
            el("div", { class: "pc-muted", style: { fontSize: "12.5px", marginTop: "2px" } }, [
              (quantity > 1 ? quantity + " × " : "") + money(product.priceMinor, product.currency),
            ]),
          ]),
        ]),
        el(
          "a",
          { class: "pc-btn", href: CHECKOUT_PATH, style: { textDecoration: "none", width: "100%", marginTop: "14px" } },
          ["View Cart"]
        ),
      ]
    );

    document.body.appendChild(node);
    // Force layout before flipping the transform/opacity so the transition actually runs
    // rather than snapping straight to its end state.
    void node.offsetWidth;
    node.style.transform = "translateX(0)";
    node.style.opacity = "1";

    var timer = setTimeout(dismissCartFlyout, 5000);
    activeCartFlyout = { node: node, timer: timer };
  }

  // ---------------------------------------------------------------------
  // product — a single Buy card
  // ---------------------------------------------------------------------

  function renderProduct(node) {
    // "detail" mode: a single, reusable Product Detail page (see CommerceSettings.
    // productDetailTemplateId) with no productId of its own — the site owner never picks
    // a product for this marker, because it isn't tied to one. Whichever product's real
    // slug the visited URL ends in is the one shown; a brand-new product added in the
    // dashboard gets a working detail page immediately, with no page to hand-create.
    if (node.getAttribute("data-plexo-commerce-mode") === "detail") {
      renderProductDetail(node);
      return;
    }
    var productId = node.getAttribute("data-plexo-product-id");
    if (!productId) return;
    // "bare" mode: the surrounding hand-authored page (e.g. Product Detail) already shows
    // the name/price/description/badge itself — this renders only the interactive
    // qty-stepper + Add to Cart control, not a second copy of the card chrome.
    var bare = node.getAttribute("data-plexo-commerce-mode") === "bare";
    showSpinner(node);
    api("/api/public/commerce/products/" + encodeURIComponent(productId))
      .then(function (data) {
        var p = data.product;
        var qty = 1;
        clear(node);
        prepareNode(node);
        node.style.padding = node.style.padding || "0";

        var qtyLabel;
        var addBtn;

        function buildQtyRow() {
          return el("div", { style: { display: "flex", alignItems: "center", gap: "0", width: "fit-content", border: "1px solid #E4E1D6" } }, [
            el(
              "button",
              {
                class: "pc-btn-outline",
                style: { border: "none", borderRight: "1px solid #E4E1D6", width: "44px", height: "44px", padding: "0", fontSize: "18px" },
                onclick: function () {
                  if (qty > 1) qty -= 1;
                  qtyLabel.textContent = String(qty);
                },
              },
              ["–"]
            ),
            (qtyLabel = el("span", { class: "pc-mono", style: { width: "52px", textAlign: "center", fontSize: "14px" } }, [String(qty)])),
            el(
              "button",
              {
                class: "pc-btn-outline",
                style: { border: "none", borderLeft: "1px solid #E4E1D6", width: "44px", height: "44px", padding: "0", fontSize: "18px" },
                onclick: function () {
                  qty += 1;
                  qtyLabel.textContent = String(qty);
                },
              },
              ["+"]
            ),
          ]);
        }

        var isService = p.kind === "SERVICE";

        if (isService) {
          node.appendChild(
            el("a", { class: "pc-btn pc-btn-gold", href: "#" + node.getAttribute("data-plexo-id"), style: bare ? { width: "100%" } : {}, onclick: function (e) { e.preventDefault(); var target = document.querySelector('[data-plexo-commerce-booking][data-plexo-service-id="' + p.id + '"]'); if (target) target.scrollIntoView({ behavior: "smooth", block: "center" }); } }, ["Book this service"])
          );
          return;
        }

        if (bare) {
          node.appendChild(
            el("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } }, [
              buildQtyRow(),
              (addBtn = el(
                "button",
                {
                  class: "pc-btn",
                  style: { width: "100%", padding: "17px 0", fontSize: "15px" },
                  disabled: p.stockQuantity === 0 ? "disabled" : null,
                  onclick: function () {
                    addBtn.disabled = true;
                    addBtn.textContent = "Adding…";
                    addToCart(p, qty)
                      .then(function () {
                        addBtn.textContent = "Added ✓";
                        addBtn.disabled = false;
                      })
                      .catch(function (err) {
                        addBtn.textContent = "Add to Cart — " + money(p.priceMinor * qty, p.currency);
                        addBtn.disabled = false;
                        alert(err.message);
                      });
                  },
                },
                [p.stockQuantity === 0 ? "Out of Stock" : "Add to Cart — " + money(p.priceMinor, p.currency)]
              )),
            ])
          );
          getCartProductIds().then(function (ids) {
            if (ids[p.id] && p.stockQuantity !== 0) addBtn.textContent = "Added ✓";
          });
          return;
        }

        // "teaser" mode: the dark navy card treatment used for the Home shop teaser
        // section — same real add-to-cart behavior as the default light card, just
        // themed to sit correctly on a navy section instead of looking like a stray
        // white box. A product with no imageUrl yet gets a themed gradient placeholder
        // (its name lettered over it) rather than silently showing no image at all.
        var teaser = node.getAttribute("data-plexo-commerce-mode") === "teaser";
        var media = p.imageUrl
          ? el("img", { src: p.imageUrl, alt: p.name, style: { width: "100%", height: "200px", objectFit: "cover", display: "block" } })
          : teaser
            ? el("div", { style: { height: "200px", background: "linear-gradient(160deg,#1F3B2A,#2E7D52)", display: "flex", alignItems: "center", justifyContent: "center" } }, [el("span", { class: "pc-serif", style: { fontSize: "15px", color: "#D7F0DF" } }, [p.name])])
            : null;

        var body = teaser
          ? [
              media,
              el("div", { style: { padding: "20px", display: "flex", flexDirection: "column", gap: "8px" } }, [
                el("span", { style: { fontSize: "14.5px", fontWeight: "600", color: "#FBFAF6" } }, [p.name]),
                el("span", { class: "pc-mono", style: { fontSize: "13px", color: "#E3B23C" } }, [money(p.priceMinor, p.currency)]),
                (addBtn = el(
                  "button",
                  {
                    class: "pc-btn pc-btn-gold",
                    style: { width: "100%", fontSize: "13px", padding: "9px 14px", marginTop: "4px" },
                    disabled: p.stockQuantity === 0 ? "disabled" : null,
                    onclick: function () {
                      addBtn.disabled = true;
                      addBtn.textContent = "Adding…";
                      addToCart(p, 1)
                        .then(function () {
                          addBtn.textContent = "Added ✓";
                          addBtn.disabled = false;
                        })
                        .catch(function (err) {
                          addBtn.disabled = false;
                          addBtn.textContent = "Add to Cart";
                          alert(err.message);
                        });
                    },
                  },
                  [p.stockQuantity === 0 ? "Out of Stock" : "Add to Cart"]
                )),
              ]),
            ]
          : [
              media,
              el("div", { style: { padding: "20px", display: "flex", flexDirection: "column", gap: "12px" } }, [
                el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" } }, [
                  el("h3", { class: "pc-serif", style: { margin: "0", fontSize: "18px", fontWeight: "600", color: "#16233F" } }, [p.name]),
                  stockBadge(p.stockQuantity),
                ]),
                p.description ? el("p", { class: "pc-muted", style: { margin: "0", fontSize: "13.5px", lineHeight: "1.55" } }, [p.description]) : null,
                el("div", { class: "pc-mono", style: { fontSize: "16px", color: "#16233F" } }, [money(p.priceMinor, p.currency)]),
                el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } }, [
                  buildQtyRow(),
                  (addBtn = el(
                    "button",
                    {
                      class: "pc-btn",
                      disabled: p.stockQuantity === 0 ? "disabled" : null,
                      onclick: function () {
                        addBtn.disabled = true;
                        addBtn.textContent = "Adding…";
                        addToCart(p, qty)
                          .then(function () {
                            addBtn.textContent = "Added ✓";
                            addBtn.disabled = false;
                          })
                          .catch(function (err) {
                            addBtn.textContent = "Add to Cart";
                            addBtn.disabled = false;
                            alert(err.message);
                          });
                      },
                    },
                    ["Add to Cart"]
                  )),
                ]),
              ]),
            ];
        node.appendChild(
          el("div", { style: Object.assign({ height: "100%", overflow: "hidden" }, teaser ? { background: "#1E2F52", border: "1px solid rgba(227,178,60,0.16)" } : { background: "#fff", border: "1px solid #E4E1D6" }) }, body)
        );
        getCartProductIds().then(function (ids) {
          if (ids[p.id] && p.stockQuantity !== 0) addBtn.textContent = "Added ✓";
        });
      })
      .catch(function (err) {
        showError(node, err.message);
      });
  }

  // ---------------------------------------------------------------------
  // product (mode="detail") — the one reusable Product Detail page, filled in
  // entirely from the product whose slug the CURRENT URL ends in.
  // ---------------------------------------------------------------------

  function renderProductDetail(node) {
    var segments = window.location.pathname.split("/").filter(Boolean);
    var slug = decodeURIComponent(segments[segments.length - 1] || "");
    showSpinner(node);
    node.style.padding = "0";
    api("/api/public/commerce/products/" + encodeURIComponent(slug))
      .then(function (data) {
        var p = data.product;
        var related = (data.relatedProducts || []).filter(function (r) {
          return r.kind === "PHYSICAL";
        });
        var qty = 1;
        var qtyLabel, addBtn;

        clear(node);
        prepareNode(node);
        node.style.padding = "0";

        var media = p.imageUrl
          ? el("img", { src: p.imageUrl, alt: p.name, style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } })
          : el("div", { style: { width: "100%", height: "100%", background: "linear-gradient(155deg,#1F3B2A,#2E7D52)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", textAlign: "center" } }, [
              el("span", { class: "pc-serif", style: { fontSize: "20px", color: "#D7F0DF" } }, [p.name]),
            ]);

        var breadcrumb = el("div", { class: "pc-mono", style: { fontSize: "11.5px", color: "#8A93A6" } }, [
          el("a", { href: STOREFRONT_PATH, style: { color: "#8A93A6", textDecoration: "none" } }, ["Shop"]),
          p.category ? " / " + p.category.name + " / " : " / ",
          el("span", { style: { color: "#16233F" } }, [p.name]),
        ]);

        function buildQtyRow() {
          return el("div", { style: { display: "flex", alignItems: "center", gap: "0", width: "fit-content", border: "1px solid #E4E1D6" } }, [
            el(
              "button",
              {
                class: "pc-btn-outline",
                style: { border: "none", borderRight: "1px solid #E4E1D6", width: "44px", height: "44px", padding: "0", fontSize: "18px" },
                onclick: function () {
                  if (qty > 1) qty -= 1;
                  qtyLabel.textContent = String(qty);
                },
              },
              ["–"]
            ),
            (qtyLabel = el("span", { class: "pc-mono", style: { width: "52px", textAlign: "center", fontSize: "14px" } }, [String(qty)])),
            el(
              "button",
              {
                class: "pc-btn-outline",
                style: { border: "none", borderLeft: "1px solid #E4E1D6", width: "44px", height: "44px", padding: "0", fontSize: "18px" },
                onclick: function () {
                  qty += 1;
                  qtyLabel.textContent = String(qty);
                },
              },
              ["+"]
            ),
          ]);
        }

        var buyControl =
          p.kind === "SERVICE"
            ? el("a", { class: "pc-btn pc-btn-gold", href: "#", style: { width: "fit-content" }, onclick: function (e) { e.preventDefault(); var target = document.querySelector('[data-plexo-commerce-booking][data-plexo-service-id="' + p.id + '"]'); if (target) target.scrollIntoView({ behavior: "smooth", block: "center" }); } }, ["Book this service"])
            : el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } }, [
                buildQtyRow(),
                (addBtn = el(
                  "button",
                  {
                    class: "pc-btn",
                    style: { width: "fit-content", padding: "17px 26px", fontSize: "15px" },
                    disabled: p.stockQuantity === 0 ? "disabled" : null,
                    onclick: function () {
                      addBtn.disabled = true;
                      addBtn.textContent = "Adding…";
                      addToCart(p, qty)
                        .then(function () {
                          addBtn.textContent = "Added ✓";
                          addBtn.disabled = false;
                        })
                        .catch(function (err) {
                          addBtn.textContent = "Add to Cart — " + money(p.priceMinor * qty, p.currency);
                          addBtn.disabled = false;
                          alert(err.message);
                        });
                    },
                  },
                  [p.stockQuantity === 0 ? "Out of Stock" : "Add to Cart — " + money(p.priceMinor, p.currency)]
                )),
              ]);

        // Reflects the store's real delivery/pickup switches (checkout-config), filled in
        // once that answers — instead of always promising both regardless of whether the
        // owner actually offers them.
        var deliveryRow = el("div", { style: { display: "flex", gap: "28px", paddingTop: "8px", borderTop: "1px solid #E4E1D6", marginTop: "4px", flexWrap: "wrap" } });
        function fulfillmentBadge(iconHtml, title, subtitle) {
          return el("div", { style: { display: "flex", gap: "10px", alignItems: "flex-start", paddingTop: "20px" } }, [
            el("span", { html: iconHtml }),
            el("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } }, [
              el("span", { style: { fontSize: "13px", fontWeight: "600", color: "#16233F" } }, [title]),
              el("span", { class: "pc-muted", style: { fontSize: "12.5px" } }, [subtitle]),
            ]),
          ]);
        }
        if (p.kind === "PHYSICAL") {
          fetchCheckoutConfig().then(function (cfg) {
            var f = cfg.fulfillment || {};
            if (f.pickupEnabled !== false) {
              deliveryRow.appendChild(
                fulfillmentBadge(
                  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#565F72" stroke-width="1.6"><path d="M3 21h18M5 21V9l7-6 7 6v12M9 21v-6h6v6"></path></svg>',
                  "Free store pickup",
                  f.pickupLocation ? f.pickupLocation : "Choose pickup at checkout"
                )
              );
            }
            if (f.deliveryEnabled !== false) {
              deliveryRow.appendChild(
                fulfillmentBadge(
                  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#565F72" stroke-width="1.6"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z"></path><circle cx="7" cy="19" r="1.6"></circle><circle cx="17.5" cy="19" r="1.6"></circle></svg>',
                  "Delivery",
                  "Fee calculated at checkout"
                )
              );
            }
            if (!deliveryRow.childNodes.length) deliveryRow.style.display = "none";
          });
        } else {
          deliveryRow.style.display = "none";
        }

        var infoCol = el("div", { style: { flex: "1 1 380px", minWidth: "280px", display: "flex", flexDirection: "column", gap: "24px" } }, [
          el("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } }, [
            el("span", { class: "pc-mono", style: { fontSize: "11.5px", letterSpacing: "0.16em", textTransform: "uppercase", color: "#2E7D52" } }, [p.category ? p.category.name : "Shop"]),
            el("h1", { class: "pc-serif", style: { margin: "0", fontWeight: "500", fontSize: "38px", color: "#16233F" } }, [p.name]),
            el("div", { style: { display: "flex", alignItems: "center", gap: "14px" } }, [
              el("span", { class: "pc-mono", style: { fontSize: "22px", color: "#16233F" } }, [money(p.priceMinor, p.currency)]),
              stockBadge(p.stockQuantity),
            ]),
          ]),
          p.description ? el("p", { style: { margin: "0", fontSize: "15.5px", lineHeight: "1.75", color: "#3C4356" } }, [p.description]) : null,
          el("div", { style: { background: "#F3F1EA", borderLeft: "3px solid #E3B23C", padding: "16px 20px" } }, [
            el("p", { class: "pc-muted", style: { margin: "0", fontSize: "13px", lineHeight: "1.6" } }, [
              "Natural food and wellness item, not a replacement for prescribed medical treatment. Always tell your doctor about any herbal products you're using.",
            ]),
          ]),
          buyControl,
          deliveryRow,
        ]);

        var heroWrap = el("div", { style: { maxWidth: "1440px", margin: "0 auto", padding: "32px clamp(20px, 6vw, 56px) 88px", boxSizing: "border-box" } }, [
          breadcrumb,
          el("div", { style: { display: "flex", gap: "48px", flexWrap: "wrap", marginTop: "32px" } }, [
            el("div", { style: { flex: "0 1 480px", minWidth: "280px", height: "520px", background: "#10192C", overflow: "hidden" } }, [media]),
            infoCol,
          ]),
        ]);
        node.appendChild(heroWrap);
        if (addBtn) {
          getCartProductIds().then(function (ids) {
            if (ids[p.id] && p.stockQuantity !== 0) addBtn.textContent = "Added ✓";
          });
        }

        // Staff-curated only (CommerceProductRelation, set from the product's own admin
        // edit form) — never a guessed/automatic pick, and the whole section simply
        // doesn't render when nothing has been curated for this product yet.
        if (related.length > 0) {
          node.appendChild(
            el("div", { style: { background: "#F3F1EA" } }, [
              el("div", { style: { maxWidth: "1440px", margin: "0 auto", padding: "80px clamp(20px, 6vw, 56px) 80px", boxSizing: "border-box" } }, [
                el("span", { class: "pc-mono", style: { fontSize: "11.5px", letterSpacing: "0.16em", textTransform: "uppercase", color: "#C23B2E" } }, ["Frequently bought together"]),
                el("h2", { class: "pc-serif", style: { margin: "12px 0 40px", fontWeight: "500", fontSize: "28px", color: "#16233F" } }, ["Pairs well with"]),
                el("div", { class: "pc-grid pc-grid-cols-3" }, related.map(function (r) { return shopCard(r, false); })),
              ]),
            ])
          );
        }
      })
      .catch(function () {
        clear(node);
        prepareNode(node);
        node.appendChild(
          el("div", { style: { padding: "80px 20px", textAlign: "center", display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" } }, [
            el("span", { class: "pc-serif", style: { fontSize: "18px", color: "#16233F" } }, ["Product not found"]),
            el("a", { class: "pc-btn-outline pc-btn", href: STOREFRONT_PATH, style: { textDecoration: "none" } }, ["Back to shop"]),
          ])
        );
      });
  }

  // ---------------------------------------------------------------------
  // booking — a single consultation-booking card with its calendar
  // ---------------------------------------------------------------------

  function renderBooking(node) {
    var serviceId = node.getAttribute("data-plexo-service-id");
    if (!serviceId) return;
    showSpinner(node);

    Promise.all([api("/api/public/commerce/products/" + encodeURIComponent(serviceId)), api("/api/public/commerce/availability?productId=" + encodeURIComponent(serviceId)), fetchCheckoutConfig()])
      .then(function (results) {
        var product = results[0].product;
        var slots = results[1].slots || [];
        var config = results[2];
        var answers = {};
        if (!checkoutFormState.paymentMethod) checkoutFormState.paymentMethod = defaultPaymentMethod(config);
        var priceText = money(product.priceMinor, product.currency);
        function confirmLabel() {
          return checkoutFormState.paymentMethod === "BANK_TRANSFER" ? "I've sent the transfer — Book" : "Confirm & Pay — " + priceText;
        }
        var paymentBox = el("div", {});
        function paintPayment() {
          clear(paymentBox);
          var section = paymentChoiceSection(config, priceText, function (method) {
            checkoutFormState.paymentMethod = method;
            paintPayment();
            if (confirmBtn && !confirmBtn.dataset.busy) confirmBtn.textContent = confirmLabel();
          });
          if (section) paymentBox.appendChild(section);
        }
        clear(node);
        prepareNode(node);

        var selectedSlot = null;
        var slotButtons = [];
        var confirmBtn, nameInput, emailInput, phoneInput, errorBox;

        var byDay = {};
        var dayOrder = [];
        slots.forEach(function (s) {
          var d = new Date(s.start);
          var key = d.toDateString();
          if (!byDay[key]) {
            byDay[key] = [];
            dayOrder.push(key);
          }
          byDay[key].push(s);
        });

        var slotGrid = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });
        if (dayOrder.length === 0) {
          slotGrid.appendChild(el("p", { class: "pc-muted", style: { fontSize: "13.5px" } }, ["No open times in the next two weeks — please check back soon or reach out directly."]));
        } else {
          dayOrder.slice(0, 6).forEach(function (key) {
            var daySlots = byDay[key];
            var d = new Date(daySlots[0].start);
            var dayLabel = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
            var row = el("div", {}, [
              el("div", { style: { fontSize: "11.5px", fontWeight: "700", color: "#565F72", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" } }, [dayLabel]),
              el(
                "div",
                { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: "8px" } },
                daySlots.map(function (slot) {
                  var t = new Date(slot.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                  var btn = el(
                    "button",
                    {
                      class: "pc-slot",
                      onclick: function () {
                        selectedSlot = slot;
                        slotButtons.forEach(function (b) {
                          b.classList.remove("active");
                        });
                        btn.classList.add("active");
                        confirmBtn.disabled = false;
                      },
                    },
                    [t]
                  );
                  slotButtons.push(btn);
                  return btn;
                })
              ),
            ]);
            slotGrid.appendChild(row);
          });
        }

        function field(label, type) {
          var input = el("input", { class: "pc-input", type: type || "text" });
          return { wrap: el("div", {}, [el("label", { class: "pc-label" }, [label]), input]), input: input };
        }
        var nameField = field("Full name");
        var emailField = field("Email", "email");
        var phoneField = field("Phone");
        nameInput = nameField.input;
        emailInput = emailField.input;
        phoneInput = phoneField.input;

        confirmBtn = el(
          "button",
          {
            class: "pc-btn pc-btn-gold",
            disabled: "disabled",
            style: { width: "100%" },
            onclick: function () {
              if (errorBox) errorBox.remove();
              if (!selectedSlot) return;
              if (!emailInput.value || emailInput.value.indexOf("@") === -1) {
                errorBox = el("div", { class: "pc-error" }, ["Please enter a valid email."]);
                confirmBtn.parentNode.insertBefore(errorBox, confirmBtn);
                return;
              }
              var missing = missingRequiredField(config.fields, answers, null);
              if (missing) {
                errorBox = el("div", { class: "pc-error" }, ['Please answer "' + missing + '".']);
                confirmBtn.parentNode.insertBefore(errorBox, confirmBtn);
                return;
              }
              confirmBtn.disabled = true;
              confirmBtn.dataset.busy = "1";
              confirmBtn.textContent = "Booking…";
              api("/api/public/commerce/checkout", {
                method: "POST",
                body: JSON.stringify({
                  productId: product.id,
                  scheduledStart: selectedSlot.start,
                  customerName: nameInput.value || undefined,
                  customerEmail: emailInput.value,
                  customerPhone: phoneInput.value || undefined,
                  paymentMethod: checkoutFormState.paymentMethod || undefined,
                  customFields: answers,
                }),
              })
                .then(function (result) {
                  if (result.redirectUrl) {
                    window.location.href = result.redirectUrl;
                    return;
                  }
                  if (result.checkout && result.checkout.provider === "stripe") {
                    confirmBtn.disabled = false;
                    delete confirmBtn.dataset.busy;
                    confirmBtn.textContent = confirmLabel();
                    openStripeEmbeddedCheckout(result.checkout, function (err) {
                      errorBox = el("div", { class: "pc-error" }, [err.message]);
                      confirmBtn.parentNode.insertBefore(errorBox, confirmBtn);
                    });
                    return;
                  }
                  window.location.href = result.authorizationUrl;
                })
                .catch(function (err) {
                  confirmBtn.disabled = false;
                  delete confirmBtn.dataset.busy;
                  confirmBtn.textContent = confirmLabel();
                  errorBox = el("div", { class: "pc-error" }, [err.message]);
                  confirmBtn.parentNode.insertBefore(errorBox, confirmBtn);
                });
            },
          },
          [confirmLabel()]
        );
        paintPayment();

        node.appendChild(
          el("div", { class: "pc-card", style: { padding: "24px", display: "flex", flexDirection: "column", gap: "20px" } }, [
            el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } }, [
              el("h3", { style: { margin: "0", fontSize: "17px", fontWeight: "700", color: "#16233F" } }, ["Choose a time"]),
              el("span", { class: "pc-muted", style: { fontSize: "12.5px" } }, [product.durationMinutes ? product.durationMinutes + " min" : ""]),
            ]),
            slotGrid,
            el("div", { style: { height: "1px", background: "#E4E1D6" } }),
            nameField.wrap,
            emailField.wrap,
            phoneField.wrap,
            customFieldsSection(config.fields, answers, null),
            paymentBox,
            confirmBtn,
          ])
        );
      })
      .catch(function (err) {
        showError(node, err.message);
      });
  }

  // ---------------------------------------------------------------------
  // shop_grid — category-pilled, searchable product grid
  // ---------------------------------------------------------------------

  // A card for the shop_grid's live product listing (both storeMode and curated share
  // this). Kept separate from renderProduct's own card (which handles the `product` block
  // singular-item case) since this one is always a grid tile, never bare. `dark` (from the
  // block's own `mode` attr, curated mode only) swaps in the navy/gold treatment for a
  // grid sitting on a dark section — see renderShopGridCurated.
  function shopCard(p, dark) {
    var addBtn;
    var textColor = dark ? "#FBFAF6" : "#16233F";
    var priceColor = dark ? "#E3B23C" : "#16233F";
    var href = "/shop/" + encodeURIComponent(p.slug || p.id);
    var media = p.imageUrl
      ? el("img", { src: p.imageUrl, alt: p.name, style: { width: "100%", height: "160px", objectFit: "cover", display: "block" } })
      : el("div", { style: { width: "100%", height: "160px", background: dark ? "linear-gradient(155deg,#1F3B2A,#2E7D52)" : "#F3F1EA", display: "flex", alignItems: "center", justifyContent: "center", color: dark ? "#D7F0DF" : "#8A93A6", fontSize: "13px" } }, [p.name]);
    // Image + name are the click target through to the product's own detail page;
    // price and Add to Cart sit OUTSIDE that link (a nested interactive button inside
    // an <a> is invalid HTML and unreliable to click) so adding to cart from the grid
    // still works without navigating away.
    var card = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: dark ? "#1E2F52" : "#fff", border: dark ? "1px solid rgba(227,178,60,0.16)" : "1px solid #E4E1D6" } }, [
      el("a", { href: href, style: { display: "block", textDecoration: "none", color: "inherit" } }, [
        media,
        el("div", { style: { padding: "14px 14px 0" } }, [
          el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" } }, [
            el("span", { style: { fontSize: "14px", fontWeight: "600", color: textColor } }, [p.name]),
            dark ? null : stockBadge(p.stockQuantity),
          ]),
        ]),
      ]),
      el("div", { style: { padding: "8px 14px 14px", display: "flex", flexDirection: "column", gap: "8px", flex: "1" } }, [
        el("div", { class: "pc-mono", style: { fontSize: "14.5px", fontWeight: dark ? "500" : "700", color: priceColor, marginTop: "auto" } }, [money(p.priceMinor, p.currency)]),
        (addBtn = el(
          "button",
          {
            class: dark ? "pc-btn pc-btn-gold" : "pc-btn",
            style: { width: "100%", fontSize: "13px", padding: "9px 14px" },
            disabled: p.stockQuantity === 0 ? "disabled" : null,
            onclick: function () {
              addBtn.disabled = true;
              addBtn.textContent = "Adding…";
              addToCart(p, 1)
                .then(function () {
                  addBtn.textContent = "Added ✓";
                  addBtn.disabled = false;
                })
                .catch(function (err) {
                  addBtn.disabled = false;
                  addBtn.textContent = "Add to Cart";
                  alert(err.message);
                });
            },
          },
          [p.stockQuantity === 0 ? "Out of Stock" : "Add to Cart"]
        )),
      ]),
    ]);
    getCartProductIds().then(function (ids) {
      if (ids[p.id] && p.stockQuantity !== 0) addBtn.textContent = "Added ✓";
    });
    return card;
  }

  // A card for a slot the curated grid couldn't fill (a brand-new catalog with nothing
  // in the requested category/sort yet) — keeps the shelf looking intentional instead of
  // empty or broken while real products are still being added.
  function placeholderCard(dark) {
    return el("div", { style: { display: "flex", flexDirection: "column", opacity: "0.6", background: dark ? "#1E2F52" : "#fff", border: dark ? "1px solid rgba(227,178,60,0.16)" : "1px solid #E4E1D6" } }, [
      el("div", { style: { width: "100%", height: "160px", background: dark ? "linear-gradient(155deg,#0F1930,#1E2F52)" : "linear-gradient(155deg,#EDEBE3,#F3F1EA)" } }),
      el("div", { style: { padding: "14px", display: "flex", flexDirection: "column", gap: "8px" } }, [
        el("span", { style: { fontSize: "13px", fontWeight: "600", color: dark ? "#8FA0C4" : "#565F72" } }, ["Coming soon"]),
      ]),
    ]);
  }

  function renderShopGrid(node) {
    var storeMode = node.getAttribute("data-plexo-commerce-store-mode") !== "false";
    if (storeMode) {
      renderShopGridStore(node);
    } else {
      renderShopGridCurated(node);
    }
  }

  // Clamped 1-6 to match the pc-grid-cols-N classes injectStyles() generates — any
  // number outside that range falls back to the sensible default rather than emitting a
  // class that doesn't exist.
  function clampGridCols(raw, fallback) {
    var n = parseInt(raw, 10);
    if (!isFinite(n) || n < 1) return fallback;
    return Math.min(6, n);
  }
  function clampPageSize(raw, fallback) {
    var n = parseInt(raw, 10);
    if (!isFinite(n) || n < 1) return fallback;
    return Math.min(96, n);
  }

  function renderShopGridStore(node) {
    var itemsPerRow = clampGridCols(node.getAttribute("data-plexo-commerce-items-per-row"), 4);
    var pageSize = clampPageSize(node.getAttribute("data-plexo-commerce-items-per-page"), 12);
    var dark = node.getAttribute("data-plexo-commerce-mode") === "dark";

    showSpinner(node);
    api("/api/public/commerce/products")
      .then(function (data) {
        var allProducts = (data.products || []).filter(function (p) {
          return p.kind === "PHYSICAL";
        });
        var catalogEmpty = allProducts.length === 0;
        var categories = data.categories || [];
        var activeCategory = null;
        var searchTerm = "";
        var stockFilter = "all";
        var page = 1;

        clear(node);
        prepareNode(node);

        if (catalogEmpty) {
          node.appendChild(
            el("div", { style: { padding: "60px 20px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" } }, [
              el("span", { class: "pc-serif", style: { fontSize: "18px", color: "#16233F" } }, ["No products yet"]),
              el("span", { class: "pc-muted", style: { fontSize: "14px" } }, ["Check back soon — new items are on the way."]),
            ])
          );
          return;
        }

        var grid = el("div", { class: "pc-grid pc-grid-cols-" + itemsPerRow });
        var pager = el("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", marginTop: "28px" } });

        function matchesStock(p) {
          if (stockFilter === "all") return true;
          var inStock = p.stockQuantity === null || p.stockQuantity === undefined || p.stockQuantity > 0;
          return stockFilter === "in" ? inStock : !inStock;
        }

        function renderCards() {
          clear(grid);
          clear(pager);
          var filtered = allProducts.filter(function (p) {
            var matchesCategory = !activeCategory || (p.category && p.category.slug === activeCategory);
            var matchesSearch = !searchTerm || p.name.toLowerCase().indexOf(searchTerm.toLowerCase()) !== -1;
            return matchesCategory && matchesSearch && matchesStock(p);
          });
          if (filtered.length === 0) {
            grid.appendChild(el("p", { class: "pc-muted", style: { gridColumn: "1 / -1" } }, ["No products match — try a different filter."]));
            return;
          }
          var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
          if (page > totalPages) page = totalPages;
          var start = (page - 1) * pageSize;
          filtered.slice(start, start + pageSize).forEach(function (p) {
            grid.appendChild(shopCard(p, dark));
          });
          if (totalPages > 1) {
            var prevBtn, nextBtn;
            pager.appendChild(
              (prevBtn = el(
                "button",
                { class: "pc-btn-outline", style: { padding: "8px 16px", fontSize: "13px" }, disabled: page <= 1 ? "disabled" : null, onclick: function () { page -= 1; renderCards(); window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" }); } },
                ["Previous"]
              ))
            );
            pager.appendChild(el("span", { class: "pc-mono", style: { fontSize: "12.5px", color: "#565F72" } }, ["Page " + page + " of " + totalPages]));
            pager.appendChild(
              (nextBtn = el(
                "button",
                { class: "pc-btn-outline", style: { padding: "8px 16px", fontSize: "13px" }, disabled: page >= totalPages ? "disabled" : null, onclick: function () { page += 1; renderCards(); window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" }); } },
                ["Next"]
              ))
            );
          }
        }

        function resetAndRender() {
          page = 1;
          renderCards();
        }

        var controls = el("div", { class: "pc-shop-controls", style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "14px", marginBottom: "24px" } });

        var pillRow = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } });
        if (categories.length > 0) {
          var allPill = el(
            "span",
            {
              class: "pc-pill active",
              onclick: function () {
                activeCategory = null;
                Array.prototype.forEach.call(pillRow.children, function (p) {
                  p.classList.remove("active");
                });
                allPill.classList.add("active");
                resetAndRender();
              },
            },
            ["All"]
          );
          pillRow.appendChild(allPill);
          categories.forEach(function (cat) {
            var pill = el(
              "span",
              {
                class: "pc-pill",
                onclick: function () {
                  activeCategory = cat.slug;
                  Array.prototype.forEach.call(pillRow.children, function (p) {
                    p.classList.remove("active");
                  });
                  pill.classList.add("active");
                  resetAndRender();
                },
              },
              [cat.name]
            );
            pillRow.appendChild(pill);
          });
        }

        var rightControls = el("div", { class: "pc-shop-controls-right", style: { display: "flex", gap: "10px", flexWrap: "wrap", marginLeft: "auto" } }, [
          el(
            "select",
            {
              class: "pc-select",
              onchange: function (e) {
                stockFilter = e.target.value;
                resetAndRender();
              },
            },
            [
              el("option", { value: "all" }, ["All items"]),
              el("option", { value: "in" }, ["In stock"]),
              el("option", { value: "out" }, ["Out of stock"]),
            ]
          ),
          el("input", {
            class: "pc-input pc-shop-search",
            placeholder: "Search products…",
            style: { width: "220px" },
            oninput: function (e) {
              searchTerm = e.target.value;
              resetAndRender();
            },
          }),
        ]);

        controls.appendChild(pillRow);
        controls.appendChild(rightControls);

        node.appendChild(controls);
        node.appendChild(grid);
        node.appendChild(pager);
        renderCards();
      })
      .catch(function (err) {
        showError(node, err.message);
      });
  }

  // Curated mode (storeMode: false) — a fixed category/sort + limit, no search/filter UI,
  // optionally its own pagination. Reads config straight off the marker's own attributes
  // (set by whoever placed the block — see plexo-sdk compiler.ts's shop_grid case).
  function renderShopGridCurated(node) {
    var category = node.getAttribute("data-plexo-commerce-category") || "";
    var sort = node.getAttribute("data-plexo-commerce-sort") || "";
    var limit = clampPageSize(node.getAttribute("data-plexo-commerce-limit"), 6);
    var itemsPerRow = clampGridCols(node.getAttribute("data-plexo-commerce-items-per-row"), 3);
    var paginated = node.getAttribute("data-plexo-commerce-paginated") === "true";
    var itemsPerPage = clampPageSize(node.getAttribute("data-plexo-commerce-items-per-page"), limit);
    var dark = node.getAttribute("data-plexo-commerce-mode") === "dark";
    var categoryParam = category || sort || "";
    var page = 1;

    showSpinner(node);
    prepareNode(node);

    function load() {
      var params = "?";
      if (categoryParam) params += "category=" + encodeURIComponent(categoryParam) + "&";
      if (paginated) {
        params += "pageSize=" + itemsPerPage + "&page=" + page;
      } else {
        params += "limit=" + limit;
      }
      api("/api/public/commerce/products" + params).then(paint).catch(function (err) {
        showError(node, err.message);
      });
    }

    function paint(data) {
      clear(node);
      var products = (data.products || []).filter(function (p) {
        return p.kind === "PHYSICAL";
      });
      var total = data.total || 0;
      var grid = el("div", { class: "pc-grid pc-grid-cols-" + itemsPerRow });

      var slots = paginated ? itemsPerPage : limit;
      for (var i = 0; i < Math.min(products.length, slots); i++) {
        grid.appendChild(shopCard(products[i], dark));
      }
      // A brand-new catalog (or one with nothing in this category yet) still fills the
      // shelf with placeholders rather than showing a half-empty or blank grid.
      for (var j = products.length; j < slots; j++) {
        grid.appendChild(placeholderCard(dark));
      }

      node.appendChild(grid);

      if (paginated && total > itemsPerPage) {
        var totalPages = Math.ceil(total / itemsPerPage);
        var prevBtn, nextBtn, pageLabel;
        node.appendChild(
          el("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", marginTop: "20px" } }, [
            (prevBtn = el(
              "button",
              { class: "pc-btn-outline", style: { padding: "8px 16px", fontSize: "13px" }, disabled: page <= 1 ? "disabled" : null, onclick: function () { page -= 1; showSpinner(node); load(); } },
              ["Previous"]
            )),
            (pageLabel = el("span", { class: "pc-mono", style: { fontSize: "12.5px", color: "#565F72" } }, ["Page " + page + " of " + totalPages])),
            (nextBtn = el(
              "button",
              { class: "pc-btn-outline", style: { padding: "8px 16px", fontSize: "13px" }, disabled: page >= totalPages ? "disabled" : null, onclick: function () { page += 1; showSpinner(node); load(); } },
              ["Next"]
            )),
          ])
        );
      }
    }

    load();
  }

  // ---------------------------------------------------------------------
  // newsletter signup — not a native SDK marker (see data-plexo-commerce-product-count
  // for the same pattern): a plain data-plexo-newsletter-signup attribute a hand-authored
  // page (the footer, here) can drop anywhere. Tags the email into the site's configured
  // MailDrip newsletter group — entirely separate from the paid-customer group a
  // completed order tags into.
  // ---------------------------------------------------------------------

  function renderNewsletterSignup(node) {
    prepareNode(node);
    clear(node);
    var input = el("input", {
      type: "email",
      placeholder: "Your email address",
      class: "pc-newsletter-input",
      style: { flex: "1", minWidth: "0", padding: "12px 14px", fontSize: "13.5px", border: "1px solid rgba(227,178,60,0.3)", background: "transparent", color: "#FBFAF6", fontFamily: "'Public Sans', sans-serif" },
    });
    var btn;
    var msg = el("div", { style: { fontSize: "12px", marginTop: "8px", minHeight: "14px" } });
    var row = el("div", { style: { display: "flex", gap: "10px" } }, [
      input,
      (btn = el(
        "button",
        {
          class: "pc-btn pc-btn-gold",
          style: { flexShrink: "0", padding: "12px 20px", fontSize: "13px" },
          onclick: function () {
            var email = input.value.trim();
            if (!email || email.indexOf("@") === -1) {
              msg.textContent = "Please enter a valid email.";
              msg.style.color = "#E3987F";
              return;
            }
            btn.disabled = true;
            btn.textContent = "Subscribing…";
            api("/api/public/commerce/newsletter", { method: "POST", body: JSON.stringify({ email: email }) })
              .then(function () {
                btn.textContent = "Subscribed ✓";
                msg.textContent = "Thanks — you're on the list.";
                msg.style.color = "#9CA6BA";
                input.value = "";
                setTimeout(function () {
                  btn.disabled = false;
                  btn.textContent = "Subscribe";
                }, 2500);
              })
              .catch(function (err) {
                btn.disabled = false;
                btn.textContent = "Subscribe";
                msg.textContent = err.message;
                msg.style.color = "#E3987F";
              });
          },
        },
        ["Subscribe"]
      )),
    ]);
    node.appendChild(row);
    node.appendChild(msg);
  }

  // ---------------------------------------------------------------------
  // cart_summary — line items, quantities, subtotal
  // ---------------------------------------------------------------------

  // Renders as a compact, self-contained "Order summary" card (its own pc-card chrome,
  // not just a bare list) — designed to sit in the checkout page's right-hand sidebar
  // column next to renderCheckoutFlow's form. Reads/submits checkoutFormState directly
  // since the delivery method and contact fields live in the OTHER marker's DOM.
  function renderCartSummary(node) {
    var latestSnapshot = null;
    var config = null;
    // Lives at this scope (not inside paint()) deliberately — updateItem/removeItem call
    // paint() synchronously to show a row disabled mid-request, and paint() rebuilds its
    // whole subtree (including re-declaring updateItem/removeItem as closures) on every
    // call. A busyItemId declared inside paint() would reset to null on that very
    // re-render, erasing the busy state it was just set to show.
    var busyItemId = null;

    function needsDelivery(snapshot) {
      return snapshot.items.some(function (i) {
        return i.kind === "PHYSICAL";
      });
    }

    function computeTotal(snapshot) {
      return snapshot.subtotalMinor + (needsDelivery(snapshot) ? checkoutFormState.deliveryFeeMinor : 0);
    }

    function totalsRow(label, value, muted) {
      return el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "13.5px" } }, [
        el("span", { class: "pc-muted" }, [label]),
        el("span", { style: { color: muted ? "#2E7D52" : "#16233F", fontWeight: muted ? "600" : "500" } }, [value]),
      ]);
    }

    function paint(snapshot) {
      latestSnapshot = snapshot;
      clear(node);
      prepareNode(node);

      var heading = el("h3", { style: { margin: "0", fontFamily: "'Fraunces', serif", fontWeight: "600", fontSize: "17px", color: "#16233F" } }, ["Order summary"]);

      if (!snapshot.items || snapshot.items.length === 0) {
        node.appendChild(
          el("div", { class: "pc-card", style: { padding: "24px", display: "flex", flexDirection: "column", gap: "16px" } }, [
            heading,
            el("div", { style: { textAlign: "center", padding: "20px 0", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" } }, [
              el("p", { class: "pc-muted", style: { margin: "0", fontSize: "14px" } }, ["Your cart is empty."]),
              el("a", { class: "pc-btn-outline pc-btn", href: STOREFRONT_PATH, style: { textDecoration: "none" } }, ["Continue shopping"]),
            ]),
          ])
        );
        return;
      }

      function updateItem(itemId, quantity) {
        if (busyItemId) return;
        busyItemId = itemId;
        paint(latestSnapshot); // re-render immediately so the row disables while in flight
        api("/api/public/commerce/cart/items/" + encodeURIComponent(itemId), { method: "PATCH", body: JSON.stringify({ quantity: quantity }) })
          .then(function (updated) {
            busyItemId = null;
            broadcastCart(updated);
          })
          .catch(function () {
            busyItemId = null;
            paint(latestSnapshot);
          });
      }

      function removeItem(itemId) {
        if (busyItemId) return;
        busyItemId = itemId;
        paint(latestSnapshot);
        api("/api/public/commerce/cart/items/" + encodeURIComponent(itemId), { method: "DELETE" })
          .then(function (updated) {
            busyItemId = null;
            broadcastCart(updated);
          })
          .catch(function () {
            busyItemId = null;
            paint(latestSnapshot);
          });
      }

      var list = el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        snapshot.items.map(function (item) {
          var rowBusy = busyItemId === item.itemId;
          return el("div", { style: { display: "flex", alignItems: "center", gap: "12px", opacity: rowBusy ? "0.5" : "1" } }, [
            item.imageUrl
              ? el("img", { src: item.imageUrl, alt: item.name, style: { width: "48px", height: "48px", objectFit: "cover", flexShrink: "0" } })
              : el("div", { style: { width: "48px", height: "48px", background: "#F3F1EA", flexShrink: "0" } }),
            el("div", { style: { flex: "1", minWidth: "0" } }, [
              el("div", { style: { fontSize: "13.5px", fontWeight: "600", color: "#16233F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [item.name]),
              el("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" } }, [
                el("div", { style: { display: "flex", alignItems: "center", border: "1px solid #E4E1D6" } }, [
                  el(
                    "button",
                    {
                      type: "button",
                      disabled: rowBusy ? "disabled" : null,
                      style: { border: "none", background: "transparent", width: "24px", height: "24px", padding: "0", fontSize: "13px", cursor: "pointer", lineHeight: "1" },
                      onclick: function () {
                        updateItem(item.itemId, item.quantity - 1); // quantity<=0 removes it server-side
                      },
                    },
                    ["–"]
                  ),
                  el("span", { class: "pc-mono", style: { width: "28px", textAlign: "center", fontSize: "11px" } }, [String(item.quantity)]),
                  el(
                    "button",
                    {
                      type: "button",
                      disabled: rowBusy ? "disabled" : null,
                      style: { border: "none", background: "transparent", width: "24px", height: "24px", padding: "0", fontSize: "13px", cursor: "pointer", lineHeight: "1" },
                      onclick: function () {
                        updateItem(item.itemId, item.quantity + 1);
                      },
                    },
                    ["+"]
                  ),
                ]),
                el(
                  "button",
                  {
                    type: "button",
                    disabled: rowBusy ? "disabled" : null,
                    style: { border: "none", background: "transparent", padding: "0", fontSize: "11px", color: "#8A93A6", textDecoration: "underline", cursor: "pointer" },
                    onclick: function () {
                      removeItem(item.itemId);
                    },
                  },
                  ["Remove"]
                ),
              ]),
            ]),
            el("div", { style: { fontSize: "13.5px", fontWeight: "600", color: "#16233F", whiteSpace: "nowrap" } }, [money(item.lineTotalMinor, snapshot.currency)]),
          ]);
        })
      );

      var total = computeTotal(snapshot);
      var payBtn;
      var errorBox = null;

      if (config && !checkoutFormState.paymentMethod) checkoutFormState.paymentMethod = defaultPaymentMethod(config);
      var isBankTransfer = checkoutFormState.paymentMethod === "BANK_TRANSFER";
      var payLabel = isBankTransfer ? "I've sent the transfer — Place order" : "Continue to Payment →";
      var paymentSection = config
        ? paymentChoiceSection(config, money(total, snapshot.currency), function (method) {
            checkoutFormState.paymentMethod = method;
            paint(latestSnapshot);
          })
        : null;

      payBtn = el(
        "button",
        {
          class: "pc-btn pc-btn-gold",
          style: { width: "100%" },
          onclick: function () {
            if (errorBox) {
              errorBox.remove();
              errorBox = null;
            }
            if (!checkoutFormState.customerEmail || checkoutFormState.customerEmail.indexOf("@") === -1) {
              errorBox = el("div", { class: "pc-error" }, ["Please enter a valid email in Your details."]);
              payBtn.parentNode.insertBefore(errorBox, payBtn);
              return;
            }
            if (needsDelivery(snapshot) && !checkoutFormState.deliveryMethodId) {
              errorBox = el("div", { class: "pc-error" }, [checkoutFormState.fulfillmentMode === "pickup" ? "Please choose a pickup option." : "Please choose how you'd like to get your order."]);
              payBtn.parentNode.insertBefore(errorBox, payBtn);
              return;
            }
            var missing = config ? missingRequiredField(config.fields, checkoutFormState.customFields, checkoutDeliveryCountry()) : null;
            if (missing) {
              errorBox = el("div", { class: "pc-error" }, ['Please answer "' + missing + '".']);
              payBtn.parentNode.insertBefore(errorBox, payBtn);
              return;
            }
            if (config && !checkoutFormState.paymentMethod) {
              errorBox = el("div", { class: "pc-error" }, ["This store isn't accepting payments yet — please check back soon."]);
              payBtn.parentNode.insertBefore(errorBox, payBtn);
              return;
            }
            payBtn.disabled = true;
            payBtn.textContent = isBankTransfer ? "Placing order…" : "Starting payment…";
            api("/api/public/commerce/checkout/cart", {
              method: "POST",
              body: JSON.stringify({
                customerName: checkoutFormState.customerName || undefined,
                customerEmail: checkoutFormState.customerEmail,
                customerPhone: checkoutFormState.customerPhone || undefined,
                deliveryMethodId: checkoutFormState.deliveryMethodId || undefined,
                shippingCountry: checkoutFormState.shippingCountry || undefined,
                shippingState: checkoutFormState.shippingState || undefined,
                // City is informational only (see MAJOR_CITIES_BY_STATE's own comment) — no
                // dedicated column for it, so it rides along as part of the address line
                // rather than needing a backend/schema change for a non-eligibility field.
                shippingAddressLine:
                  [checkoutFormState.shippingAddressLine, checkoutFormState.shippingCity].filter(Boolean).join(", ") || undefined,
                discountCode: checkoutFormState.discountCode || undefined,
                paymentMethod: checkoutFormState.paymentMethod || undefined,
                customFields: checkoutFormState.customFields,
              }),
            })
              .then(function (result) {
                if (result.redirectUrl) {
                  window.location.href = result.redirectUrl;
                  return;
                }
                if (result.checkout && result.checkout.provider === "stripe") {
                  payBtn.disabled = false;
                  payBtn.textContent = payLabel;
                  openStripeEmbeddedCheckout(result.checkout, function (err) {
                    errorBox = el("div", { class: "pc-error" }, [err.message]);
                    payBtn.parentNode.insertBefore(errorBox, payBtn);
                  });
                  return;
                }
                window.location.href = result.authorizationUrl;
              })
              .catch(function (err) {
                payBtn.disabled = false;
                payBtn.textContent = payLabel;
                errorBox = el("div", { class: "pc-error" }, [err.message]);
                payBtn.parentNode.insertBefore(errorBox, payBtn);
              });
          },
        },
        [payLabel]
      );

      node.appendChild(
        el("div", { class: "pc-card", style: { padding: "24px", display: "flex", flexDirection: "column", gap: "18px" } }, [
          heading,
          list,
          el(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "8px", paddingTop: "16px", borderTop: "1px solid #E4E1D6" } },
            [totalsRow("Subtotal", money(snapshot.subtotalMinor, snapshot.currency))].concat(
              needsDelivery(snapshot)
                ? [totalsRow(checkoutFormState.fulfillmentMode === "pickup" ? "Pickup" : "Delivery", checkoutFormState.deliveryFeeMinor > 0 ? money(checkoutFormState.deliveryFeeMinor, snapshot.currency) : "Free", checkoutFormState.deliveryFeeMinor === 0)]
                : []
            )
          ),
          el("div", { style: { display: "flex", justifyContent: "space-between", paddingTop: "14px", borderTop: "1px solid #E4E1D6", fontSize: "16px", fontWeight: "700", color: "#16233F" } }, [
            el("span", {}, ["Total"]),
            el("span", {}, [money(total, snapshot.currency)]),
          ]),
          paymentSection,
          payBtn,
          el("p", { class: "pc-muted", style: { fontSize: "11px", textAlign: "center", margin: "0" } }, [
            isBankTransfer ? "Direct bank transfer · confirmed by the store once received" : "Secured by " + (snapshot.paymentGateway === "stripe" ? "Stripe" : "Paystack"),
          ]),
        ])
      );
    }

    showSpinner(node);
    Promise.all([fetchCart(), fetchCheckoutConfig()])
      .then(function (results) {
        config = results[1];
        paint(results[0]);
      })
      .catch(function (err) {
        showError(node, err.message);
      });
    document.addEventListener(CART_EVENT, function (e) {
      paint(e.detail);
    });
    // Delivery method lives in the OTHER marker (renderCheckoutFlow) — re-render our own
    // totals when it changes rather than re-fetching the cart, which hasn't changed.
    document.addEventListener(CHECKOUT_STATE_EVENT, function () {
      if (latestSnapshot) paint(latestSnapshot);
    });
  }

  // ---------------------------------------------------------------------
  // checkout_flow — delivery, contact, discount, pay
  // ---------------------------------------------------------------------

  // Renders ONLY the delivery-method / contact-details / discount-code form — the
  // checkout page's LEFT column. Totals and the actual Pay button live in the sidebar
  // (see renderCartSummary) since that's where the mockup puts them; this writes every
  // field straight into the shared checkoutFormState and broadcasts CHECKOUT_STATE_EVENT
  // on delivery-method changes so the sidebar's total stays in sync.
  function renderCheckoutFlow(node) {
    showSpinner(node);
    Promise.all([fetchCart(), fetchCheckoutConfig()])
      .then(function (results) {
        var cart = results[0];
        var config = results[1];
        clear(node);
        prepareNode(node);

        if (!cart.items || cart.items.length === 0) {
          node.appendChild(el("p", { class: "pc-muted", style: { fontSize: "14px" } }, ["Your cart is empty — add something before checking out."]));
          return;
        }

        var needsDelivery = cart.items.some(function (i) {
          return i.kind === "PHYSICAL";
        });

        // Delivery vs. pickup. Shipping (COURIER) options depend on the address typed in;
        // pickup options never do (see resolveAvailableDeliveryMethods) — including the
        // built-in "Store pickup" every store gets by default — so a pickup customer is
        // never asked for an address at all.
        var deliveryAllowed = !config.fulfillment || config.fulfillment.deliveryEnabled !== false;
        var pickupMethods = [];
        var modeSection = el("div", {});
        var fulfillmentBody = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });
        var deliverySection = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
        var pickupSection = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
        var addressBlock = null; // built below, once its inputs exist
        // Says what's actually on offer once pickup options have loaded — "Delivery or
        // pickup" only when both genuinely exist.
        var fulfillmentHeading = el("h3", { style: { margin: "0 0 14px", fontFamily: "'Fraunces', serif", fontWeight: "600", fontSize: "17px", color: "#16233F" } }, [deliveryAllowed ? "Delivery" : "Pickup"]);
        var deliveryFetchTimer = null;

        function selectMethod(method) {
          checkoutFormState.deliveryMethodId = method ? method.id : null;
          checkoutFormState.deliveryFeeMinor = method ? method.feeMinor || 0 : 0;
          document.dispatchEvent(new CustomEvent(CHECKOUT_STATE_EVENT));
        }

        function paintOptions(container, methods, emptyText, describe) {
          clear(container);
          var stillValid = methods.some(function (m) {
            return m.id === checkoutFormState.deliveryMethodId;
          });
          if (!stillValid && checkoutFormState.deliveryMethodId) selectMethod(null);
          if (!methods.length) {
            container.appendChild(el("p", { class: "pc-muted", style: { fontSize: "13px", margin: "0" } }, [emptyText]));
            return;
          }
          if (!checkoutFormState.deliveryMethodId && methods.length === 1) selectMethod(methods[0]);
          container.appendChild(
            el(
              "div",
              { role: "radiogroup", style: { display: "flex", gap: "12px", flexWrap: "wrap" } },
              methods.map(function (m) {
                return optionCard({
                  title: m.name,
                  subtitle: describe(m),
                  selected: m.id === checkoutFormState.deliveryMethodId,
                  minWidth: "180px",
                  onSelect: function () {
                    selectMethod(m);
                    paintOptions(container, methods, emptyText, describe);
                  },
                });
              })
            )
          );
        }

        function feeText(m) {
          return m.feeMinor > 0 ? money(m.feeMinor, cart.currency) : "Free";
        }
        function courierSubtitle(m) {
          return feeText(m) + (m.estimatedTimeLabel ? " · " + m.estimatedTimeLabel : "");
        }
        function pickupSubtitle(m) {
          return (m.location ? "Pick up at: " + m.location : "The store will send you the pickup address") + " · " + feeText(m);
        }

        function loadCourierOptions() {
          clear(deliverySection);
          deliverySection.appendChild(el("p", { class: "pc-muted", style: { fontSize: "13px", margin: "0" } }, ["Loading delivery options…"]));
          var qs = [];
          if (checkoutFormState.shippingCountry) qs.push("country=" + encodeURIComponent(checkoutFormState.shippingCountry));
          if (checkoutFormState.shippingState) qs.push("state=" + encodeURIComponent(checkoutFormState.shippingState));
          var emptyText = !checkoutFormState.shippingCountry
            ? "Choose your country to see delivery options."
            : pickupMethods.length
              ? "No delivery options cover this address yet — try a different country or state, or choose pickup instead."
              : "No delivery options cover this address yet — try a different country or state, or contact the seller directly.";
          api("/api/public/commerce/delivery-methods" + (qs.length ? "?" + qs.join("&") : ""))
            .then(function (data) {
              var courier = (data.methods || []).filter(function (m) {
                // A country-limited option only makes sense once a country is chosen —
                // offering it earlier lets a customer pick one the server then rejects.
                return m.type === "COURIER" && (checkoutFormState.shippingCountry || !(m.countries && m.countries.length));
              });
              paintOptions(deliverySection, courier, emptyText, courierSubtitle);
            })
            .catch(function () {
              paintOptions(deliverySection, [], emptyText, courierSubtitle);
            });
        }

        function scheduleDeliveryReload() {
          if (checkoutFormState.fulfillmentMode !== "delivery") return;
          if (deliveryFetchTimer) clearTimeout(deliveryFetchTimer);
          deliveryFetchTimer = setTimeout(loadCourierOptions, 350);
        }

        function setMode(mode) {
          if (mode !== checkoutFormState.fulfillmentMode) {
            checkoutFormState.fulfillmentMode = mode;
            selectMethod(null);
          }
          paintMode();
        }

        function paintMode() {
          clear(modeSection);
          clear(fulfillmentBody);
          var hasPickup = pickupMethods.length > 0;
          if (!deliveryAllowed && !hasPickup) {
            checkoutFormState.fulfillmentMode = null;
            fulfillmentBody.appendChild(
              el("p", { class: "pc-muted", style: { fontSize: "13px", margin: "0" } }, [
                "This store isn't offering delivery or pickup right now — please contact the seller to arrange your order.",
              ])
            );
            return;
          }
          fulfillmentHeading.textContent = deliveryAllowed && hasPickup ? "Delivery or pickup" : deliveryAllowed ? "Delivery" : "Pickup";
          if (deliveryAllowed && hasPickup) {
            modeSection.appendChild(
              el("div", { role: "radiogroup", style: { display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" } }, [
                optionCard({ title: "Delivery", subtitle: "Ship it to my address", selected: checkoutFormState.fulfillmentMode === "delivery", onSelect: function () { setMode("delivery"); } }),
                optionCard({ title: "Pickup", subtitle: "I'll collect it from the store", selected: checkoutFormState.fulfillmentMode === "pickup", onSelect: function () { setMode("pickup"); } }),
              ])
            );
          } else {
            checkoutFormState.fulfillmentMode = deliveryAllowed ? "delivery" : "pickup";
          }
          if (checkoutFormState.fulfillmentMode === "delivery") {
            fulfillmentBody.appendChild(addressBlock);
            fulfillmentBody.appendChild(deliverySection);
            loadCourierOptions();
          } else if (checkoutFormState.fulfillmentMode === "pickup") {
            fulfillmentBody.appendChild(pickupSection);
            paintOptions(pickupSection, pickupMethods, "No pickup options are available right now.", pickupSubtitle);
            fulfillmentBody.appendChild(
              el("p", { class: "pc-muted", style: { fontSize: "12.5px", lineHeight: "1.55", margin: "0" } }, [
                "Pickup is free. The store will confirm with you when your order is ready to collect.",
              ])
            );
          }
          document.dispatchEvent(new CustomEvent(CHECKOUT_STATE_EVENT));
        }

        function loadFulfillmentOptions() {
          fulfillmentBody.appendChild(el("p", { class: "pc-muted", style: { fontSize: "13px", margin: "0" } }, ["Loading delivery options…"]));
          api("/api/public/commerce/delivery-methods")
            .then(function (data) {
              pickupMethods = (data.methods || []).filter(function (m) {
                return m.type === "PICKUP";
              });
              paintMode();
            })
            .catch(function () {
              pickupMethods = [];
              paintMode();
            });
        }

        function field(label, type, stateKey) {
          var input = el("input", {
            class: "pc-input",
            type: type || "text",
            value: checkoutFormState[stateKey] || "",
            oninput: function (e) {
              checkoutFormState[stateKey] = e.target.value;
            },
          });
          return el("div", {}, [el("label", { class: "pc-label" }, [label]), input]);
        }

        var discountInput = el("input", { class: "pc-input", placeholder: "Enter code", value: checkoutFormState.discountCode || "" });
        var discountMsg = el("span", { class: "pc-muted", style: { fontSize: "12px" } });

        var sections = [];

        if (needsDelivery) {
          var stateFieldBox = el("div", {});
          var cityFieldBox = el("div", {});

          function buildCityField() {
            clear(cityFieldBox);
            var cities = MAJOR_CITIES_BY_STATE[checkoutFormState.shippingState];
            var field;
            if (cities && !checkoutFormState.shippingCityIsOther) {
              if (checkoutFormState.shippingCity && cities.indexOf(checkoutFormState.shippingCity) === -1) {
                checkoutFormState.shippingCity = "";
              }
              field = el(
                "select",
                {
                  class: "pc-select",
                  style: { width: "100%" },
                  onchange: function (e) {
                    if (e.target.value === OTHER_CITY_VALUE) {
                      checkoutFormState.shippingCityIsOther = true;
                      checkoutFormState.shippingCity = "";
                      buildCityField();
                      return;
                    }
                    checkoutFormState.shippingCity = e.target.value;
                  },
                },
                [el("option", { value: "" }, ["Select city"])]
                  .concat(
                    cities.map(function (name) {
                      return el("option", { value: name, selected: checkoutFormState.shippingCity === name ? "selected" : null }, [name]);
                    })
                  )
                  .concat([el("option", { value: OTHER_CITY_VALUE }, ["Other (type below)"])])
              );
            } else {
              field = el("input", {
                class: "pc-input",
                value: checkoutFormState.shippingCity,
                placeholder: "City / town",
                oninput: function (e) {
                  checkoutFormState.shippingCity = e.target.value;
                },
              });
            }
            cityFieldBox.appendChild(field);
          }

          function buildStateField() {
            clear(stateFieldBox);
            var options = STATES_BY_COUNTRY[checkoutFormState.shippingCountry];
            var field;
            if (options) {
              // A state chosen under one country, then the country changed, is no longer
              // meaningful — cleared rather than left stale so a leftover value can't
              // silently mismatch the new country in the delivery-method lookup.
              if (checkoutFormState.shippingState && options.indexOf(checkoutFormState.shippingState) === -1) {
                checkoutFormState.shippingState = "";
              }
              field = el(
                "select",
                {
                  class: "pc-select",
                  style: { width: "100%" },
                  onchange: function (e) {
                    checkoutFormState.shippingState = e.target.value;
                    checkoutFormState.shippingCity = "";
                    checkoutFormState.shippingCityIsOther = false;
                    buildCityField();
                    scheduleDeliveryReload();
                  },
                },
                [el("option", { value: "" }, ["Select state"])].concat(
                  options.map(function (name) {
                    return el("option", { value: name, selected: checkoutFormState.shippingState === name ? "selected" : null }, [name]);
                  })
                )
              );
            } else {
              field = el("input", {
                class: "pc-input",
                value: checkoutFormState.shippingState,
                placeholder: "State / region",
                oninput: function (e) {
                  checkoutFormState.shippingState = e.target.value.trim();
                  scheduleDeliveryReload();
                },
              });
            }
            stateFieldBox.appendChild(field);
            buildCityField();
          }

          var countryInput = el(
            "select",
            {
              class: "pc-select",
              style: { width: "100%" },
              onchange: function (e) {
                checkoutFormState.shippingCountry = e.target.value;
                buildStateField();
                scheduleDeliveryReload();
                document.dispatchEvent(new CustomEvent(CHECKOUT_STATE_EVENT));
              },
            },
            [el("option", { value: "" }, ["Select country"])].concat(
              COUNTRIES.map(function (c) {
                return el("option", { value: c[0], selected: checkoutFormState.shippingCountry === c[0] ? "selected" : null }, [c[1]]);
              })
            )
          );
          buildStateField();

          var addressLineInput = el("input", {
            class: "pc-input",
            value: checkoutFormState.shippingAddressLine,
            placeholder: "Street address",
            oninput: function (e) {
              checkoutFormState.shippingAddressLine = e.target.value;
            },
          });

          addressBlock = el("div", {}, [
            el("div", { style: { display: "flex", gap: "14px", flexWrap: "wrap", marginBottom: "14px" } }, [
              el("div", { style: { flex: "1", minWidth: "140px" } }, [el("label", { class: "pc-label" }, ["Country"]), countryInput]),
              el("div", { style: { flex: "1", minWidth: "140px" } }, [el("label", { class: "pc-label" }, ["State / region"]), stateFieldBox]),
            ]),
            el("div", { style: { display: "flex", gap: "14px", flexWrap: "wrap" } }, [
              el("div", { style: { flex: "1", minWidth: "140px" } }, [el("label", { class: "pc-label" }, ["City"]), cityFieldBox]),
              el("div", { style: { flex: "2", minWidth: "220px" } }, [el("label", { class: "pc-label" }, ["Street address"]), addressLineInput]),
            ]),
          ]);

          sections.push(
            el("div", {}, [
              fulfillmentHeading,
              modeSection,
              fulfillmentBody,
            ])
          );
        }

        sections.push(
          el("div", {}, [
            el("h3", { style: { margin: "0 0 14px", fontFamily: "'Fraunces', serif", fontWeight: "600", fontSize: "17px", color: "#16233F" } }, ["Your details"]),
            el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } }, [
              el("div", { style: { display: "flex", gap: "14px", flexWrap: "wrap" } }, [
                el("div", { style: { flex: "1", minWidth: "180px" } }, [field("Full name", "text", "customerName")]),
                el("div", { style: { flex: "1", minWidth: "180px" } }, [field("Phone number", "tel", "customerPhone")]),
              ]),
              field("Email", "email", "customerEmail"),
            ]),
          ])
        );

        var extraQuestions = customFieldsSection(config.fields, checkoutFormState.customFields, "Additional information", checkoutDeliveryCountry);
        if (extraQuestions) {
          sections.push(extraQuestions);
          document.addEventListener(CHECKOUT_STATE_EVENT, extraQuestions.refresh);
        }

        if (config.discounts !== false) sections.push(
          el("div", {}, [
            el("h3", { style: { margin: "0 0 14px", fontFamily: "'Fraunces', serif", fontWeight: "600", fontSize: "17px", color: "#16233F" } }, ["Discount code"]),
            el("div", { style: { display: "flex", gap: "10px" } }, [
              discountInput,
              el(
                "button",
                {
                  class: "pc-btn-outline",
                  style: { flexShrink: "0", padding: "0 22px" },
                  onclick: function () {
                    checkoutFormState.discountCode = discountInput.value.trim();
                    discountMsg.textContent = checkoutFormState.discountCode ? "Will be applied at payment." : "";
                  },
                },
                ["Apply"]
              ),
            ]),
            discountMsg,
          ])
        );

        node.appendChild(el("div", { style: { display: "flex", flexDirection: "column", gap: "30px" } }, sections));

        if (needsDelivery) loadFulfillmentOptions();
      })
      .catch(function (err) {
        showError(node, err.message);
      });
  }

  // ---------------------------------------------------------------------
  // order_confirmation — thank-you screen
  // ---------------------------------------------------------------------

  function renderOrderConfirmation(node) {
    var params = new URLSearchParams(window.location.search);
    var orderNumber = params.get("order");
    var email = params.get("email");
    if (!orderNumber || !email) {
      showError(node, "No order to show here yet.");
      return;
    }
    showSpinner(node);
    api("/api/public/commerce/orders/lookup?orderNumber=" + encodeURIComponent(orderNumber) + "&email=" + encodeURIComponent(email))
      .then(function (data) {
        var order = data.order;
        clear(node);
        prepareNode(node);
        var awaitingTransfer = order.paymentMethod === "BANK_TRANSFER" && order.status === "PENDING";
        node.appendChild(
          el("div", { class: "pc-card", style: { padding: "28px", display: "flex", flexDirection: "column", gap: "18px" } }, [
            el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, [
              el("span", { style: { background: "#16233F", color: "#fff", fontSize: "11px", fontWeight: "700", padding: "5px 10px", borderRadius: "3px", letterSpacing: "0.04em" } }, [order.orderNumber]),
              el("span", { class: "pc-badge " + (order.status === "PAID" ? "pc-badge-ok" : order.status === "PENDING" ? "pc-badge-low" : "pc-badge-out") }, [awaitingTransfer ? "Awaiting payment confirmation" : order.status]),
            ]),
            awaitingTransfer
              ? el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } }, [
                  el("p", { style: { margin: "0", fontSize: "14px", lineHeight: "1.6", color: "#16233F" } }, [
                    "Thanks — your order is placed. The store will confirm it as soon as your bank transfer arrives, and we'll email you when it does.",
                  ]),
                  order.bankTransfer
                    ? el("p", { class: "pc-muted", style: { margin: "0", fontSize: "12.5px" } }, ["Haven't sent it yet? Transfer to:"])
                    : null,
                  order.bankTransfer ? bankDetailsCard(order.bankTransfer, money(order.amountMinor, order.currency), order.orderNumber) : null,
                ])
              : null,
            order.pickupLocation
              ? el("div", { style: { fontSize: "13px", color: "#16233F" } }, [el("strong", {}, ["Pickup at: "]), order.pickupLocation])
              : order.deliveryMethod === "PICKUP"
                ? el("div", { class: "pc-muted", style: { fontSize: "13px" } }, ["Pickup — the store will send you pickup details when your order is ready."])
                : null,
            el(
              "div",
              { style: { display: "flex", flexDirection: "column" } },
              order.items.map(function (item) {
                return el("div", { style: { display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #E4E1D6", fontSize: "13.5px" } }, [
                  el("span", {}, [item.nameSnapshot + " × " + item.quantity]),
                  el("span", { style: { fontWeight: "600" } }, [money(item.unitPriceMinor * item.quantity, order.currency)]),
                ]);
              })
            ),
            order.booking
              ? el("div", { class: "pc-muted", style: { fontSize: "13px" } }, ["Scheduled for " + new Date(order.booking.scheduledStart).toLocaleString()])
              : null,
            el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: "700", color: "#16233F" } }, [el("span", {}, ["Total"]), el("span", {}, [money(order.amountMinor, order.currency)])]),
            el("a", { class: "pc-btn", href: "/track-order?order=" + encodeURIComponent(order.orderNumber) + "&email=" + encodeURIComponent(email), style: { textAlign: "center", textDecoration: "none" } }, ["Track my order"]),
          ])
        );
      })
      .catch(function (err) {
        showError(node, err.message);
      });
  }

  // ---------------------------------------------------------------------
  // order_tracking — order-number + email lookup, status timeline
  // ---------------------------------------------------------------------

  var FULFILLMENT_STEPS = ["UNFULFILLED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"];
  var FULFILLMENT_LABELS = { UNFULFILLED: "Order placed", PROCESSING: "Processing", READY_FOR_PICKUP: "Ready for pickup", SHIPPED: "Shipped", COMPLETED: "Completed" };

  function renderOrderTracking(node) {
    prepareNode(node);
    clear(node);

    var params = new URLSearchParams(window.location.search);
    var orderField = el("input", { class: "pc-input", placeholder: "Order number (e.g. ORD-4F2A9C1B)", value: params.get("order") || "" });
    var emailField = el("input", { class: "pc-input", type: "email", placeholder: "Email used at checkout", value: params.get("email") || "" });
    var resultBox = el("div", {});
    var searchBtn;

    function search() {
      if (!orderField.value || !emailField.value) return;
      clear(resultBox);
      showSpinner(resultBox);
      api("/api/public/commerce/orders/lookup?orderNumber=" + encodeURIComponent(orderField.value.trim()) + "&email=" + encodeURIComponent(emailField.value.trim()))
        .then(function (data) {
          var order = data.order;
          clear(resultBox);
          if (order.status === "PENDING" && order.paymentMethod === "BANK_TRANSFER") {
            resultBox.appendChild(
              el("div", { class: "pc-error", style: { background: "#FBEFD8", borderColor: "#fde68a", color: "#92400e" } }, [
                "We're waiting for the store to confirm your bank transfer. You'll get an email as soon as it's confirmed.",
              ])
            );
            return;
          }
          if (order.status !== "PAID" && order.status !== "REFUNDED") {
            resultBox.appendChild(el("div", { class: "pc-error", style: { background: "#FBEFD8", borderColor: "#fde68a", color: "#92400e" } }, [order.status === "CANCELLED" ? "This order was cancelled." : "This order hasn't been paid for yet."]));
            return;
          }
          var isCancelled = order.status === "CANCELLED" || order.status === "REFUNDED";
          var currentIndex = FULFILLMENT_STEPS.indexOf(order.fulfillmentStatus);
          resultBox.appendChild(
            el("div", { class: "pc-card", style: { padding: "24px", display: "flex", flexDirection: "column", gap: "18px" } }, [
              el("div", { style: { fontSize: "13px" } }, ["Order ", el("strong", {}, [order.orderNumber])]),
              isCancelled
                ? el("div", { class: "pc-badge pc-badge-out" }, [order.status])
                : el(
                    "div",
                    { style: { display: "flex", alignItems: "center" } },
                    FULFILLMENT_STEPS.map(function (step, i) {
                      var done = i <= currentIndex;
                      return el("div", { style: { display: "flex", alignItems: "center", flex: i < FULFILLMENT_STEPS.length - 1 ? "1" : "0 0 auto" } }, [
                        el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", minWidth: "70px" } }, [
                          el("div", { style: { width: "16px", height: "16px", borderRadius: "50%", background: done ? "#16233F" : "#E4E1D6" } }),
                          el("div", { style: { fontSize: "10.5px", color: done ? "#16233F" : "#8A93A6", textAlign: "center", fontWeight: done ? "700" : "500" } }, [FULFILLMENT_LABELS[step]]),
                        ]),
                        i < FULFILLMENT_STEPS.length - 1 ? el("div", { style: { flex: "1", height: "2px", background: i < currentIndex ? "#16233F" : "#E4E1D6", margin: "0 4px 20px" } }) : null,
                      ]);
                    })
                  ),
            ])
          );
        })
        .catch(function (err) {
          clear(resultBox);
          resultBox.appendChild(el("div", { class: "pc-error" }, [err.message]));
        });
    }

    searchBtn = el("button", { class: "pc-btn", onclick: search }, ["Track"]);
    node.appendChild(
      el("div", { style: { display: "flex", flexDirection: "column", gap: "14px", maxWidth: "440px", margin: "0 auto", width: "100%" } }, [orderField, emailField, searchBtn, resultBox])
    );

    if (params.get("order") && params.get("email")) search();
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  // Not a native SDK marker family (no plexo-sdk change needed for this) — just a plain
  // `data-plexo-commerce-product-count` attribute a hand-authored page can drop on any
  // element (e.g. inside "View all N products") to have this runtime keep the number
  // live against the real catalog, instead of a count baked in at generation time that
  // silently goes stale the moment a product is added or removed.
  function renderProductCounts() {
    var nodes = document.querySelectorAll("[data-plexo-commerce-product-count]");
    if (nodes.length === 0) return;
    api("/api/public/commerce/products")
      .then(function (data) {
        var count = (data.products || []).filter(function (p) {
          return p.kind === "PHYSICAL";
        }).length;
        nodes.forEach(function (n) {
          n.textContent = String(count);
        });
      })
      .catch(function () {});
  }

  // ---------------------------------------------------------------------
  // Donations (lib/commerce/donations.ts). Two modes, one payment path:
  //  - a native donate form, rendered into any [data-plexo-donation="<campaignId>"] block;
  //  - an existing form (a donation form migrated from WordPress, kept pixel-identical)
  //    marked <form data-plexo-donation="<campaignId>" data-plexo-donation-adapter>, whose
  //    own fields are annotated with data-plexo-amount-minor / data-plexo-amount-custom /
  //    data-plexo-custom-amount / data-plexo-monthly / data-plexo-donor-* — this just
  //    takes over its submit.
  // Both finish payment exactly like storefront checkout (embedded Stripe, Paystack
  // redirect, or bank transfer), and both thank the donor when they come back.
  // ---------------------------------------------------------------------
  function donationReturnPath() {
    var params = new URLSearchParams(location.search);
    params.delete("plexo_donation");
    params.delete("order");
    var q = params.toString();
    return location.pathname + (q ? "?" + q : "");
  }

  function isDonationThanks() {
    return new URLSearchParams(location.search).get("plexo_donation") === "thanks";
  }

  function donationThanksBanner(campaign) {
    return el("div", { role: "status", style: { padding: "16px 18px", margin: "0 0 18px", borderRadius: "10px", background: "#E4F0E7", color: "#1F5C3C", fontWeight: "600", lineHeight: "1.5" } }, [
      (campaign && campaign.thankYouMessage) || "Thank you for your gift! A receipt is on its way to your inbox.",
    ]);
  }

  function submitDonation(payload, onError, onBusy) {
    onBusy(true);
    payload.returnPath = donationReturnPath();
    return api("/api/public/commerce/donate", { method: "POST", body: JSON.stringify(payload) })
      .then(function (result) {
        if (result.checkout && result.checkout.provider === "stripe") {
          onBusy(false);
          openStripeEmbeddedCheckout(result.checkout, function (err) {
            onError(err.message);
          });
          return;
        }
        if (result.authorizationUrl) {
          window.location.href = result.authorizationUrl;
          return;
        }
        if (result.redirectUrl) {
          window.location.href = result.redirectUrl;
          return;
        }
        onBusy(false);
      })
      .catch(function (err) {
        onBusy(false);
        onError(err.message);
      });
  }

  function fetchDonationCampaign(id) {
    return api("/api/public/commerce/donations/" + encodeURIComponent(id)).then(function (d) {
      return d.campaign;
    });
  }

  function renderDonation(node) {
    var campaignId = node.getAttribute("data-plexo-donation");
    if (!campaignId) return;
    if (node.tagName === "FORM") return adaptDonationForm(node, campaignId);
    showSpinner(node);
    fetchDonationCampaign(campaignId)
      .then(function (c) {
        clear(node);
        prepareNode(node);
        if (isDonationThanks()) node.appendChild(donationThanksBanner(c));
        if (!c.accepting) {
          node.appendChild(el("div", { class: "pc-muted", style: { padding: "12px 0" } }, ["Online donations are being set up — please check back soon."]));
          return;
        }
        var presets = c.presetAmounts || [];
        var state = {
          amountMinor: presets.length ? presets[Math.min(c.defaultPresetIndex || 0, presets.length - 1)].amountMinor : null,
          custom: !presets.length,
          frequency: c.allowMonthly ? c.defaultFrequency || "ONCE" : "ONCE",
        };
        var card = el("div", { class: "pc-card", style: { padding: "22px" } });
        if (c.goalAmountMinor) {
          var pct = Math.min(100, Math.round(((c.raisedMinor || 0) / c.goalAmountMinor) * 100));
          card.appendChild(el("div", { style: { marginBottom: "18px" } }, [
            el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "6px" } }, [
              el("strong", {}, [money(c.raisedMinor || 0, c.currency) + " raised"]),
              el("span", { class: "pc-muted" }, ["of " + money(c.goalAmountMinor, c.currency)]),
            ]),
            el("div", { style: { height: "8px", background: "#EEECE4", borderRadius: "99px", overflow: "hidden" } }, [
              el("div", { class: "pc-btn-gold", style: { height: "100%", width: pct + "%", padding: "0", borderRadius: "99px" } }),
            ]),
          ]));
        }
        var freqRow = null;
        function paintFreq() {
          if (!freqRow) return;
          Array.prototype.forEach.call(freqRow.children, function (b) {
            var on = b.getAttribute("data-f") === state.frequency;
            b.className = on ? "pc-btn" : "pc-btn pc-btn-outline";
          });
        }
        if (c.allowMonthly) {
          freqRow = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "14px" } }, [
            el("button", { type: "button", "data-f": "ONCE", onclick: function () { state.frequency = "ONCE"; paintFreq(); } }, ["Give once"]),
            el("button", { type: "button", "data-f": "MONTHLY", onclick: function () { state.frequency = "MONTHLY"; paintFreq(); } }, ["Monthly"]),
          ]);
          card.appendChild(freqRow);
          paintFreq();
        }
        var amountGrid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: "8px", marginBottom: "12px" } });
        var customInput = el("input", { class: "pc-input", type: "number", min: String((c.minAmountMinor || 100) / 100), step: "any", placeholder: "Other amount", style: { display: state.custom ? "block" : "none", marginBottom: "12px" } });
        function paintAmounts() {
          Array.prototype.forEach.call(amountGrid.children, function (b) {
            var on = b.getAttribute("data-custom") ? state.custom : !state.custom && Number(b.getAttribute("data-amount")) === state.amountMinor;
            b.className = on ? "pc-btn" : "pc-btn pc-btn-outline";
          });
          customInput.style.display = state.custom ? "block" : "none";
        }
        presets.forEach(function (p) {
          amountGrid.appendChild(el("button", { type: "button", "data-amount": String(p.amountMinor), style: { flexDirection: "column", gap: "2px" }, onclick: function () { state.custom = false; state.amountMinor = p.amountMinor; paintAmounts(); } }, [
            el("span", {}, [money(p.amountMinor, c.currency)]),
            p.label ? el("span", { style: { fontSize: "11.5px", fontWeight: "500", opacity: "0.8" } }, [p.label]) : null,
          ].filter(Boolean)));
        });
        if (c.allowCustomAmount) {
          amountGrid.appendChild(el("button", { type: "button", "data-custom": "1", onclick: function () { state.custom = true; paintAmounts(); customInput.focus(); } }, ["Other"]));
        }
        card.appendChild(amountGrid);
        card.appendChild(customInput);
        paintAmounts();
        var nameInput = el("input", { class: "pc-input", type: "text", placeholder: "Your name", autocomplete: "name", style: { marginBottom: "10px" } });
        var emailInput = el("input", { class: "pc-input", type: "email", placeholder: "Email for your receipt", autocomplete: "email", required: "required", style: { marginBottom: "14px" } });
        card.appendChild(nameInput);
        card.appendChild(emailInput);
        var errorBox = el("div", { class: "pc-error", style: { display: "none" } });
        var button = el("button", { type: "button", class: "pc-btn", style: { width: "100%" } }, [c.buttonLabel || "Donate"]);
        card.appendChild(errorBox);
        card.appendChild(button);
        node.appendChild(card);
        button.addEventListener("click", function () {
          errorBox.style.display = "none";
          var amount = state.custom ? Math.round(parseFloat(customInput.value || "0") * 100) : state.amountMinor;
          if (!amount || amount <= 0) {
            errorBox.textContent = "Please choose or enter an amount.";
            errorBox.style.display = "block";
            return;
          }
          submitDonation(
            { campaignId: campaignId, amountMinor: amount, frequency: state.frequency, donorName: nameInput.value, donorEmail: emailInput.value },
            function (msg) { errorBox.textContent = msg; errorBox.style.display = "block"; },
            function (busy) { button.disabled = busy; button.textContent = busy ? "Starting payment…" : c.buttonLabel || "Donate"; }
          );
        });
      })
      .catch(function (err) {
        showError(node, err.message);
      });
  }

  // A migrated donation form: keep its markup and styling exactly, just route its submit.
  function adaptDonationForm(form, campaignId) {
    if (form.getAttribute("data-plexo-adapted")) return;
    form.setAttribute("data-plexo-adapted", "1");
    form.removeAttribute("action");
    fetchDonationCampaign(campaignId)
      .then(function (c) {
        if (isDonationThanks()) {
          var banner = donationThanksBanner(c);
          // A form inside a closed pop-up isn't visible on return — show the thanks on top instead.
          if (!form.offsetParent || form.getBoundingClientRect().height === 0) {
            banner.style.position = "fixed";
            banner.style.top = "16px";
            banner.style.left = "50%";
            banner.style.transform = "translateX(-50%)";
            banner.style.zIndex = "2147483000";
            banner.style.maxWidth = "92vw";
            banner.style.boxShadow = "0 8px 30px rgba(0,0,0,.25)";
            document.body.appendChild(banner);
            setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 8000);
          } else {
            form.parentNode.insertBefore(banner, form);
          }
        }
        if (!c.accepting) {
          form.parentNode.insertBefore(el("div", { class: "pc-error" }, ["Online donations are being set up — please check back soon."]), form);
        }
      })
      .catch(function () {});
    var submitBtn = form.querySelector("button[type=submit], input[type=submit], button:not([type])");
    // Form plugins often ship their button disabled until their own script initializes it.
    if (submitBtn) submitBtn.disabled = false;
    var originalLabel = submitBtn ? submitBtn.innerHTML : "";
    // Keep the form's controls in step the way its original plugin script did: picking a
    // suggested amount fills the amount box, typing an amount selects "custom", ticking
    // monthly reveals its options.
    var amountBox = form.querySelector("[data-plexo-custom-amount]");
    var customChoice = form.querySelector("[data-plexo-amount-custom]");
    Array.prototype.forEach.call(form.querySelectorAll("[data-plexo-amount-minor]"), function (radio) {
      radio.addEventListener("change", function () {
        if (radio.checked && amountBox) amountBox.value = String(Number(radio.getAttribute("data-plexo-amount-minor")) / 100);
      });
    });
    if (amountBox && customChoice) {
      amountBox.addEventListener("input", function () {
        customChoice.checked = true;
      });
    }
    var monthlyBox = form.querySelector("[data-plexo-monthly]");
    var monthlyOptions = form.querySelector("[data-plexo-monthly-options]");
    if (monthlyBox && monthlyOptions) {
      var syncMonthly = function () {
        monthlyOptions.style.display = monthlyBox.checked ? "flex" : "none";
      };
      monthlyBox.addEventListener("change", syncMonthly);
      syncMonthly();
    }
    var preset = form.querySelector("[data-plexo-amount-minor]:checked");
    if (preset && amountBox) amountBox.value = String(Number(preset.getAttribute("data-plexo-amount-minor")) / 100);

    function errorHere(msg) {
      var box = form.querySelector(".pc-donation-error");
      if (!box) {
        box = el("div", { class: "pc-error pc-donation-error" });
        form.appendChild(box);
      }
      box.textContent = msg;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var chosen = form.querySelector("[data-plexo-amount-minor]:checked, [data-plexo-amount-custom]:checked");
      var amount = 0;
      var customField = form.querySelector("[data-plexo-custom-amount]");
      if (chosen && chosen.hasAttribute("data-plexo-amount-minor")) amount = Number(chosen.getAttribute("data-plexo-amount-minor"));
      else if (customField) amount = Math.round(parseFloat(customField.value || "0") * 100);
      if (!amount || amount <= 0) return errorHere("Please choose or enter an amount.");
      var monthly = form.querySelector("[data-plexo-monthly]");
      var first = form.querySelector("[data-plexo-donor-first]");
      var last = form.querySelector("[data-plexo-donor-last]");
      var full = form.querySelector("[data-plexo-donor-name]");
      var email = form.querySelector("[data-plexo-donor-email]");
      var name = full ? full.value : [first && first.value, last && last.value].filter(Boolean).join(" ");
      if (!email || !email.value) return errorHere("Please enter your email address for your receipt.");
      submitDonation(
        { campaignId: campaignId, amountMinor: amount, frequency: monthly && monthly.checked ? "MONTHLY" : "ONCE", donorName: name, donorEmail: email.value },
        errorHere,
        function (busy) {
          if (!submitBtn) return;
          submitBtn.disabled = busy;
          if (busy) submitBtn.textContent = "Starting payment…";
          else submitBtn.innerHTML = originalLabel;
        }
      );
    }, true);
  }

  function init() {
    injectStyles();
    document.querySelectorAll("[data-plexo-commerce-product]").forEach(renderProduct);
    document.querySelectorAll("[data-plexo-commerce-booking]").forEach(renderBooking);
    document.querySelectorAll("[data-plexo-commerce-shopGrid]").forEach(renderShopGrid);
    document.querySelectorAll("[data-plexo-commerce-cartSummary]").forEach(renderCartSummary);
    document.querySelectorAll("[data-plexo-commerce-checkoutFlow]").forEach(renderCheckoutFlow);
    document.querySelectorAll("[data-plexo-commerce-orderConfirmation]").forEach(renderOrderConfirmation);
    document.querySelectorAll("[data-plexo-commerce-orderTracking]").forEach(renderOrderTracking);
    document.querySelectorAll("[data-plexo-newsletter-signup]").forEach(renderNewsletterSignup);
    document.querySelectorAll("[data-plexo-donation]").forEach(renderDonation);
    renderProductCounts();
    fetchCart().then(broadcastCart).catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

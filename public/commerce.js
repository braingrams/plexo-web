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
 * Styling is deliberately neutral (not Helimax-specific, or any other single site's
 * brand) — this runs on every Commerce-enabled Plexo site. A site-level "Commerce
 * appearance" setting (accent color, font) would be a reasonable fast-follow, mirroring
 * BlogSite.accentColor/fontPreset, but isn't built yet.
 */
(function () {
  "use strict";

  var STYLE_ID = "plexo-commerce-style";
  var CART_EVENT = "plexo:cart-updated";
  var CHECKOUT_STATE_EVENT = "plexo:checkout-state-changed";
  var COURIER_FEE_MINOR = 150000;
  // Shared between the checkout page's two independent marker blocks — checkout_flow
  // (delivery method + contact details + discount code) and cart_summary (the order
  // summary sidebar, which needs the current delivery method to compute the total, and
  // the contact details to actually submit payment). Module-level rather than passed
  // through props since the two markers render into separate DOM nodes with no direct
  // reference to each other — see renderCheckoutFlow/renderCartSummary.
  var checkoutFormState = { deliveryMethod: "PICKUP", customerName: "", customerEmail: "", customerPhone: "", discountCode: "" };

  // ---------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      ".pc-root{font-family:'Public Sans',system-ui,sans-serif;box-sizing:border-box;color:#1B2333;}",
      ".pc-root *{box-sizing:border-box;}",
      ".pc-mono{font-family:'IBM Plex Mono',monospace;}",
      ".pc-serif{font-family:'Fraunces',serif;}",
      ".pc-muted{color:#565F72;}",
      ".pc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#16233F;color:#FBFAF6;border:none;padding:14px 22px;font-size:14.5px;font-weight:600;cursor:pointer;border-radius:2px;font-family:'Public Sans',sans-serif;line-height:1.2;}",
      ".pc-btn:hover{background:#1E2F52;}",
      ".pc-btn:disabled{opacity:0.5;cursor:not-allowed;}",
      ".pc-btn-gold{background:#E3B23C;color:#16233F;}",
      ".pc-btn-gold:hover{background:#F6E7C3;}",
      ".pc-btn-outline{background:transparent;color:#16233F;border:1.5px solid #E4E1D6;}",
      ".pc-btn-outline:hover{background:#F3F1EA;}",
      ".pc-input{width:100%;padding:14px 16px;font-size:14px;border:1px solid #E4E1D6;border-radius:0;font-family:'Public Sans',sans-serif;color:#1B2333;background:#FFFFFF;}",
      ".pc-input:focus{outline:1.5px solid #16233F;outline-offset:-1px;}",
      ".pc-label{display:block;font-size:12.5px;font-weight:600;color:#16233F;margin-bottom:8px;}",
      ".pc-card{background:#FFFFFF;border:1px solid #E4E1D6;border-radius:0;overflow:hidden;}",
      ".pc-error{background:#F3E4E1;border:1px solid #E3B8AE;color:#8C3A2E;padding:10px 14px;border-radius:2px;font-size:13.5px;margin:10px 0;}",
      ".pc-badge{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:9.5px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;padding:4px 8px;border-radius:0;}",
      ".pc-badge-ok{background:#E4F0E7;color:#1F5C3C;}",
      ".pc-badge-low{background:#FBEFD8;color:#8A5A22;}",
      ".pc-badge-out{background:#F3E4E1;color:#8C3A2E;}",
      ".pc-grid{display:grid;gap:24px;}",
      ".pc-select{padding:12px 32px 12px 14px;font-size:13.5px;border:1px solid #E4E1D6;border-radius:0;font-family:'Public Sans',sans-serif;color:#1B2333;background-color:#FFFFFF;appearance:none;-webkit-appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23565F72' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 12px center;}",
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

  function addToCart(productId, quantity) {
    return api("/api/public/commerce/cart/items", { method: "POST", body: JSON.stringify({ productId: productId, quantity: quantity || 1 }) }).then(function (snapshot) {
      broadcastCart(snapshot);
      return snapshot;
    });
  }

  function fetchCart() {
    return api("/api/public/commerce/cart");
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
                    addToCart(p.id, qty)
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
                      addToCart(p.id, 1)
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
                        addToCart(p.id, qty)
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
          el("a", { href: "/shop", style: { color: "#8A93A6", textDecoration: "none" } }, ["Shop"]),
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
                      addToCart(p.id, qty)
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

        var deliveryRow = el("div", { style: { display: "flex", gap: "28px", paddingTop: "8px", borderTop: "1px solid #E4E1D6", marginTop: "4px", flexWrap: "wrap" } }, [
          el("div", { style: { display: "flex", gap: "10px", alignItems: "flex-start", paddingTop: "20px" } }, [
            el("span", { html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#565F72" stroke-width="1.6"><path d="M3 21h18M5 21V9l7-6 7 6v12M9 21v-6h6v6"></path></svg>' }),
            el("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } }, [
              el("span", { style: { fontSize: "13px", fontWeight: "600", color: "#16233F" } }, ["Pickup in Ilorin"]),
              el("span", { class: "pc-muted", style: { fontSize: "12.5px" } }, ["Ready next business day"]),
            ]),
          ]),
          el("div", { style: { display: "flex", gap: "10px", alignItems: "flex-start", paddingTop: "20px" } }, [
            el("span", { html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#565F72" stroke-width="1.6"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z"></path><circle cx="7" cy="19" r="1.6"></circle><circle cx="17.5" cy="19" r="1.6"></circle></svg>' }),
            el("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } }, [
              el("span", { style: { fontSize: "13px", fontWeight: "600", color: "#16233F" } }, ["Courier delivery"]),
              el("span", { class: "pc-muted", style: { fontSize: "12.5px" } }, ["Fee calculated at checkout"]),
            ]),
          ]),
        ]);

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
            el("a", { class: "pc-btn-outline pc-btn", href: "/shop", style: { textDecoration: "none" } }, ["Back to shop"]),
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

    Promise.all([api("/api/public/commerce/products/" + encodeURIComponent(serviceId)), api("/api/public/commerce/availability?productId=" + encodeURIComponent(serviceId))])
      .then(function (results) {
        var product = results[0].product;
        var slots = results[1].slots || [];
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
              confirmBtn.disabled = true;
              confirmBtn.textContent = "Booking…";
              api("/api/public/commerce/checkout", {
                method: "POST",
                body: JSON.stringify({
                  productId: product.id,
                  scheduledStart: selectedSlot.start,
                  customerName: nameInput.value || undefined,
                  customerEmail: emailInput.value,
                  customerPhone: phoneInput.value || undefined,
                }),
              })
                .then(function (result) {
                  window.location.href = result.authorizationUrl;
                })
                .catch(function (err) {
                  confirmBtn.disabled = false;
                  confirmBtn.textContent = "Confirm & Pay — " + money(product.priceMinor, product.currency);
                  errorBox = el("div", { class: "pc-error" }, [err.message]);
                  confirmBtn.parentNode.insertBefore(errorBox, confirmBtn);
                });
            },
          },
          ["Confirm & Pay — " + money(product.priceMinor, product.currency)]
        );

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
    return el("div", { style: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: dark ? "#1E2F52" : "#fff", border: dark ? "1px solid rgba(227,178,60,0.16)" : "1px solid #E4E1D6" } }, [
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
              addToCart(p.id, 1)
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

    function computeTotal(snapshot) {
      return snapshot.subtotalMinor + (checkoutFormState.deliveryMethod === "COURIER" ? COURIER_FEE_MINOR : 0);
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
              el("a", { class: "pc-btn-outline pc-btn", href: "/shop", style: { textDecoration: "none" } }, ["Continue shopping"]),
            ]),
          ])
        );
        return;
      }

      var list = el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        snapshot.items.map(function (item) {
          return el("div", { style: { display: "flex", alignItems: "center", gap: "12px" } }, [
            item.imageUrl
              ? el("img", { src: item.imageUrl, alt: item.name, style: { width: "48px", height: "48px", objectFit: "cover", flexShrink: "0" } })
              : el("div", { style: { width: "48px", height: "48px", background: "#F3F1EA", flexShrink: "0" } }),
            el("div", { style: { flex: "1", minWidth: "0" } }, [
              el("div", { style: { fontSize: "13.5px", fontWeight: "600", color: "#16233F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [item.name]),
              el("div", { class: "pc-mono", style: { fontSize: "11px", color: "#8A93A6", marginTop: "2px" } }, ["Qty " + item.quantity]),
            ]),
            el("div", { style: { fontSize: "13.5px", fontWeight: "600", color: "#16233F", whiteSpace: "nowrap" } }, [money(item.lineTotalMinor, snapshot.currency)]),
          ]);
        })
      );

      var total = computeTotal(snapshot);
      var payBtn;
      var errorBox = null;

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
            payBtn.disabled = true;
            payBtn.textContent = "Starting payment…";
            api("/api/public/commerce/checkout/cart", {
              method: "POST",
              body: JSON.stringify({
                customerName: checkoutFormState.customerName || undefined,
                customerEmail: checkoutFormState.customerEmail,
                customerPhone: checkoutFormState.customerPhone || undefined,
                deliveryMethod: checkoutFormState.deliveryMethod,
                discountCode: checkoutFormState.discountCode || undefined,
              }),
            })
              .then(function (result) {
                window.location.href = result.authorizationUrl;
              })
              .catch(function (err) {
                payBtn.disabled = false;
                payBtn.textContent = "Continue to Payment →";
                errorBox = el("div", { class: "pc-error" }, [err.message]);
                payBtn.parentNode.insertBefore(errorBox, payBtn);
              });
          },
        },
        ["Continue to Payment →"]
      );

      node.appendChild(
        el("div", { class: "pc-card", style: { padding: "24px", display: "flex", flexDirection: "column", gap: "18px" } }, [
          heading,
          list,
          el("div", { style: { display: "flex", flexDirection: "column", gap: "8px", paddingTop: "16px", borderTop: "1px solid #E4E1D6" } }, [
            totalsRow("Subtotal", money(snapshot.subtotalMinor, snapshot.currency)),
            totalsRow("Delivery", checkoutFormState.deliveryMethod === "COURIER" ? money(COURIER_FEE_MINOR, snapshot.currency) : "Free", checkoutFormState.deliveryMethod !== "COURIER"),
          ]),
          el("div", { style: { display: "flex", justifyContent: "space-between", paddingTop: "14px", borderTop: "1px solid #E4E1D6", fontSize: "16px", fontWeight: "700", color: "#16233F" } }, [
            el("span", {}, ["Total"]),
            el("span", {}, [money(total, snapshot.currency)]),
          ]),
          payBtn,
          el("p", { class: "pc-muted", style: { fontSize: "11px", textAlign: "center", margin: "0" } }, ["Secured by Paystack"]),
        ])
      );
    }

    showSpinner(node);
    fetchCart().then(paint).catch(function (err) {
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
    fetchCart()
      .then(function (cart) {
        clear(node);
        prepareNode(node);

        if (!cart.items || cart.items.length === 0) {
          node.appendChild(el("p", { class: "pc-muted", style: { fontSize: "14px" } }, ["Your cart is empty — add something before checking out."]));
          return;
        }

        function deliveryOption(value, label, feeText) {
          var dot;
          var wrap = el(
            "div",
            {
              style: {
                border: "1.5px solid " + (value === checkoutFormState.deliveryMethod ? "#16233F" : "#E4E1D6"),
                padding: "16px 18px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "12px",
                flex: "1",
                minWidth: "180px",
              },
              onclick: function () {
                checkoutFormState.deliveryMethod = value;
                Array.prototype.forEach.call(node.querySelectorAll("[data-pc-delivery-option]"), function (o) {
                  o.style.borderColor = "#E4E1D6";
                  var d = o.querySelector("[data-pc-delivery-dot]");
                  if (d) d.style.background = "transparent";
                });
                wrap.style.borderColor = "#16233F";
                dot.style.background = "#16233F";
                document.dispatchEvent(new CustomEvent(CHECKOUT_STATE_EVENT));
              },
              "data-pc-delivery-option": "true",
            },
            [
              el("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } }, [
                el("span", { style: { fontSize: "13.5px", fontWeight: "600", color: "#16233F" } }, [label]),
                el("span", { class: "pc-muted", style: { fontSize: "12px" } }, [feeText]),
              ]),
              (dot = el("span", {
                "data-pc-delivery-dot": "true",
                style: { width: "16px", height: "16px", borderRadius: "50%", border: "1.5px solid #16233F", background: value === checkoutFormState.deliveryMethod ? "#16233F" : "transparent", flexShrink: "0" },
              })),
            ]
          );
          return wrap;
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

        node.appendChild(
          el("div", { style: { display: "flex", flexDirection: "column", gap: "30px" } }, [
            el("div", {}, [
              el("h3", { style: { margin: "0 0 14px", fontFamily: "'Fraunces', serif", fontWeight: "600", fontSize: "17px", color: "#16233F" } }, ["Delivery method"]),
              el("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap" } }, [
                deliveryOption("PICKUP", "Pickup — Ilorin", "Free"),
                deliveryOption("COURIER", "Courier delivery", "from " + money(COURIER_FEE_MINOR, cart.currency)),
              ]),
            ]),
            el("div", {}, [
              el("h3", { style: { margin: "0 0 14px", fontFamily: "'Fraunces', serif", fontWeight: "600", fontSize: "17px", color: "#16233F" } }, ["Your details"]),
              el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } }, [
                el("div", { style: { display: "flex", gap: "14px", flexWrap: "wrap" } }, [
                  el("div", { style: { flex: "1", minWidth: "180px" } }, [field("Full name", "text", "customerName")]),
                  el("div", { style: { flex: "1", minWidth: "180px" } }, [field("Phone number", "tel", "customerPhone")]),
                ]),
                field("Email", "email", "customerEmail"),
              ]),
            ]),
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
            ]),
          ])
        );
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
        node.appendChild(
          el("div", { class: "pc-card", style: { padding: "28px", display: "flex", flexDirection: "column", gap: "18px" } }, [
            el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, [
              el("span", { style: { background: "#16233F", color: "#fff", fontSize: "11px", fontWeight: "700", padding: "5px 10px", borderRadius: "3px", letterSpacing: "0.04em" } }, [order.orderNumber]),
              el("span", { class: "pc-badge " + (order.status === "PAID" ? "pc-badge-ok" : order.status === "PENDING" ? "pc-badge-low" : "pc-badge-out") }, [order.status]),
            ]),
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
          if (order.status !== "PAID") {
            resultBox.appendChild(el("div", { class: "pc-error", style: { background: "#FBEFD8", borderColor: "#fde68a", color: "#92400e" } }, ["This order hasn't been paid for yet."]));
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
    renderProductCounts();
    fetchCart().then(broadcastCart).catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

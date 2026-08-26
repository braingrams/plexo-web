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
      ".pc-spin{width:22px;height:22px;border-radius:50%;border:2.5px solid #E4E1D6;border-top-color:#16233F;animation:pc-spin 0.7s linear infinite;}",
      "@keyframes pc-spin{to{transform:rotate(360deg);}}",
      ".pc-pill{display:inline-flex;align-items:center;padding:9px 18px;border-radius:100px;font-size:13px;font-weight:500;border:1px solid #E4E1D6;background:#fff;color:#3C4356;cursor:pointer;}",
      ".pc-pill.active{background:#16233F;color:#FBFAF6;border-color:#16233F;font-weight:600;}",
      ".pc-slot{text-align:center;padding:8px 0;border:1.5px solid #E4E1D6;border-radius:0;font-family:'IBM Plex Mono',monospace;font-size:10.5px;cursor:pointer;background:#fff;color:#16233F;}",
      ".pc-slot:hover{border-color:#E3B23C;}",
      ".pc-slot.active{background:#E3B23C;color:#16233F;border-color:#E3B23C;font-weight:600;}",
      ".pc-slot[disabled]{opacity:0.35;cursor:not-allowed;}",
    ].join("\n");
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
                        setTimeout(function () {
                          addBtn.textContent = "Add to Cart — " + money(p.priceMinor * qty, p.currency);
                          addBtn.disabled = false;
                        }, 1400);
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
                          setTimeout(function () {
                            addBtn.textContent = "Add to Cart";
                            addBtn.disabled = p.stockQuantity === 0;
                          }, 1400);
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
                            setTimeout(function () {
                              addBtn.textContent = "Add to Cart";
                              addBtn.disabled = false;
                            }, 1400);
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

  function renderShopGrid(node) {
    showSpinner(node);
    api("/api/public/commerce/products")
      .then(function (data) {
        var allProducts = (data.products || []).filter(function (p) {
          return p.kind === "PHYSICAL";
        });
        var categories = data.categories || [];
        var activeCategory = null;
        var searchTerm = "";

        clear(node);
        prepareNode(node);

        var grid = el("div", { class: "pc-grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } });

        function renderCards() {
          clear(grid);
          var filtered = allProducts.filter(function (p) {
            var matchesCategory = !activeCategory || (p.category && p.category.slug === activeCategory);
            var matchesSearch = !searchTerm || p.name.toLowerCase().indexOf(searchTerm.toLowerCase()) !== -1;
            return matchesCategory && matchesSearch;
          });
          if (filtered.length === 0) {
            grid.appendChild(el("p", { class: "pc-muted", style: { gridColumn: "1 / -1" } }, ["No products match — try a different filter."]));
            return;
          }
          filtered.forEach(function (p) {
            var addBtn;
            grid.appendChild(
              el("div", { class: "pc-card", style: { display: "flex", flexDirection: "column" } }, [
                p.imageUrl
                  ? el("img", { src: p.imageUrl, alt: p.name, style: { width: "100%", height: "160px", objectFit: "cover", display: "block" } })
                  : el("div", { style: { width: "100%", height: "160px", background: "#F3F1EA", display: "flex", alignItems: "center", justifyContent: "center", color: "#8A93A6", fontSize: "13px" } }, [p.name]),
                el("div", { style: { padding: "14px", display: "flex", flexDirection: "column", gap: "8px", flex: "1" } }, [
                  el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" } }, [
                    el("span", { style: { fontSize: "14px", fontWeight: "600", color: "#16233F" } }, [p.name]),
                    stockBadge(p.stockQuantity),
                  ]),
                  el("div", { style: { fontSize: "14.5px", fontWeight: "700", color: "#16233F", marginTop: "auto" } }, [money(p.priceMinor, p.currency)]),
                  (addBtn = el(
                    "button",
                    {
                      class: "pc-btn",
                      style: { width: "100%", fontSize: "13px", padding: "9px 14px" },
                      disabled: p.stockQuantity === 0 ? "disabled" : null,
                      onclick: function () {
                        addBtn.disabled = true;
                        addBtn.textContent = "Adding…";
                        addToCart(p.id, 1)
                          .then(function () {
                            addBtn.textContent = "Added ✓";
                            setTimeout(function () {
                              addBtn.textContent = "Add to Cart";
                              addBtn.disabled = p.stockQuantity === 0;
                            }, 1400);
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
              ])
            );
          });
        }

        var controls = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px", marginBottom: "20px" } });
        if (categories.length > 0) {
          var pillRow = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } });
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
                renderCards();
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
                  renderCards();
                },
              },
              [cat.name]
            );
            pillRow.appendChild(pill);
          });
          controls.appendChild(pillRow);
        }
        controls.appendChild(
          el("input", {
            class: "pc-input",
            placeholder: "Search products…",
            style: { maxWidth: "320px" },
            oninput: function (e) {
              searchTerm = e.target.value;
              renderCards();
            },
          })
        );

        node.appendChild(controls);
        node.appendChild(grid);
        renderCards();
      })
      .catch(function (err) {
        showError(node, err.message);
      });
  }

  // ---------------------------------------------------------------------
  // cart_summary — line items, quantities, subtotal
  // ---------------------------------------------------------------------

  function renderCartSummary(node) {
    function paint(snapshot) {
      clear(node);
      prepareNode(node);
      if (!snapshot.items || snapshot.items.length === 0) {
        node.appendChild(
          el("div", { style: { padding: "40px 20px", textAlign: "center", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" } }, [
            el("p", { class: "pc-muted", style: { margin: "0", fontSize: "14px" } }, ["Your cart is empty."]),
            el("a", { class: "pc-btn-outline pc-btn", href: "#", onclick: function (e) { e.preventDefault(); history.back(); } }, ["Continue shopping"]),
          ])
        );
        return;
      }
      var list = el(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        snapshot.items.map(function (item) {
          var qtyLabel;
          return el("div", { style: { display: "flex", alignItems: "center", gap: "14px", padding: "16px 0", borderBottom: "1px solid #E4E1D6" } }, [
            item.imageUrl
              ? el("img", { src: item.imageUrl, alt: item.name, style: { width: "56px", height: "56px", objectFit: "cover", borderRadius: "4px", flexShrink: "0" } })
              : el("div", { style: { width: "56px", height: "56px", background: "#F3F1EA", borderRadius: "4px", flexShrink: "0" } }),
            el("div", { style: { flex: "1", minWidth: "0" } }, [
              el("div", { style: { fontSize: "14px", fontWeight: "600", color: "#16233F" } }, [item.name]),
              !item.inStock ? el("div", { style: { fontSize: "12px", color: "#8C3A2E" } }, ["No longer in stock"]) : null,
              el("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" } }, [
                el(
                  "button",
                  {
                    class: "pc-btn-outline",
                    style: { width: "26px", height: "26px", padding: "0", fontSize: "13px" },
                    onclick: function () {
                      updateQty(item.itemId, item.quantity - 1).then(paint);
                    },
                  },
                  ["–"]
                ),
                (qtyLabel = el("span", { style: { fontSize: "13px", minWidth: "18px", textAlign: "center" } }, [String(item.quantity)])),
                el(
                  "button",
                  {
                    class: "pc-btn-outline",
                    style: { width: "26px", height: "26px", padding: "0", fontSize: "13px" },
                    onclick: function () {
                      updateQty(item.itemId, item.quantity + 1).then(paint);
                    },
                  },
                  ["+"]
                ),
                el(
                  "button",
                  {
                    style: { background: "none", border: "none", color: "#8A93A6", fontSize: "12px", cursor: "pointer", marginLeft: "8px", textDecoration: "underline" },
                    onclick: function () {
                      updateQty(item.itemId, 0).then(paint);
                    },
                  },
                  ["Remove"]
                ),
              ]),
            ]),
            el("div", { style: { fontSize: "14px", fontWeight: "600", color: "#16233F", whiteSpace: "nowrap" } }, [money(item.lineTotalMinor, snapshot.currency)]),
          ]);
        })
      );
      node.appendChild(list);
      node.appendChild(
        el("div", { style: { display: "flex", justifyContent: "space-between", padding: "18px 0 0", fontSize: "16px", fontWeight: "700", color: "#16233F" } }, [el("span", {}, ["Subtotal"]), el("span", {}, [money(snapshot.subtotalMinor, snapshot.currency)])])
      );
    }

    function updateQty(itemId, quantity) {
      return api("/api/public/commerce/cart/items/" + encodeURIComponent(itemId), { method: "PATCH", body: JSON.stringify({ quantity: quantity }) }).then(function (snapshot) {
        broadcastCart(snapshot);
        return snapshot;
      });
    }

    showSpinner(node);
    fetchCart().then(paint).catch(function (err) {
      showError(node, err.message);
    });
    document.addEventListener(CART_EVENT, function (e) {
      paint(e.detail);
    });
  }

  // ---------------------------------------------------------------------
  // checkout_flow — delivery, contact, discount, pay
  // ---------------------------------------------------------------------

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

        var deliveryMethod = "PICKUP";
        var COURIER_FEE_MINOR = 150000;
        var errorBox = null;
        var payBtn, totalLabel;

        function computeTotal() {
          return cart.subtotalMinor + (deliveryMethod === "COURIER" ? COURIER_FEE_MINOR : 0);
        }
        function refreshTotal() {
          totalLabel.textContent = money(computeTotal(), cart.currency);
          payBtn.textContent = "Pay with Paystack — " + money(computeTotal(), cart.currency);
        }

        function deliveryOption(value, label, feeText) {
          var wrap = el(
            "div",
            {
              style: { border: "1.5px solid " + (value === deliveryMethod ? "#16233F" : "#E4E1D6"), borderRadius: "4px", padding: "14px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" },
              onclick: function () {
                deliveryMethod = value;
                Array.prototype.forEach.call(node.querySelectorAll("[data-pc-delivery-option]"), function (o) {
                  o.style.borderColor = "#E4E1D6";
                });
                wrap.style.borderColor = "#16233F";
                refreshTotal();
              },
              "data-pc-delivery-option": "true",
            },
            [el("span", { style: { fontSize: "13.5px", fontWeight: "600", color: "#16233F" } }, [label]), el("span", { class: "pc-muted", style: { fontSize: "12px" } }, [feeText])]
          );
          return wrap;
        }

        function field(label, type) {
          var input = el("input", { class: "pc-input", type: type || "text" });
          return { wrap: el("div", {}, [el("label", { class: "pc-label" }, [label]), input]), input: input };
        }
        var nameField = field("Full name");
        var emailField = field("Email", "email");
        var phoneField = field("Phone");
        var discountField = field("Discount code (optional)");

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
              if (!emailField.input.value || emailField.input.value.indexOf("@") === -1) {
                errorBox = el("div", { class: "pc-error" }, ["Please enter a valid email."]);
                payBtn.parentNode.insertBefore(errorBox, payBtn);
                return;
              }
              payBtn.disabled = true;
              payBtn.textContent = "Starting payment…";
              api("/api/public/commerce/checkout/cart", {
                method: "POST",
                body: JSON.stringify({
                  customerName: nameField.input.value || undefined,
                  customerEmail: emailField.input.value,
                  customerPhone: phoneField.input.value || undefined,
                  deliveryMethod: deliveryMethod,
                  discountCode: discountField.input.value || undefined,
                }),
              })
                .then(function (result) {
                  window.location.href = result.authorizationUrl;
                })
                .catch(function (err) {
                  payBtn.disabled = false;
                  refreshTotal();
                  errorBox = el("div", { class: "pc-error" }, [err.message]);
                  payBtn.parentNode.insertBefore(errorBox, payBtn);
                });
            },
          },
          ["Pay with Paystack"]
        );

        node.appendChild(
          el("div", { style: { display: "flex", flexDirection: "column", gap: "22px" } }, [
            el("div", {}, [
              el("div", { class: "pc-label", style: { marginBottom: "10px" } }, ["Delivery"]),
              el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } }, [deliveryOption("PICKUP", "Pickup", "Free"), deliveryOption("COURIER", "Courier delivery", "from " + money(COURIER_FEE_MINOR, cart.currency))]),
            ]),
            nameField.wrap,
            emailField.wrap,
            phoneField.wrap,
            discountField.wrap,
            el("div", { style: { height: "1px", background: "#E4E1D6" } }),
            el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: "700", color: "#16233F" } }, [el("span", {}, ["Total"]), (totalLabel = el("span", {}, [money(computeTotal(), cart.currency)]))]),
            payBtn,
            el("p", { class: "pc-muted", style: { fontSize: "11px", textAlign: "center", margin: "0" } }, ["Secured by Paystack"]),
          ])
        );
        refreshTotal();
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
    renderProductCounts();
    fetchCart().then(broadcastCart).catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

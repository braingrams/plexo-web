/*!
 * Plexo content widget runtime.
 *
 * Shows content a site owner posts in Plexo (videos, stories, events, anything from Content Types)
 * wherever a page has a marker:
 *
 *   <div data-plexo-content="videos" data-plexo-content-layout="gallery"></div>
 *
 * Attributes: data-plexo-content (the content type's slug), data-plexo-content-layout
 * (gallery | stories | events | featured | list), data-plexo-content-limit, data-plexo-content-columns.
 *
 * Works the same in the visual builder (an HTML block / the Content block), a raw HTML upload and a
 * React project: it finds markers now and as they appear later (single-page apps render after load).
 * Plain vanilla JS — published HTML never carries its own <script>, so this file is the only place
 * the behaviour can live. Inherits the page's fonts and text colour; every class is `plx-c-*` so a
 * site's own CSS can restyle anything.
 *
 * Fields it reads (the Videos / Stories / Happenings quick-starts create these): title, description,
 * video, image, body, author, date, location, link.
 */
(function () {
  "use strict";
  if (window.__plexoContentLoaded) return;
  window.__plexoContentLoaded = true;

  var STYLE_ID = "plexo-content-style";
  var MOUNTED = "data-plexo-content-mounted";

  // The styles live in plexo-content.css (the server links it in the page's <head> so server-rendered
  // content is styled before this script runs); add the link ourselves where nothing did (React apps).
  function injectStyles() {
    if (document.getElementById(STYLE_ID) || document.querySelector('link[href*="plexo-content.css"]')) return;
    var link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = "/plexo-content.css";
    document.head.appendChild(link);
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  // Only http(s) and same-site paths may become links/images — never javascript: or data:.
  function safeUrl(u) {
    u = str(u);
    return /^(https?:\/\/|\/(?!\/))/i.test(u) ? u : "";
  }

  function parseVideo(url) {
    url = safeUrl(url);
    if (!url) return null;
    var m;
    if ((m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i))) {
      return { kind: "youtube", id: m[1], embed: "https://www.youtube-nocookie.com/embed/" + m[1] + "?autoplay=1&rel=0", thumb: "https://i.ytimg.com/vi/" + m[1] + "/hqdefault.jpg" };
    }
    if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i))) {
      return { kind: "vimeo", id: m[1], embed: "https://player.vimeo.com/video/" + m[1] + "?autoplay=1", thumb: "" };
    }
    if (/\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(url)) return { kind: "file", embed: url, thumb: "" };
    return { kind: "link", embed: url, thumb: "" };
  }

  // "2026-10-30T18:00" (no zone → the visitor's local time) or "2026-10-30".
  function parseDate(v) {
    v = str(v);
    if (!v) return null;
    var d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T23:59:59") : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function timeLabel(v, d) {
    if (!/T\d{2}:\d{2}/.test(str(v))) return "";
    try { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; }
  }

  function mediaFor(item) {
    var video = parseVideo(item.video);
    var img = safeUrl(item.image) || (video && video.thumb) || "";
    return { video: video, img: img };
  }
  function mediaHtml(item, m) {
    var inner = m.img ? '<img src="' + esc(m.img) + '" alt="' + esc(item.title) + '" loading="lazy">' : "";
    var cls = "plx-c-media" + (m.img ? "" : " plx-c-media--empty");
    return '<div class="' + cls + '">' + inner + (m.video ? '<span class="plx-c-play"></span>' : "") + "</div>";
  }

  // Stories are written as plain paragraphs; escape everything, never trust stored HTML.
  function bodyHtml(text) {
    var plain = str(text).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]*>/g, "");
    return plain.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
  }

  // ---------- modal ----------
  var openModal = null;
  function closeModal() {
    if (!openModal) return;
    document.removeEventListener("keydown", openModal.onKey, true);
    document.body.style.overflow = openModal.prevOverflow;
    openModal.el.remove();
    var back = openModal.returnTo;
    openModal = null;
    if (back && back.focus) back.focus();
  }
  function showModal(inner, returnTo) {
    closeModal();
    var el = document.createElement("div");
    el.className = "plx-c-modal plx-c";
    el.innerHTML = '<div class="plx-c-dialog" role="dialog" aria-modal="true"><button type="button" class="plx-c-close" aria-label="Close">&times;</button>' + inner + "</div>";
    var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); closeModal(); } };
    openModal = { el: el, onKey: onKey, prevOverflow: document.body.style.overflow, returnTo: returnTo };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey, true);
    el.addEventListener("click", function (e) { if (e.target === el || (e.target.closest && e.target.closest(".plx-c-close"))) closeModal(); });
    document.body.appendChild(el);
    var btn = el.querySelector(".plx-c-close");
    if (btn) btn.focus();
  }
  function playerHtml(video) {
    if (!video) return "";
    if (video.kind === "file") return '<div class="plx-c-frame"><video src="' + esc(video.embed) + '" controls autoplay playsinline></video></div>';
    if (video.kind === "link") return "";
    return '<div class="plx-c-frame"><iframe src="' + esc(video.embed) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Video"></iframe></div>';
  }

  function openItem(item, layout, returnTo) {
    var m = mediaFor(item);
    var title = esc(item.title);
    var player = playerHtml(m.video);
    var top = player || (m.img && layout !== "gallery" ? '<img class="plx-c-hero" src="' + esc(m.img) + '" alt="' + title + '">' : "");
    var linkOut = m.video && m.video.kind === "link" ? '<p><a class="plx-c-btn" href="' + esc(m.video.embed) + '" target="_blank" rel="noopener noreferrer">Watch video</a></p>' : "";
    var text = layout === "gallery" ? bodyHtml(item.description) : bodyHtml(item.body) || bodyHtml(item.description);
    var meta = str(item.author) ? '<p class="plx-c-meta">Shared by ' + esc(item.author) + "</p>" : "";
    showModal(top + '<div class="plx-c-body"><h2>' + title + "</h2>" + meta + text + linkOut + "</div>", returnTo);
  }

  // ---------- layouts ----------
  function card(item, i, layout) {
    var m = mediaFor(item);
    var isStory = layout === "stories";
    var desc = str(item.description);
    return '<button type="button" class="plx-c-card" data-i="' + i + '">' + mediaHtml(item, m) +
      '<div class="plx-c-body"><h3 class="plx-c-title">' + esc(item.title) + "</h3>" +
      (isStory && str(item.author) ? '<p class="plx-c-meta">Shared by ' + esc(item.author) + "</p>" : "") +
      (desc ? '<p class="plx-c-desc">' + esc(desc) + "</p>" : "") +
      (isStory ? '<span class="plx-c-more">Read story</span>' : "") + "</div></button>";
  }

  function renderGrid(root, items, layout, cols) {
    root.innerHTML = '<div class="plx-c-grid" style="--plx-c-cols:' + cols + '">' + items.map(function (it, i) { return card(it, i, layout); }).join("") + "</div>";
  }

  function renderFeatured(root, items) {
    var it = items[0], m = mediaFor(it), desc = str(it.description);
    root.innerHTML = '<div class="plx-c-feature"><button type="button" class="plx-c-media' + (m.img ? "" : " plx-c-media--empty") + '" data-i="0" aria-label="Open ' + esc(it.title) + '">' +
      (m.img ? '<img src="' + esc(m.img) + '" alt="' + esc(it.title) + '">' : "") + (m.video ? '<span class="plx-c-play"></span>' : "") + "</button>" +
      '<div><h3 class="plx-c-title">' + esc(it.title) + "</h3>" + (desc ? '<p class="plx-c-desc">' + esc(desc) + "</p>" : "") +
      '<span class="plx-c-rule"></span><button type="button" class="plx-c-link" data-i="0">' + (m.video ? "Watch Now" : "Read more") + " &nbsp;&rarr;</button></div></div>";
  }

  function renderEvents(root, items) {
    root.innerHTML = '<div class="plx-c-events">' + items.map(function (it, i) {
      var d = parseDate(it.date), t = d ? timeLabel(it.date, d) : "", link = safeUrl(it.link), loc = str(it.location), desc = str(it.description), img = safeUrl(it.image);
      var meta = [d ? d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "", t, loc].filter(Boolean).join(" · ");
      return '<article class="plx-c-event"><div class="plx-c-date">' + (d ? "<span>" + MONTHS[d.getMonth()] + "</span><b>" + d.getDate() + "</b>" : "<b>&bull;</b>") + "</div>" +
        '<div><h3 class="plx-c-title">' + esc(it.title) + "</h3>" + (meta ? '<p class="plx-c-meta">' + esc(meta) + "</p>" : "") +
        (desc ? '<p class="plx-c-desc" style="-webkit-line-clamp:unset;display:block">' + esc(desc) + "</p>" : "") +
        (img ? '<img class="plx-c-event-img" src="' + esc(img) + '" alt="' + esc(it.title) + '" loading="lazy">' : "") + "</div>" +
        (link ? '<div class="plx-c-event-cta"><a class="plx-c-btn" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Learn more</a></div>' : "") + "</article>";
    }).join("") + "</div>";
  }

  function renderList(root, items) {
    root.innerHTML = '<ul class="plx-c-list">' + items.map(function (it) {
      var desc = str(it.description);
      return "<li><strong>" + esc(it.title) + "</strong>" + (desc ? '<p class="plx-c-desc">' + esc(desc) + "</p>" : "") + "</li>";
    }).join("") + "</ul>";
  }

  var LAYOUTS = ["gallery", "stories", "events", "featured", "list", "posts"];

  // What an empty section says: what it is, and that it fills itself. Mirrored in lib/customContent/render.ts (emptyTextFor).
  function emptyText(slug, layout) {
    var s = String(slug || "").toLowerCase();
    if (s === "blog" || layout === "posts") return "No posts yet. They'll appear here as soon as they're published.";
    if (/video|gallery|watch/.test(s) || layout === "gallery") return "No videos yet. They'll appear here as soon as they're added.";
    if (/stor/.test(s) || layout === "stories") return "No stories yet. They'll appear here as soon as they're shared.";
    if (/event|happening|workshop|webinar/.test(s) || layout === "events") return "No upcoming events right now. They'll appear here as soon as they're scheduled.";
    return "Nothing here yet. It will appear here as soon as it's added.";
  }

  function renderPosts(root, items, cols) {
    root.innerHTML = '<div class="plx-c-grid" style="--plx-c-cols:' + cols + '">' + items.map(function (it) {
      var link = safeUrl(it.link), img = safeUrl(it.image), date = str(it.dateLabel), alt = str(it.imageAlt) || it.title;
      return '<a class="plx-c-card plx-c-post" href="' + esc(link || "/blog") + '"><div class="plx-c-media' + (img ? "" : " plx-c-media--empty") + '">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(alt) + '" loading="lazy">' : "") + "</div>" +
        '<div class="plx-c-body"><h3 class="plx-c-title">' + esc(it.title) + "</h3>" + (date ? '<p class="plx-c-meta">' + esc(date) + "</p>" : "") + "</div></a>";
    }).join("") + "</div>";
  }

  function normalize(entry) {
    var o = {};
    for (var k in entry) if (Object.prototype.hasOwnProperty.call(entry, k)) o[k] = entry[k];
    o.title = str(o.title) || str(o.name) || "Untitled";
    return o;
  }

  function mount(root) {
    if (root.getAttribute(MOUNTED)) return;
    root.setAttribute(MOUNTED, "1");
    var slug = str(root.getAttribute("data-plexo-content"));
    if (!slug) return;
    var layout = str(root.getAttribute("data-plexo-content-layout")) || "gallery";
    if (LAYOUTS.indexOf(layout) === -1) layout = "list";
    var limit = parseInt(root.getAttribute("data-plexo-content-limit"), 10);
    var cols = Math.min(4, Math.max(1, parseInt(root.getAttribute("data-plexo-content-columns"), 10) || 3));
    root.classList.add("plx-c");
    // Server-rendered content (what search engines read) stays on screen until the live copy arrives.
    if (!root.hasAttribute("data-plexo-content-ssr")) root.innerHTML = '<div class="plx-c-grid" style="--plx-c-cols:' + cols + '"><div class="plx-c-skel"></div><div class="plx-c-skel"></div><div class="plx-c-skel"></div></div>';

    fetch("/api/public/content/" + encodeURIComponent(location.hostname) + "/" + encodeURIComponent(slug) + "?limit=200")
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        var items = (data.entries || []).map(normalize);
        if (layout === "events") {
          var now = Date.now();
          items = items.filter(function (it) { var d = parseDate(it.date); return !d || d.getTime() >= now - 3600 * 1000; });
          items.sort(function (a, b) {
            var da = parseDate(a.date), db = parseDate(b.date);
            return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
          });
        }
        if (limit > 0) items = items.slice(0, limit);
        if (!items.length) { root.innerHTML = '<div class="plx-c-empty">' + esc(emptyText(slug, layout)) + "</div>"; return; }
        if (layout === "events") renderEvents(root, items);
        else if (layout === "featured") renderFeatured(root, items);
        else if (layout === "list") renderList(root, items);
        else if (layout === "posts") renderPosts(root, items, cols);
        else renderGrid(root, items, layout, cols);

        if (layout === "events" || layout === "list" || layout === "posts") return;
        root.addEventListener("click", function (e) {
          var t = e.target.closest && e.target.closest("[data-i]");
          if (!t || !root.contains(t)) return;
          var item = items[parseInt(t.getAttribute("data-i"), 10)];
          if (item) openItem(item, layout, t);
        });
      })
      .catch(function () {
        root.innerHTML = '<div class="plx-c-empty">This section isn\'t available right now. Please try again in a moment.</div>';
      });
  }

  function scan(node) {
    var scope = node && node.querySelectorAll ? node : document;
    if (scope.matches && scope.matches("[data-plexo-content]")) mount(scope);
    var found = scope.querySelectorAll("[data-plexo-content]");
    for (var i = 0; i < found.length; i++) mount(found[i]);
  }

  function start() {
    injectStyles();
    scan(document);
    // React / single-page apps add markers after load.
    if (window.MutationObserver) {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          for (var j = 0; j < muts[i].addedNodes.length; j++) {
            var n = muts[i].addedNodes[j];
            if (n.nodeType === 1) scan(n);
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

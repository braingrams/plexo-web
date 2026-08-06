export interface ApprovedComment {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date;
  parentId: string | null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function renderCommentNode(comment: ApprovedComment, replies: ApprovedComment[]): string {
  // comment.body is already HTML-escaped at write time (lib/blog/sanitizeComment.ts) — safe
  // to embed verbatim. authorName is NOT (only ever HTML-escaped, not stripped, at write
  // time) — escaped here at render time instead.
  const childrenHtml = replies
    .map((r) => `<div class="plexo-comment plexo-comment--reply">${renderCommentBody(r)}</div>`)
    .join("");
  return `<div class="plexo-comment">${renderCommentBody(comment)}${childrenHtml}</div>`;
}

function renderCommentBody(comment: ApprovedComment): string {
  return `
    <div class="plexo-comment__meta"><strong>${escapeHtml(comment.authorName)}</strong> · ${formatDate(comment.createdAt)}</div>
    <div class="plexo-comment__body">${comment.body}</div>
    <button type="button" class="plexo-comment__reply-btn" data-plexo-reply-to="${comment.id}" data-plexo-reply-name="${escapeHtml(comment.authorName)}">Reply</button>
  `;
}

/**
 * Plain HTML + one small inline <script> — not a React component. This gets embedded via
 * dangerouslySetInnerHTML in both the default theme (app/pub/[domain]/blog/[...slug]/page.tsx)
 * and a custom layout's Comments marker (lib/pub/blogLayoutRender.ts) — content injected
 * that way never hydrates, so a React client component's event handlers would silently do
 * nothing. Vanilla JS is the only thing that actually works in both places, so building it
 * once here (rather than a React version for one path and this for the other) keeps the two
 * from drifting apart.
 */
export function renderCommentsSection(input: {
  domain: string;
  slug: string;
  comments: ApprovedComment[];
  commentsEnabled: boolean;
}): string {
  const topLevel = input.comments.filter((c) => !c.parentId);
  const repliesByParent = new Map<string, ApprovedComment[]>();
  for (const c of input.comments) {
    if (!c.parentId) continue;
    const list = repliesByParent.get(c.parentId) ?? [];
    list.push(c);
    repliesByParent.set(c.parentId, list);
  }

  const listHtml = topLevel.length
    ? topLevel.map((c) => renderCommentNode(c, repliesByParent.get(c.id) ?? [])).join("")
    : `<p class="plexo-comments__empty">No comments yet.</p>`;

  const formHtml = input.commentsEnabled
    ? `
    <form class="plexo-comment-form" data-plexo-comment-form data-domain="${escapeHtml(input.domain)}" data-slug="${escapeHtml(input.slug)}">
      <p class="plexo-comment-form__replying-to" data-plexo-replying-to hidden>Replying to <strong data-plexo-replying-to-name></strong> — <button type="button" data-plexo-cancel-reply>cancel</button></p>
      <input type="hidden" name="parentId" data-plexo-parent-id value="" />
      <div class="plexo-comment-form__hp" aria-hidden="true"><label>Leave blank<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
      <div class="plexo-comment-form__row">
        <input type="text" name="name" placeholder="Name" required maxlength="100" />
        <input type="email" name="email" placeholder="Email (not published)" required maxlength="200" />
      </div>
      <textarea name="body" placeholder="Write a comment…" required rows="4" maxlength="3000"></textarea>
      <button type="submit">Post Comment</button>
      <p class="plexo-comment-form__status" data-plexo-comment-status></p>
    </form>`
    : `<p class="plexo-comments__empty">Comments are closed.</p>`;

  return `
    <section class="plexo-comments" id="comments">
      <h2 class="plexo-comments__heading">Comments</h2>
      <div class="plexo-comments__list">${listHtml}</div>
      ${formHtml}
    </section>
    <script>
    (function () {
      var section = document.currentScript.previousElementSibling;
      var form = section ? section.querySelector('[data-plexo-comment-form]') : null;
      if (!form || form.dataset.plexoBound) return;
      form.dataset.plexoBound = "true";
      section.querySelectorAll('[data-plexo-reply-to]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          form.querySelector('[data-plexo-parent-id]').value = btn.getAttribute('data-plexo-reply-to');
          var banner = form.querySelector('[data-plexo-replying-to]');
          banner.hidden = false;
          banner.querySelector('[data-plexo-replying-to-name]').textContent = btn.getAttribute('data-plexo-reply-name');
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      var cancelBtn = form.querySelector('[data-plexo-cancel-reply]');
      if (cancelBtn) cancelBtn.addEventListener('click', function () {
        form.querySelector('[data-plexo-parent-id]').value = '';
        form.querySelector('[data-plexo-replying-to]').hidden = true;
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var status = form.querySelector('[data-plexo-comment-status]');
        var fd = new FormData(form);
        status.textContent = 'Posting…';
        fetch('/api/blog-comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: form.dataset.domain,
            slug: form.dataset.slug,
            name: fd.get('name'),
            email: fd.get('email'),
            body: fd.get('body'),
            parentId: fd.get('parentId') || undefined,
            website: fd.get('website'),
          }),
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (r) {
            if (!r.ok) { status.textContent = r.data.error || 'Something went wrong.'; return; }
            status.textContent = 'Thanks! Your comment is awaiting review.';
            form.reset();
          })
          .catch(function () { status.textContent = 'Something went wrong.'; });
      });
    })();
    </script>
  `;
}

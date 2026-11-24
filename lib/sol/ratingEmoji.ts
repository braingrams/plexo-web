// Which emoji mean "good answer" and which mean "bad answer": used for WhatsApp reactions,
// and for a message that is nothing but those emoji (WhatsApp and the dashboard chat).

// Compared without skin tones and the invisible variation selector, so 👍🏽 and ❤ and ❤️ all match.
const LIKE_EMOJI = "👍 👌 👏 🙌 🤝 💪 ✌ 🤞 🫶 🙏 🫡 🤌 👊 🤙 ❤ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 💖 💗 💓 💕 💞 💘 💝 💟 ♥ ❣ 😀 😃 😄 😁 😆 😊 🙂 ☺ 😉 😍 🥰 😘 😗 😙 😚 😻 😽 🤩 🥳 😎 🤗 😇 😋 😌 😂 🤣 😺 😸 😹 🔥 💯 ✅ ✔ ☑ ⭐ 🌟 🎉 🎊 🏆 🥇 🏅 👑 🚀 💐 🌹 🌸 💎 🙇 🥂 🍾 😅".split(" ");
const DISLIKE_EMOJI = "👎 😡 😠 🤬 😤 😒 🙄 😞 😕 😟 😔 😣 😖 😫 😩 😢 😿 🥺 😑 😐 😶 😬 🤦 🤨 🧐 💔 ❌ ✖ ✘ ❎ 🚫 ⛔ 🙅 😾 👿 😈 💩 🤮 🤢 😱 😨 😰 😧 🥴 😵 🫤 🤥 🙁 ☹ 😓 😪 😮‍💨 🥱 😴 🤡 👺 💢 🛑 ⚠ 🆘".split(" ");

const normalise = (e: string) => e.replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, "").trim();
const LIKE = new Set(LIKE_EMOJI.map(normalise));
const DISLIKE = new Set(DISLIKE_EMOJI.map(normalise));

/** UP for a liking emoji, DOWN for a disliking one, null for anything else (or a reaction taken off). */
export function ratingForReaction(emoji: string | null | undefined): "UP" | "DOWN" | null {
  const e = normalise(emoji ?? "");
  if (!e) return null;
  if (LIKE.has(e)) return "UP";
  if (DISLIKE.has(e)) return "DOWN";
  return null;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/**
 * A message made only of rating emoji ("❤️", "👍👍", "👎") is a rating, not a request.
 * Anything with words, a mix of up and down, or other emoji is a normal message (null).
 */
export function ratingForEmojiMessage(text: string | null | undefined): "UP" | "DOWN" | null {
  const t = (text ?? "").replace(/\s+/g, "");
  if (!t || t.length > 24) return null;
  const parts = segmenter ? [...segmenter.segment(t)].map((s) => s.segment) : [...t];
  const ratings = new Set(parts.map((p) => ratingForReaction(p)));
  if (ratings.size !== 1) return null;
  const only = [...ratings][0];
  return only ?? null;
}

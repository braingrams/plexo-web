"use client";

export function V2TaglineReveal({ isDark }: { isDark: boolean }) {
  const muted = isDark ? "text-white/35" : "text-slate-950/30";
  const highlight = "font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400";

  return (
    <div
      className={`py-7 sm:py-8 px-4 text-center transition-colors duration-500 font-['Mulish',sans-serif] ${
        isDark ? "bg-[#0b0f19]" : "bg-white"
      }`}
    >
      <p className={`text-xs sm:text-sm font-bold uppercase tracking-[0.25em] ${muted}`}>
        com<span className={highlight}>plex</span> made <span className={highlight}>xo</span> easy
      </p>
    </div>
  );
}

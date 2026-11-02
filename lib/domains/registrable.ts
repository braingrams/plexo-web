// Which part of a domain name is the "zone" a registrar manages. DNS record names at GoDaddy, Namecheap,
// Cloudflare and the rest are entered RELATIVE to that zone: for www.example.com the zone is example.com, so a
// record for "_abc.www.example.com" is typed as "_abc.www" and one for www.example.com as "www". Most owners'
// domains are example.com, but many are example.co.uk or example.com.ng, whose zone keeps two endings.
// Client-safe (no imports).

// Two-part endings that are one "public suffix" (the zone is one label further left). Not exhaustive; anything
// missing falls back to the last two labels, which is right for every plain .com/.org/.io/.app style ending.
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk",
  "com.ng", "org.ng", "net.ng", "edu.ng", "gov.ng", "sch.ng", "name.ng",
  "co.za", "org.za", "net.za", "ac.za", "gov.za", "web.za",
  "co.ke", "or.ke", "ne.ke", "ac.ke", "go.ke", "sc.ke",
  "com.gh", "org.gh", "edu.gh", "gov.gh", "co.tz", "or.tz", "co.ug", "or.ug", "ac.ug", "co.zm", "co.zw", "co.mw", "co.bw", "com.na",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au", "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "gov.in",
  "com.br", "net.br", "org.br", "com.mx", "org.mx", "com.ar", "com.co", "com.pe", "com.ve", "com.uy", "com.ec", "com.bo",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "co.kr", "or.kr", "com.cn", "net.cn", "org.cn", "com.hk", "com.tw", "com.sg", "com.my", "com.ph", "com.vn", "co.id", "co.th", "com.pk", "com.bd", "com.lk", "com.np",
  "com.tr", "org.tr", "co.il", "org.il", "com.eg", "com.sa", "com.qa", "com.kw", "com.lb", "com.jo", "co.ae",
  "com.pl", "com.ua", "com.ru", "co.at", "com.es", "com.pt", "com.gr", "com.cy", "com.mt",
]);

const clean = (host: string) => host.trim().toLowerCase().replace(/\.$/, "");

/** example.com for www.example.com; example.co.uk for shop.example.co.uk. */
export function registrableDomain(host: string): string {
  const labels = clean(host).split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/** The "Name/Host" to type at the registrar for a record about `fullName`: "www", "_abc.www", or "@" for the zone itself. */
export function registrarRelativeName(fullName: string, domain: string): string {
  const name = clean(fullName);
  const zone = registrableDomain(domain);
  if (name === zone) return "@";
  if (name.endsWith(`.${zone}`)) return name.slice(0, name.length - zone.length - 1);
  // Unexpected shape (e.g. the domain changed after the record was issued): show the real value, don't guess.
  return name;
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const t = await prisma.template.findFirst();
  if (t) {
    console.log("Template ID:", t.id);
    const res = await fetch('http://localhost:3000/api/v1/templates/' + t.id + '/snapshot');
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Body:", text.slice(0, 500));
  } else {
    console.log("No templates found");
  }
}

main().finally(() => prisma.$disconnect());

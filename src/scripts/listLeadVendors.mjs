import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const vendors = await prisma.leadVendor.findMany({
  orderBy: { name: 'asc' },
  select: { id: true, name: true, slug: true, active: true, _count: { select: { campaigns: true, leads: true } } },
});

console.log('\nAll vendors:\n');
for (const v of vendors) {
  console.log(
    `  ${v.active ? '●' : '○'} ${v.name}  (slug=${v.slug}, campaigns=${v._count.campaigns}, leads=${v._count.leads})`
  );
}
console.log('');
await prisma.$disconnect();

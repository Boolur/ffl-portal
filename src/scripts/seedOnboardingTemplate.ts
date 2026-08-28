import { prisma } from '../lib/prisma';
import { ensureOnboardingTemplate } from '../lib/onboardingTemplate';

async function main() {
  const template = await ensureOnboardingTemplate();
  console.log(`Seeded ${template.name} v${template.version} with ${template.items.length} items.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

'use server';

import { Prisma, UserRole } from '@prisma/client';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getProcessingPipelineAccess } from '@/lib/processingPipeline';
import {
  normalizeProcessingLayoutConfig,
  normalizeProcessingLayoutName,
  type ProcessingPipelineLayoutConfig,
} from '@/lib/processingPipelineLayouts';

type LayoutActor = {
  id: string;
  role: UserRole;
};

export type ProcessingPipelineSavedLayout = {
  id: string;
  name: string;
  config: ProcessingPipelineLayoutConfig;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
};

async function getLayoutActor(): Promise<LayoutActor | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  const role = (session?.user?.activeRole || session?.user?.role) as
    | UserRole
    | undefined;
  if (!id || !role || !getProcessingPipelineAccess(role).canView) return null;
  return { id, role };
}

async function listLayouts(actor: LayoutActor): Promise<ProcessingPipelineSavedLayout[]> {
  const layouts = await prisma.processingPipelineLayout.findMany({
    where: { userId: actor.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return layouts.flatMap((layout) => {
    const normalized = normalizeProcessingLayoutConfig(layout.config, actor.role);
    if (!normalized.success) return [];
    return [{
      id: layout.id,
      name: layout.name,
      config: normalized.config,
      sortOrder: layout.sortOrder,
      isActive: layout.isActive,
      updatedAt: layout.updatedAt.toISOString(),
    }];
  });
}

function layoutError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return 'You already have a layout with that name.';
  }
  return 'Unable to save the layout right now.';
}

function revalidatePipeline() {
  revalidatePath('/pipeline');
}

export async function getProcessingPipelineLayouts() {
  noStore();
  const actor = await getLayoutActor();
  if (!actor) return { success: false as const, error: 'Not authorized.' };
  return { success: true as const, layouts: await listLayouts(actor) };
}

export async function createProcessingPipelineLayout(input: {
  name: string;
  config: ProcessingPipelineLayoutConfig;
}) {
  const actor = await getLayoutActor();
  if (!actor) return { success: false as const, error: 'Not authorized.' };
  const parsedName = normalizeProcessingLayoutName(input.name);
  if (!parsedName.success) return parsedName;
  const parsedConfig = normalizeProcessingLayoutConfig(input.config, actor.role);
  if (!parsedConfig.success) return parsedConfig;

  try {
    await prisma.$transaction(async (tx) => {
      const existingCount = await tx.processingPipelineLayout.count({
        where: { userId: actor.id },
      });
      if (existingCount >= 20) throw new Error('LAYOUT_LIMIT');
      const aggregate = await tx.processingPipelineLayout.aggregate({
        where: { userId: actor.id },
        _max: { sortOrder: true },
      });
      await tx.processingPipelineLayout.create({
        data: {
          userId: actor.id,
          name: parsedName.name,
          nameKey: parsedName.nameKey,
          config: parsedConfig.config as unknown as Prisma.InputJsonValue,
          sortOrder: (aggregate._max.sortOrder ?? -1) + 1,
          isActive: existingCount === 0,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'LAYOUT_LIMIT') {
      return { success: false as const, error: 'You can save up to 20 layouts.' };
    }
    return { success: false as const, error: layoutError(error) };
  }
  revalidatePipeline();
  return { success: true as const, layouts: await listLayouts(actor) };
}

export async function updateProcessingPipelineLayout(input: {
  id: string;
  name: string;
  config: ProcessingPipelineLayoutConfig;
}) {
  const actor = await getLayoutActor();
  if (!actor) return { success: false as const, error: 'Not authorized.' };
  const parsedName = normalizeProcessingLayoutName(input.name);
  if (!parsedName.success) return parsedName;
  const parsedConfig = normalizeProcessingLayoutConfig(input.config, actor.role);
  if (!parsedConfig.success) return parsedConfig;
  try {
    const updated = await prisma.processingPipelineLayout.updateMany({
      where: { id: input.id, userId: actor.id },
      data: {
        name: parsedName.name,
        nameKey: parsedName.nameKey,
        config: parsedConfig.config as unknown as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) {
      return { success: false as const, error: 'Layout not found.' };
    }
  } catch (error) {
    return { success: false as const, error: layoutError(error) };
  }
  revalidatePipeline();
  return { success: true as const, layouts: await listLayouts(actor) };
}

export async function duplicateProcessingPipelineLayout(input: {
  id: string;
  name: string;
}) {
  const actor = await getLayoutActor();
  if (!actor) return { success: false as const, error: 'Not authorized.' };
  const parsedName = normalizeProcessingLayoutName(input.name);
  if (!parsedName.success) return parsedName;
  try {
    await prisma.$transaction(async (tx) => {
      const [source, existingCount, aggregate] = await Promise.all([
        tx.processingPipelineLayout.findFirst({
          where: { id: input.id, userId: actor.id },
        }),
        tx.processingPipelineLayout.count({ where: { userId: actor.id } }),
        tx.processingPipelineLayout.aggregate({
          where: { userId: actor.id },
          _max: { sortOrder: true },
        }),
      ]);
      if (!source) throw new Error('NOT_FOUND');
      if (existingCount >= 20) throw new Error('LAYOUT_LIMIT');
      await tx.processingPipelineLayout.create({
        data: {
          userId: actor.id,
          name: parsedName.name,
          nameKey: parsedName.nameKey,
          config: source.config as Prisma.InputJsonValue,
          sortOrder: (aggregate._max.sortOrder ?? -1) + 1,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      return { success: false as const, error: 'Layout not found.' };
    }
    if (error instanceof Error && error.message === 'LAYOUT_LIMIT') {
      return { success: false as const, error: 'You can save up to 20 layouts.' };
    }
    return { success: false as const, error: layoutError(error) };
  }
  revalidatePipeline();
  return { success: true as const, layouts: await listLayouts(actor) };
}

export async function activateProcessingPipelineLayout(id: string) {
  const actor = await getLayoutActor();
  if (!actor) return { success: false as const, error: 'Not authorized.' };
  const exists = await prisma.processingPipelineLayout.findFirst({
    where: { id, userId: actor.id },
    select: { id: true },
  });
  if (!exists) return { success: false as const, error: 'Layout not found.' };
  await prisma.$transaction([
    prisma.processingPipelineLayout.updateMany({
      where: { userId: actor.id, isActive: true },
      data: { isActive: false },
    }),
    prisma.processingPipelineLayout.update({
      where: { id },
      data: { isActive: true },
    }),
  ]);
  revalidatePipeline();
  return { success: true as const, layouts: await listLayouts(actor) };
}

export async function reorderProcessingPipelineLayouts(ids: string[]) {
  const actor = await getLayoutActor();
  if (!actor) return { success: false as const, error: 'Not authorized.' };
  const uniqueIds = [...new Set(ids)];
  const owned = await prisma.processingPipelineLayout.findMany({
    where: { userId: actor.id },
    select: { id: true },
  });
  if (
    uniqueIds.length !== owned.length ||
    owned.some((layout) => !uniqueIds.includes(layout.id))
  ) {
    return { success: false as const, error: 'Layout order is invalid.' };
  }
  await prisma.$transaction(
    uniqueIds.map((id, sortOrder) =>
      prisma.processingPipelineLayout.update({
        where: { id },
        data: { sortOrder },
      }),
    ),
  );
  revalidatePipeline();
  return { success: true as const, layouts: await listLayouts(actor) };
}

export async function deleteProcessingPipelineLayout(id: string) {
  const actor = await getLayoutActor();
  if (!actor) return { success: false as const, error: 'Not authorized.' };
  const deleted = await prisma.processingPipelineLayout.findFirst({
    where: { id, userId: actor.id },
    select: { id: true, isActive: true },
  });
  if (!deleted) return { success: false as const, error: 'Layout not found.' };
  await prisma.$transaction(async (tx) => {
    await tx.processingPipelineLayout.delete({ where: { id } });
    if (deleted.isActive) {
      const fallback = await tx.processingPipelineLayout.findFirst({
        where: { userId: actor.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      if (fallback) {
        await tx.processingPipelineLayout.update({
          where: { id: fallback.id },
          data: { isActive: true },
        });
      }
    }
  });
  revalidatePipeline();
  return { success: true as const, layouts: await listLayouts(actor) };
}

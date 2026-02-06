import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { compare } from 'bcryptjs';

export async function POST(request: Request) {
  const debugToken = process.env.AUTH_DEBUG_TOKEN;
  if (!debugToken) {
    return NextResponse.json({ error: 'AUTH_DEBUG_TOKEN not set' }, { status: 400 });
  }

  const headerToken = request.headers.get('x-debug-token');
  if (!headerToken || headerToken !== debugToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const email = String(body?.email || '').toLowerCase().trim();
  const password = String(body?.password || '');

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return NextResponse.json({ status: 'user_not_found' });
  }

  if (!user.active) {
    return NextResponse.json({ status: 'user_inactive' });
  }

  if (!user.passwordHash) {
    return NextResponse.json({ status: 'missing_password_hash' });
  }

  const passwordMatch = await compare(password, user.passwordHash);
  return NextResponse.json({
    status: passwordMatch ? 'ok' : 'password_mismatch',
  });
}

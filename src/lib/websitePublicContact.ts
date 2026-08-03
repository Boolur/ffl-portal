const BISU_PUBLIC_EMAIL_DOMAIN = 'bisuhomeloans.com';

export function toBisuPublicEmail(email: string) {
  const localPart = email.trim().split('@')[0];
  return localPart ? `${localPart}@${BISU_PUBLIC_EMAIL_DOMAIN}` : email.trim();
}

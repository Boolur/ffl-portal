This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-org/ffl-portal&env=DATABASE_URL,NEXTAUTH_SECRET,NEXTAUTH_URL,ADMIN_EMAIL,ADMIN_PASSWORD,ADMIN_NAME,DEFAULT_USER_PASSWORD)

Update the repository URL above to your GitHub repo before using the button.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

### Environment variables

Copy `.env.example` to `.env` and fill in values:

- `DATABASE_URL` (Supabase connection string)
- `NEXTAUTH_SECRET` (random 32+ chars)
- `NEXTAUTH_URL` (use `http://localhost:3000` locally, update in Vercel later)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` (seeded admin)
- `DEFAULT_USER_PASSWORD` (seeded sample users)

### Vercel publish flow

1. Push to GitHub.
2. Vercel builds and deploys automatically.
3. Refresh the app to see changes once the build completes.

The easiest way to deploy your Next.js app is to use the Vercel Platform.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

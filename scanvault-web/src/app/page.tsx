import { redirect } from 'next/navigation';

/** Root route — redirect to POS (the actual app entry point) */
export default function Home() {
  redirect('/pos');
}

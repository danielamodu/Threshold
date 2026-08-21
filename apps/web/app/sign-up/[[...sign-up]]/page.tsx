import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
      <SignUp />
    </main>
  );
}

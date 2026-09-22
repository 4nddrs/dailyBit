import { FormEvent, useState } from 'react';
import type { User } from 'firebase/auth';
import { DeveloperView } from './components/DeveloperView';
import { RyanView } from './components/RyanView';
import { signIn, signUp } from './services/auth';
import { useAuth } from './hooks/useAuth';

function AuthForm() {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignUp = mode === 'signUp';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isSignUp) {
        await signUp(email, password, name.trim() || email, 'dev');
      } else {
        await signIn(email, password);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">DailyBit</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Sign in to manage daily reports and team questions.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {isSignUp ? (
            <label className="block text-sm font-medium text-slate-700">
              Name
              <input
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
          ) : null}

          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </label>

          {error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          ) : null}

          <button
            className="w-full rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Working...' : isSignUp ? 'Sign up' : 'Sign in'}
          </button>
        </form>

        <button
          className="mt-5 w-full text-sm font-medium text-sky-700 hover:text-sky-900"
          type="button"
          onClick={() => {
            setError(null);
            setMode(isSignUp ? 'signIn' : 'signUp');
          }}
        >
          {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
        </button>
      </section>
    </main>
  );
}

interface AppShellProps {
  user: User;
  profile: ReturnType<typeof useAuth>['profile'];
  signOut: ReturnType<typeof useAuth>['signOut'];
}

function AppShell({ user, profile, signOut }: AppShellProps) {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">DailyBit</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950">
              {profile?.name ?? 'DailyBit user'}
            </h1>
            <p className="mt-2 text-sm text-slate-600">Role: {profile?.role ?? 'loading...'}</p>
          </div>
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </header>

        <div className="mt-6">
          {profile?.role === 'lead' ? (
            <RyanView leadUserId={user.uid} />
          ) : (
            <DeveloperView userId={user.uid} developerName={profile?.name ?? user.email ?? 'Developer'} />
          )}
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const { user, profile, profileError, loading, signOut } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        Loading DailyBit...
      </main>
    );
  }

  if (profileError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <section className="w-full max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-rose-950">Could not load your profile</h1>
          <p className="mt-4 text-sm leading-6 text-rose-800">{profileError}</p>
          <p className="mt-3 text-sm leading-6 text-rose-700">
            Check that the Firestore database exists and its rules allow authenticated reads of the
            users collection, then reload.
          </p>
        </section>
      </main>
    );
  }

  return user ? <AppShell user={user} profile={profile} signOut={signOut} /> : <AuthForm />;
}

import { FormEvent, useState } from 'react';
import type { User } from 'firebase/auth';
import { DeveloperView } from './components/DeveloperView';
import { LeadView } from './components/LeadView';
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
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-line bg-canvas p-8">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent-fg">DailyBit</p>
          <h1 className="mt-2 text-3xl font-semibold text-fg">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-fg-muted">
            Sign in to manage daily reports and team questions.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {isSignUp ? (
            <label className="block text-sm font-medium text-fg">
              Name
              <input
                className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
          ) : null}

          <label className="block text-sm font-medium text-fg">
            Email
            <input
              className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="block text-sm font-medium text-fg">
            Password
            <input
              className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </label>

          {error ? (
            <p className="rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-fg">{error}</p>
          ) : null}

          <button
            className="w-full rounded-lg border border-white/15 bg-success-emphasis px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Working...' : isSignUp ? 'Sign up' : 'Sign in'}
          </button>
        </form>

        <button
          className="mt-5 w-full text-sm font-medium text-accent-fg hover:underline"
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
    <main className="min-h-screen bg-canvas px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 rounded-2xl border border-line bg-canvas p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent-fg">DailyBit</p>
            <h1 className="mt-2 text-3xl font-semibold text-fg">
              {profile?.name ?? 'DailyBit user'}
            </h1>
            <p className="mt-2 text-sm text-fg-muted">Role: {profile?.role ?? 'loading...'}</p>
          </div>
          <button
            className="rounded-lg border border-line bg-control px-4 py-2 text-sm font-semibold text-fg transition hover:bg-control-hover"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </header>

        <div className="mt-6">
          {profile?.role === 'lead' ? (
            <LeadView leadUserId={user.uid} />
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
      <main className="flex min-h-screen items-center justify-center bg-canvas text-fg-muted">
        Loading DailyBit...
      </main>
    );
  }

  if (profileError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
        <section className="w-full max-w-lg rounded-2xl border border-danger-emphasis/50 bg-danger-muted p-8">
          <h1 className="text-2xl font-semibold text-danger-fg">Could not load your profile</h1>
          <p className="mt-4 text-sm leading-6 text-fg">{profileError}</p>
          <p className="mt-3 text-sm leading-6 text-fg-muted">
            Check that the Firestore database exists and its rules allow authenticated reads of the
            users collection, then reload.
          </p>
        </section>
      </main>
    );
  }

  return user ? <AppShell user={user} profile={profile} signOut={signOut} /> : <AuthForm />;
}

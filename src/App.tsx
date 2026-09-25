import { FormEvent, useState } from 'react';
import type { User } from 'firebase/auth';
import { DeveloperView } from './components/DeveloperView';
import { LeadView } from './components/LeadView';
import { ManagePanel } from './components/ManagePanel/ManagePanel';
import { signIn, signUp } from './services/auth';
import { useAuth } from './hooks/useAuth';

function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dimension = size === 'sm' ? 'h-5 w-5 text-xs' : 'h-8 w-8 text-sm';
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-sm bg-fg font-bold text-canvas ${dimension}`}
      aria-hidden="true"
    >
      D
    </span>
  );
}

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
    <main className="flex min-h-screen items-center justify-center bg-canvas-inset px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Wordmark />
          <h1 className="text-xl font-normal text-fg">
            {isSignUp ? 'Create your account' : 'Sign in to DailyBit'}
          </h1>
          <p className="text-sm leading-6 text-fg-muted">
            Sign in to manage daily reports and questions.
          </p>
        </div>

        <section className="rounded-md border border-line bg-canvas p-4 shadow-sm">
          <form className="space-y-3" onSubmit={handleSubmit}>
            {isSignUp ? (
              <label className="block text-sm font-medium text-fg">
                Name
                <input
                  className="mt-2 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
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
                className="mt-2 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
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
                className="mt-2 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                minLength={6}
                required
              />
            </label>

            {error ? (
              <p className="rounded-md bg-danger-muted px-3 py-2 text-sm text-danger-fg">{error}</p>
            ) : null}

            <button
              className="w-full rounded-md border border-white/15 bg-success-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Working...' : isSignUp ? 'Sign up' : 'Sign in'}
            </button>
          </form>
        </section>

        <div className="mt-4 rounded-md border border-line bg-canvas p-3 text-center">
          <button
            className="text-sm font-medium text-accent-fg hover:underline"
            type="button"
            onClick={() => {
              setError(null);
              setMode(isSignUp ? 'signIn' : 'signUp');
            }}
          >
            {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
          </button>
        </div>
      </div>
    </main>
  );
}

interface AppShellProps {
  user: User;
  profile: ReturnType<typeof useAuth>['profile'];
  signOut: ReturnType<typeof useAuth>['signOut'];
}

function ManageTeamButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition ${
        active
          ? 'border-accent-emphasis bg-accent-muted text-accent-fg'
          : 'border-line bg-control text-fg-muted hover:bg-control-hover'
      }`}
      type="button"
      aria-label="Manage team"
      title="Manage team"
      aria-pressed={active}
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M5.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.507 5.507 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.494 3.494 0 0 1 2 5.5ZM11 4a.75.75 0 1 0 0 1.5 1.5 1.5 0 0 1 .666 2.844.75.75 0 0 0-.416.672v.352a.75.75 0 0 0 .574.73c1.2.289 2.162 1.2 2.522 2.372a.75.75 0 1 0 1.434-.44 5.01 5.01 0 0 0-2.56-3.012A3 3 0 0 0 11 4Z" />
      </svg>
    </button>
  );
}

function AppShell({ user, profile, signOut }: AppShellProps) {
  const [view, setView] = useState<'dashboard' | 'manage'>('dashboard');
  const isLead = profile?.role === 'lead';
  const showManage = isLead && view === 'manage';
  const viewName = isLead ? (showManage ? 'Manage team' : 'Lead View') : 'Developer';

  return (
    <div className="min-h-screen bg-canvas-inset">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas-subtle">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6 lg:px-8">
          <div className="flex items-center gap-2 text-sm">
            <Wordmark size="sm" />
            <span className="font-semibold text-fg">DailyBit</span>
            <span className="text-fg-muted">/</span>
            <span className="text-fg-muted">{viewName}</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 break-words text-sm text-fg-muted">{profile?.name ?? 'DailyBit user'}</span>
            <span className="shrink-0 rounded-full bg-neutral-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
              {profile?.role ?? 'loading...'}
            </span>
            {isLead ? (
              <ManageTeamButton
                active={showManage}
                onClick={() => setView((current) => (current === 'manage' ? 'dashboard' : 'manage'))}
              />
            ) : null}
            <button
              className="shrink-0 rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover"
              type="button"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6 lg:px-8">
        {showManage ? (
          <ManagePanel currentUserId={user.uid} onBack={() => setView('dashboard')} />
        ) : profile?.role === 'lead' ? (
          <LeadView leadUserId={user.uid} />
        ) : (
          <DeveloperView userId={user.uid} developerName={profile?.name ?? user.email ?? 'Developer'} />
        )}
      </main>
    </div>
  );
}

export default function App() {
  const { user, profile, profileError, loading, signOut } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas-inset text-fg-muted">
        Loading DailyBit...
      </main>
    );
  }

  if (profileError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas-inset px-4 py-10">
        <section className="w-full max-w-lg rounded-md border border-danger-emphasis/50 bg-danger-muted p-4 shadow-sm">
          <h1 className="text-lg font-semibold text-danger-fg">Could not load your profile</h1>
          <p className="mt-4 break-words text-sm leading-6 text-fg">{profileError}</p>
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

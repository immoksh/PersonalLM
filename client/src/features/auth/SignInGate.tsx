import { LayersIcon, PdfIcon, TextIcon, YouTubeIcon } from '@/components/icons';
import { GoogleSignInButton } from './GoogleSignInButton';

const HIGHLIGHTS = [
  { Icon: PdfIcon, label: 'PDFs & transcripts' },
  { Icon: TextIcon, label: 'Rich text notes' },
  { Icon: YouTubeIcon, label: 'Links & videos' },
];

/**
 * Shown in the content area when nobody is signed in.
 *
 * Deliberately not a `/login` route: opening the app lands you on the app
 * itself, with the shell already visible, rather than bouncing to a separate
 * login screen.
 */
export function SignInGate() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center sm:py-24">
      <span className="mb-6 grid size-14 place-items-center rounded-2xl bg-neon text-neon-ink glow">
        <LayersIcon className="size-7" />
      </span>

      <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
        Everything you read, <span className="text-gradient">in one place</span>
      </h1>
      <p className="mt-3 text-sm text-muted sm:text-base">
        Collect PDFs, transcripts, articles and videos into a single searchable library. Sign in
        with Google to get started — it takes a couple of seconds.
      </p>

      <div className="mt-8">
        <GoogleSignInButton />
      </div>

      <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        {HIGHLIGHTS.map(({ Icon, label }) => (
          <li key={label} className="flex items-center gap-2 text-sm text-faint">
            <Icon className="size-4 text-neon" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

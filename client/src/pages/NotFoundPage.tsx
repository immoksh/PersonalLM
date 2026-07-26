import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <p className="text-sm font-medium text-neon">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">Page not found</h1>
      <p className="mt-2 text-sm text-muted">That page does not exist or has moved.</p>
      <Link to="/" className="mt-6 inline-block text-sm font-medium text-neon hover:underline">
        Back to chat
      </Link>
    </div>
  );
}

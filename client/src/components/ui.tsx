import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

/** Shared primitives. Anything reused three-plus times earns a spot here. */

export const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-neon text-neon-ink font-semibold hover:brightness-110 glow',
  secondary: 'bg-surface-2 text-text border border-border hover:border-border-strong',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'text-danger border border-transparent hover:border-danger/40 hover:bg-danger/10',
};

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm',
        'transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        className ?? 'size-5',
      )}
    />
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text">
        {label}
      </label>
      {children}
      {error ? (
        // role=alert so screen readers announce it the moment validation fails.
        <p id={`${htmlFor}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-sm text-faint">{hint}</p>
      )}
    </div>
  );
}

const CONTROL =
  'w-full rounded-lg border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint transition outline-none';
const CONTROL_STATE = (invalid: boolean | undefined) =>
  invalid
    ? 'border-danger focus:border-danger'
    : 'border-border focus:border-neon focus:shadow-[0_0_0_3px_var(--neon-soft)]';

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(CONTROL, CONTROL_STATE(Boolean(props['aria-invalid'])), className)}
    />
  );
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(CONTROL, 'resize-y', CONTROL_STATE(Boolean(props['aria-invalid'])), className)}
    />
  );
}

export function Alert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'info';
}) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cx(
        'rounded-lg border px-3 py-2 text-sm',
        tone === 'error'
          ? 'border-danger/40 bg-danger/10 text-danger'
          : 'border-border bg-surface-2 text-muted',
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl2 border border-dashed border-border px-6 py-14 text-center">
      {icon && (
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-neon-soft text-neon">
          {icon}
        </span>
      )}
      <p className="font-medium text-text">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'neon' | 'violet';
}) {
  const tones = {
    neutral: 'bg-surface-2 text-muted border-border',
    neon: 'bg-neon-soft text-neon border-neon/30',
    violet: 'bg-violet-soft text-violet border-violet/30',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

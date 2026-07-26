import { useState } from 'react';
import { userInitials, type PublicUser } from '@personallm/shared';
import { cx } from './ui';

interface AvatarProps {
  user: PublicUser;
  className?: string;
}

/**
 * Google profile picture with an initials fallback. Google's CDN sometimes
 * rate-limits or 404s these URLs, so a broken image must degrade rather than
 * leave a torn placeholder in the header.
 */
export function Avatar({ user, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(user.picture) && !failed;

  return (
    <span
      className={cx(
        'grid shrink-0 place-items-center overflow-hidden rounded-full bg-violet-soft text-violet',
        'text-xs font-semibold select-none',
        className ?? 'size-8',
      )}
    >
      {showImage ? (
        <img
          src={user.picture!}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{userInitials(user)}</span>
      )}
    </span>
  );
}

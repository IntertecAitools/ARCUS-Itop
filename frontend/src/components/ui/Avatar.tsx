import { cn, initials } from '@/lib/utils';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  xs: 'size-6 text-[10px]',
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-[13px]',
  lg: 'size-11 text-sm',
} as const;

/**
 * Initials fallback uses a hue derived from the name, so the same person keeps
 * the same colour across screens. These are decorative tints, not series
 * colours — identity is carried by the initials and the adjacent name.
 *
 * The initials themselves are in ink: the series hues are chart colours,
 * chosen for 3:1 against the surface, and as small text on their own tint
 * they fall to 2.6–4.4:1 (WCAG 1.4.3 asks 4.5:1).
 */
const tints = [
  'bg-series-1/15',
  'bg-series-2/15',
  'bg-series-3/15',
  'bg-series-5/15',
  'bg-series-6/15',
  'bg-series-7/15',
];

function tintFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return tints[hash % tints.length];
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('shrink-0 rounded-full object-cover', sizeClasses[size], className)}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-ink',
        sizeClasses[size],
        tintFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

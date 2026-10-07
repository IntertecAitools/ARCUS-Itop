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
 */
const tints = [
  'bg-series-1/12 text-series-1',
  'bg-series-2/12 text-series-2',
  'bg-series-3/12 text-series-3',
  'bg-series-5/12 text-series-5',
  'bg-series-6/12 text-series-6',
  'bg-series-7/12 text-series-7',
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
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        sizeClasses[size],
        tintFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

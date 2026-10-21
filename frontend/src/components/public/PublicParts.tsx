import type { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Small uppercase label: the eyebrow over a heading. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[12px] font-medium tracking-[0.16em] text-ink-secondary uppercase', className)}>
      {children}
    </p>
  );
}

/** The quiet call to action: "RAISE A REQUEST →". */
export function ArrowLink({ children, className, ...props }: LinkProps) {
  return (
    <Link
      {...props}
      className={cn(
        'group inline-flex items-center gap-2 py-1 text-[13px] font-semibold tracking-[0.14em] text-ink uppercase',
        'underline-offset-[6px] hover:underline',
        className,
      )}
    >
      {children}
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
    </Link>
  );
}

/** A list where each line is a plain check mark and a sentence. */
export function CheckList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn('space-y-3', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-6 text-ink-secondary">
          <Check className="mt-1 size-4 shrink-0 text-ink" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A decorative picture from assets/images/public, cropped to fill its frame. */
export function PublicImage({ src, className }: { src: string; className?: string }) {
  return (
    <div className={cn('overflow-hidden bg-surface-sunken', className)}>
      <img src={src} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
    </div>
  );
}

/** First stop for keyboard users: jump past the header to the page's <main id="main">. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:bg-brand focus:px-4 focus:py-2 focus:text-[14px] focus:text-on-brand"
    >
      Skip to content
    </a>
  );
}

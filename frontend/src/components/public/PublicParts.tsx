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

/** A portal page's heading block: eyebrow, large light title, optional intro and action. */
export function PageIntro({
  eyebrow = 'Service portal',
  title,
  intro,
  action,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  intro?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-5', className)}>
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="display mt-4 text-[36px] break-words sm:text-[48px]">{title}</h1>
        {intro ? <p className="mt-3 max-w-2xl text-[16px] leading-7 text-ink-secondary">{intro}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div> : null}
    </div>
  );
}

/** A form control's shared look on the public pages (textarea, native select). */
export const publicControl =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:border-brand';

/** A quiet section heading inside a page: light, with a rule beneath. */
export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 border-b border-line pb-3">
      <h2 id={id} className="display text-[24px] sm:text-[28px]">{children}</h2>
      {action}
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

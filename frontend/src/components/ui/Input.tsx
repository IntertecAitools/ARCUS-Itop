import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leftIcon?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export const controlClasses =
  'w-full rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-text-muted ' +
  'transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20';

export function Input({ invalid, leftIcon, className, ref, ...rest }: InputProps) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlClasses, 'h-10', leftIcon ? 'pl-9' : undefined, className)}
      {...rest}
    />
  );
  if (!leftIcon) return input;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted">{leftIcon}</span>
      {input}
    </div>
  );
}

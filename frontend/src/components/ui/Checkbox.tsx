import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Checkbox({ label, className, id, ...rest }: CheckboxProps) {
  return (
    <label htmlFor={id} className={cn('inline-flex items-center gap-2 text-sm text-text', className)}>
      <input id={id} type="checkbox" className="size-4 rounded border-border accent-primary" {...rest} />
      {label}
    </label>
  );
}

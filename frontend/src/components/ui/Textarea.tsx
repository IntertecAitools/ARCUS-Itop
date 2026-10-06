import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { controlClasses } from './Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ invalid, className, rows = 4, ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(controlClasses, 'py-2', className)}
      {...rest}
    />
  );
}

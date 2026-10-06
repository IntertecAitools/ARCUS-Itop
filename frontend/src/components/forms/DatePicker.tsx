import type { InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui';

export interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  /** YYYY-MM-DD or '' */
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}

/** Native date input: keyboard accessible and localised by the browser. */
export function DatePicker({ value, onChange, invalid, ...rest }: DatePickerProps) {
  return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid} {...rest} />;
}

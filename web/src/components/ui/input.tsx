import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex min-h-11 w-full rounded-[3px] border border-[var(--qisi-line-strong)] bg-[var(--qisi-paper)] px-3 py-2 text-base text-[var(--qisi-ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--qisi-ink-muted)] focus-visible:border-[var(--qisi-cobalt)] focus-visible:ring-3 focus-visible:ring-[color:rgba(40,100,220,0.14)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--qisi-danger)]',
        className,
      )}
      {...props}
    />
  );
}

export { Input };

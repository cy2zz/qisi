import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[3px] px-4 text-sm font-semibold transition-[background-color,color,transform,box-shadow] duration-200 outline-none focus-visible:ring-3 focus-visible:ring-[color:rgba(40,100,220,0.28)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'border border-[var(--qisi-ink)] bg-[var(--qisi-ink)] text-white',
        outline:
          'border border-[var(--qisi-line-strong)] bg-[var(--qisi-paper)] text-[var(--qisi-ink)]',
        quiet: 'border border-transparent bg-transparent text-[var(--qisi-cobalt)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Button({
  asChild = false,
  className,
  variant,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };

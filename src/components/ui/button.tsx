import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/cn'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 select-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:opacity-90',
        secondary: 'bg-surface-2 text-text hover:bg-surface-3 border border-border',
        outline: 'border border-border bg-surface text-text hover:bg-surface-2',
        ghost: 'text-muted hover:text-text hover:bg-surface-2',
        danger: 'bg-danger text-white hover:opacity-90',
        link: 'text-text underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        xs: 'h-7 px-2 text-xs',
        sm: 'h-8 px-2.5',
        md: 'h-9 px-3.5',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, type, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : 'button'
  return <Comp ref={ref} type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />
})
Button.displayName = 'Button'

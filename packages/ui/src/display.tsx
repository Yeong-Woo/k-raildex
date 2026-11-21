import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

const tones = {
  neutral: 'bg-muted text-fg',
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
} as const;

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium', tones[tone], className)}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-bg-elevated', className)} {...props} />;
}

export function CardHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2 border-b border-border px-4 py-2.5', className)}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {actions}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-fg-muted">{children}</div>;
}

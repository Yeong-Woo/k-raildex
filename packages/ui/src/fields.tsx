import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

const base =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:outline-2 focus:outline-ring disabled:opacity-60 aria-invalid:border-danger';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, 'min-h-20', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(base, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('text-xs font-medium text-fg-muted', className)}>
      {children}
    </label>
  );
}

export function FieldShell({
  label,
  help,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  help?: string | undefined;
  error?: string | undefined;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : help ? (
        <p className="text-xs text-fg-muted">{help}</p>
      ) : null}
    </div>
  );
}

import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 bg-black/40" />
        <D.Content className="fixed top-1/2 left-1/2 w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-elevated p-4 shadow-xl">
          <D.Title className="mb-3 text-base font-semibold">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          <div className="max-h-[70vh] overflow-auto">{children}</div>
          {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

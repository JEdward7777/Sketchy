/**
 * Base components (stage 4.9.2): button, panel, and the small pieces every
 * screen shares. Styling lives in components.css, from the theme tokens.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  wide = false,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; wide?: boolean }) {
  const cls = ['btn', `btn-${variant}`, wide ? 'btn-wide' : '', className ?? ''].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest} />;
}

export function Panel({
  title,
  children,
  className,
  testId,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={['panel', className ?? ''].filter(Boolean).join(' ')} data-testid={testId}>
      {title ? <h2 className="panel-title">{title}</h2> : null}
      {children}
    </section>
  );
}

/** A one-line notice: info, a warning, or an error. */
export function Notice({ tone = 'info', children, testId }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode; testId?: string }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
      {children}
    </p>
  );
}

export function Screen({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <main className="screen" data-testid={testId}>
      {children}
    </main>
  );
}

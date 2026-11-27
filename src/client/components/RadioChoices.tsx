/**
 * A row of choice buttons with radio-group keyboard behaviour (WAI-ARIA
 * radio group): one tab stop on the checked option (roving tabindex), and
 * the arrow keys, Home and End move to and pick the next enabled option.
 */

import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export interface RadioOption<T> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
  /** What the button shows; the label when absent. */
  readonly content?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly data?: Readonly<Record<`data-${string}`, string>>;
}

/** Index of the option the keyboard lands on from `from` moving `step`, skipping disabled ones; -1 if none. */
export function nextEnabled<T>(options: readonly RadioOption<T>[], from: number, step: 1 | -1): number {
  const n = options.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n;
    if (!options[i]!.disabled) return i;
  }
  return -1;
}

export function RadioChoices<T extends string | number>({
  label,
  options,
  value,
  onPick,
  className = 'choices choices-text',
  testId,
}: {
  label: string;
  options: readonly RadioOption<T>[];
  value: T | null;
  onPick: (v: T) => void;
  className?: string;
  testId?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = options.findIndex((o) => o.value === value && !o.disabled);
  const tabStop = checked >= 0 ? checked : nextEnabled(options, -1, 1);

  function move(to: number) {
    if (to < 0) return;
    refs.current[to]?.focus();
    const o = options[to]!;
    if (o.value !== value) onPick(o.value);
  }

  function onKeyDown(e: KeyboardEvent, i: number) {
    const keys: Record<string, () => number> = {
      ArrowRight: () => nextEnabled(options, i, 1),
      ArrowDown: () => nextEnabled(options, i, 1),
      ArrowLeft: () => nextEnabled(options, i, -1),
      ArrowUp: () => nextEnabled(options, i, -1),
      Home: () => nextEnabled(options, -1, 1),
      End: () => nextEnabled(options, options.length, -1),
    };
    const target = keys[e.key];
    if (!target) return;
    e.preventDefault();
    move(target());
  }

  return (
    <div className={className} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          className={['choice', o.className ?? ''].filter(Boolean).join(' ')}
          style={o.style}
          aria-checked={o.value === value}
          aria-label={o.content !== undefined ? o.label : undefined}
          disabled={o.disabled}
          tabIndex={i === tabStop ? 0 : -1}
          onClick={() => {
            if (o.value !== value) onPick(o.value);
          }}
          onKeyDown={(e) => onKeyDown(e, i)}
          {...o.data}
        >
          {o.content !== undefined ? o.content : o.label}
        </button>
      ))}
    </div>
  );
}

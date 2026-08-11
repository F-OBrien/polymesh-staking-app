'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small ⓘ that reveals an explanation on hover, focus or tap.
 *
 * Pages here had a habit of explaining themselves in a paragraph under every
 * heading. The explanations were worth having and worth *keeping* — a staking
 * site's audience includes people who do not know what commission does to a
 * return — but four lines of prose above the thing a reader came for pushes the
 * data below the fold and gets skipped anyway. This puts the same words one
 * gesture away.
 *
 * Hand-rolled rather than Radix Tooltip. This sits on the critical path of
 * every page, and the budget is measured in single-digit kilobytes of headroom
 * (see `docs/STATUS.md` open item 1). Radix's tooltip would be the right call
 * if it needed collision-aware positioning; it needs a box under a button.
 *
 * The accessibility rules it has to satisfy, none of which `title=` does:
 *
 *  - reachable by keyboard, and dismissible with Escape without moving focus
 *  - hoverable — the panel stays open while the pointer is inside it, so a
 *    reader can select the text
 *  - announced, via `aria-describedby` rather than a bare tooltip role
 *  - usable on touch, where there is no hover at all, hence the click toggle
 */
export function InfoTip({
  label = 'More information',
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  /**
   * Open state and the measured anchor position, as one value.
   *
   * Fixed positioning, because an absolutely-positioned panel is clipped by the
   * nearest scroll container — and the table this mostly lives in sits inside
   * `overflow-x-auto`, which cut off the explanations on the right-hand
   * columns. Taking the panel out of flow is the only fix that does not depend
   * on which column a tooltip happens to be attached to.
   *
   * The measurement happens in the *event handler* rather than an effect. Doing
   * it in an effect means a second render every time the panel opens, which is
   * what `react-hooks/set-state-in-effect` is there to catch.
   *
   * The panel is also **portalled to `document.body`**, which fixed position
   * alone does not achieve. Most of these sit inside the operators table's
   * sticky `<th>`, and `position: sticky` with a `z-index` creates a stacking
   * context: the panel's `z-50` then only competes *within* that one cell, so
   * every later header cell painted over its top edge and clipped the first
   * line of text. A portal takes it out of that context entirely.
   */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const open = at != null;
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);

  const show = () => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(340, window.innerWidth - 24);
    setAt({
      top: rect.bottom + 6,
      // Clamp inside the viewport so a tooltip near the right edge shifts back
      // rather than disappearing off-screen.
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
    });
  };
  const hide = () => setAt(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hide();
        // Escape must not strand focus somewhere invisible.
        wrapper.current?.querySelector('button')?.focus();
      }
    };
    // A tap elsewhere closes it. Touch has no hover, so without this the panel
    // would stay open until the button was tapped again.
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) hide();
    };

    // Scrolling moves the anchor out from under a fixed panel, so close rather
    // than leave it stranded mid-page.
    const onScroll = () => hide();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <span
      ref={wrapper}
      className="relative inline-flex align-middle"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => (open ? hide() : show())}
        onFocus={show}
        onBlur={(e) => {
          // Keep it open while focus moves *into* the panel, e.g. to a link.
          if (!wrapper.current?.contains(e.relatedTarget as Node)) hide();
        }}
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full border text-[10px] leading-none font-semibold transition-colors"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--text-muted)',
          background: 'transparent',
        }}
      >
        <span aria-hidden="true">i</span>
      </button>

      {at
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              className="fixed z-50 block rounded-[10px] border p-3 text-[13px] leading-[18px] font-normal shadow-md"
              style={{
                top: at.top,
                left: at.left,
                width: 'min(340px, calc(100vw - 24px))',
                borderColor: 'var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text-secondary)',
                // Both inherited from wherever this is anchored. Table headers
                // set `nowrap`, which made the prose run off the side of the
                // panel, and headings set their own tracking and weight.
                whiteSpace: 'normal',
                textAlign: 'left',
                fontWeight: 400,
                letterSpacing: 'normal',
              }}
              // The panel is out of the wrapper's DOM subtree now, so it needs
              // its own hover handling or moving the pointer into it closes it.
              onMouseEnter={show}
              onMouseLeave={hide}
            >
              {children}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

/**
 * A page or section heading with its explanation folded into an {@link InfoTip}.
 *
 * `lead` is the one line that must survive without interaction — a reader who
 * never hovers still has to know what they are looking at.
 */
export function HeadingWithTip({
  as: Tag = 'h2',
  id,
  title,
  lead,
  className = '',
  children,
}: {
  as?: 'h1' | 'h2' | 'h3';
  id?: string;
  title: string;
  lead?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  const size =
    Tag === 'h1'
      ? 'text-3xl leading-9'
      : Tag === 'h2'
        ? 'text-[22px] leading-7'
        : 'text-[17px] leading-6';

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <Tag id={id} className={`${size} font-semibold tracking-tight`}>
          {title}
        </Tag>
        <InfoTip label={`About ${title}`}>{children}</InfoTip>
      </div>
      {lead ? (
        <p className="mt-2 mb-0 max-w-[65ch]" style={{ color: 'var(--text-secondary)' }}>
          {lead}
        </p>
      ) : null}
    </div>
  );
}

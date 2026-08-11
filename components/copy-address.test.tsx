import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopyAddress } from './copy-address';

const ADDRESS = '2DK6iDQ3fcP9BDtLzPE9DcmTpkMq8JpwE3sLZvPWQnP7SaFf';

function mockClipboard(impl?: () => Promise<void>) {
  const writeText = vi.fn(impl ?? (() => Promise.resolve()));
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

describe('CopyAddress', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => {
    // `vitest.setup.ts` only registers jest-dom, so auto-cleanup is not on —
    // without this every render stacks up and `getByRole` finds several.
    cleanup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('copies the FULL address, not the truncated one on screen', async () => {
    // The entire reason this component exists. The display is elided for
    // readability; a paste of "2DK6iD…P7SaFf" is worthless.
    const writeText = mockClipboard();
    render(<CopyAddress address={ADDRESS} />);

    expect(screen.getByText(/…/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
  });

  it('confirms the copy, so success and silence are not the same thing', async () => {
    mockClipboard();
    render(<CopyAddress address={ADDRESS} label="Assetera" />);

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveAccessibleName(/Copied the full/i),
    );
  });

  it('says so when the clipboard is unavailable rather than failing silently', async () => {
    // `navigator.clipboard` is undefined outside a secure context — plain-HTTP
    // previews and some embedded browsers. A button that appears to work and
    // does not is worse than one that admits it.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<CopyAddress address={ADDRESS} />);

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveAccessibleName(/Could not copy/i),
    );
  });

  it('reports a rejected write as a failure', async () => {
    mockClipboard(() => Promise.reject(new Error('denied')));
    render(<CopyAddress address={ADDRESS} />);

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveAccessibleName(/Could not copy/i),
    );
  });

  it('names what it is copying, for a screen reader in a dense table', async () => {
    mockClipboard();
    render(<CopyAddress address={ADDRESS} label="Assetera" />);
    expect(screen.getByRole('button')).toHaveAccessibleName("Copy the full Assetera’s address");
  });

  it('exposes the full address on hover without a click', () => {
    mockClipboard();
    render(<CopyAddress address={ADDRESS} />);
    expect(screen.getByTitle(ADDRESS)).toBeInTheDocument();
  });

  it('does not trigger a surrounding link or row handler', async () => {
    // These sit inside `<Link>`s and clickable table rows; a copy must not
    // navigate away from the page you wanted the address on.
    mockClipboard();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <CopyAddress address={ADDRESS} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});

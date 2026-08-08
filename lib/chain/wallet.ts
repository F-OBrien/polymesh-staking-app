/**
 * Wallet extension bridge.
 *
 * Read-only: this discovers accounts and nothing else. Signing is explicitly
 * out of scope (Q8), so no signer is ever requested and no extrinsic is ever
 * built. That is worth stating in code as well as in docs, because "connect
 * wallet" usually implies transactions and here it does not — connecting only
 * saves the user pasting an address.
 *
 * `@polkadot/extension-dapp` is loaded dynamically, like everything else in
 * this directory. It is not large on its own but it pulls in the util-crypto
 * stack, and the rule is simpler to keep when it has no exceptions.
 */

export interface WalletAccount {
  address: string;
  name: string;
  /** Which extension supplied it, e.g. "polywallet" or "polkadot-js". */
  source: string;
}

export class WalletError extends Error {
  constructor(
    message: string,
    readonly kind: 'no-extension' | 'rejected' | 'no-accounts' | 'unknown',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'WalletError';
  }
}

/** Shown in the tab a user authorises. */
const DAPP_NAME = 'Polymesh Staking';

/**
 * Asks the extension for accounts.
 *
 * Every failure mode gets its own `kind`, because the recovery differs and a
 * single "could not connect" leaves the user with nothing to do: no extension
 * means install one, rejected means approve the prompt, no accounts means the
 * extension is connected but empty. The previous app surfaced all three
 * identically.
 */
export async function connectWallet(): Promise<WalletAccount[]> {
  if (typeof window === 'undefined') {
    throw new WalletError('A wallet can only be connected in a browser.', 'unknown');
  }

  const { web3Accounts, web3Enable } = await import('@polkadot/extension-dapp');

  let extensions: unknown[];
  try {
    extensions = await web3Enable(DAPP_NAME);
  } catch (cause) {
    throw new WalletError('The wallet extension refused the connection.', 'rejected', { cause });
  }

  // An empty list means either no extension is installed or the user dismissed
  // the authorisation prompt. The two are indistinguishable from here, so the
  // message covers both rather than guessing.
  if (extensions.length === 0) {
    throw new WalletError(
      'No wallet extension responded. Install Polymesh Wallet, or approve the connection request if you dismissed it.',
      'no-extension',
    );
  }

  const accounts = await web3Accounts();
  if (accounts.length === 0) {
    throw new WalletError(
      'The wallet is connected but has no accounts for this network.',
      'no-accounts',
    );
  }

  return accounts.map((account) => ({
    address: account.address,
    name: account.meta.name ?? account.address,
    source: account.meta.source,
  }));
}

// ---------------------------------------------------------------------------
// Address input
// ---------------------------------------------------------------------------

/** Base58 excludes 0, O, I and l — the characters people misread. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * A cheap structural check on a pasted address.
 *
 * **Deliberately not a checksum validation.** Verifying an SS58 checksum needs
 * blake2b, which means loading the util-crypto stack — and the acceptance
 * criterion for this phase is that no Polkadot code loads before the user
 * connects. Making the address box pull in crypto to reject a typo would defeat
 * the whole arrangement for a case the next step catches anyway: an address
 * that passes this and is still wrong simply has no staking position, which the
 * page already renders honestly.
 *
 * So this catches the mistakes that are actually common — a truncated paste, a
 * transaction hash, stray whitespace — and lets the chain be the authority on
 * the rest.
 */
export function looksLikeAddress(value: string): boolean {
  const trimmed = value.trim();
  // Polymesh SS58 addresses are 47–48 characters; the range is loose because
  // encoded length varies slightly with the leading bytes.
  if (trimmed.length < 46 || trimmed.length > 50) return false;
  if (trimmed.startsWith('0x')) return false;
  return BASE58.test(trimmed);
}

/** Normalises pasted input — explorers and wallets add whitespace freely. */
export function normaliseAddress(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

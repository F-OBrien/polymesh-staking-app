/**
 * Polymesh type augmentations for `@polkadot/api`.
 *
 * Without these, polkadot-js only knows the generic Substrate surface:
 * `api.query.staking.erasStakersPaged` is typed as an index signature, storage
 * results come back as bare `Codec`, and every Polymesh-specific pallet is
 * invisible. That is why `lib/chain/compat.ts` had to be an `any` zone.
 *
 * **This is a `.d.ts` on purpose, and it must stay one.** The package ships
 * real (if nearly empty) `.js` files alongside its declarations, so writing
 * `import '@polymeshassociation/polymesh-types/polkadot/augment-api'` in an
 * ordinary `.ts` file emits a runtime import. Everything under `lib/chain/`
 * is deliberately unreachable until a user connects a wallet — see
 * `npm run assert:lazy` — and a stray runtime import is exactly the kind of
 * edge that puts a package back on the critical path. Declared here, the
 * augmentation is compile-time only: TypeScript picks it up through the
 * TypeScript include glob in tsconfig, and no bundler ever sees it.
 *
 * The package is therefore a **devDependency**. We take its types and none of
 * its runtime.
 *
 * We also do not use its `typesBundle`. That exists so polkadot-js can decode
 * chains whose metadata does not describe its own types; Polymesh's current
 * runtime (spec 8000020) carries metadata v14+, and every read in this codebase
 * decodes correctly without it — verified against mainnet. Adding it would put
 * runtime code in the browser bundle to solve a problem we do not have.
 *
 * **These types describe the current runtime only.** Historical eras are the
 * whole reason `compat.ts` exists: v6/v7 storage shapes are not in this
 * augmentation and never will be, so the probing and fallbacks there stay, and
 * so does some loose access. The augmentation shrinks that surface; it does not
 * remove it.
 */

import '@polymeshassociation/polymesh-types/polkadot/augment-types';
import '@polymeshassociation/polymesh-types/polkadot/augment-api';

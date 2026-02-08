import { AsyncLocalStorage } from "node:async_hooks"

import type { AccountState } from "./account"

export const accountStorage = new AsyncLocalStorage<AccountState>()

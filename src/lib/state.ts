import type { ModelsResponse } from "~/services/copilot/get-models"

import { accountStorage } from "./async-context"

export interface State {
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  showToken: boolean
  verbose: boolean
}

const rawState: State = {
  accountType: "individual",
  manualApprove: false,
  showToken: false,
  verbose: false,
}

/**
 * Proxied state object. During a request handled by the rotation middleware,
 * reads of copilotToken/githubToken/accountType/models are intercepted and
 * return the current account's values from AsyncLocalStorage. Outside of a
 * request context (startup, token refresh), reads fall through to rawState.
 */
export const state: State = new Proxy(rawState, {
  get(target, prop: string | symbol) {
    const account = accountStorage.getStore()
    if (account) {
      if (prop === "copilotToken") return account.copilotToken
      if (prop === "githubToken") return account.githubToken
      if (prop === "accountType") return account.accountType
      if (prop === "models") return account.models
    }
    return Reflect.get(target, prop)
  },
  set(target, prop: string | symbol, value: unknown) {
    return Reflect.set(target, prop, value)
  },
})

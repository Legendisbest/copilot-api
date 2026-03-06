import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { trafficControlManager } from "~/lib/traffic-control"

export const createEmbeddings = async (payload: EmbeddingRequest) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")
  const lease = await trafficControlManager.acquire("/embeddings")

  try {
    const response = await fetch(`${copilotBaseUrl(state)}/embeddings`, {
      method: "POST",
      headers: copilotHeaders(state),
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new HTTPError("Failed to create embeddings", response)
    }

    const result = (await response.json()) as EmbeddingResponse
    lease.release()
    return result
  } catch (error) {
    lease.release()
    throw error
  }
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

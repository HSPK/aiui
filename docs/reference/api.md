# API reference

Loom exposes an OpenAI-compatible surface at `/api/v1/*`. Authentication uses bearer tokens issued in `/settings/api-keys`.

```http
Authorization: Bearer sk-loom-...
```

## Modalities

| Method | Path                                  | Purpose                            |
| ------ | ------------------------------------- | ---------------------------------- |
| POST   | `/api/v1/chat/completions`            | Streaming + non-streaming chat     |
| POST   | `/api/v1/embeddings`                  | Embedding vectors                  |
| POST   | `/api/v1/rerank`                      | Document reranking                 |
| POST   | `/api/v1/images/generations`          | Image generation                   |
| POST   | `/api/v1/audio/speech`                | Text-to-speech                     |
| POST   | `/api/v1/audio/transcriptions`        | Speech-to-text                     |
| GET    | `/api/v1/models`                      | Live model catalog                 |

## Behaviour

For every request:

1. Bearer token is validated against the API-keys table
2. `model` is resolved to a concrete provider + model record
3. The provider's adapter rewrites the request as needed (URL, headers, field filtering)
4. Per-provider + per-model default params are merged in
5. The request is forwarded; tee'd for logging
6. Response is returned verbatim (streaming responses pass through unchanged)
7. One row is written to `generation_logs` with prompt summary, tokens, TTFT, total latency

## Streaming

All capabilities that support streaming preserve the upstream SSE byte stream verbatim. Synthetic events emitted by the playground service (`loom_*`) appear only on `/api/playground/*` endpoints, never on `/api/v1/*`.

## Errors

Errors are passed through with the upstream's status code where possible. When Loom itself rejects the request (auth, unknown model, validation), the response is JSON in the form:

```json
{
  "code": 400,
  "msg": "Model 'gpt-foo' not found",
  "data": null
}
```

## SDK compatibility

Loom is a drop-in replacement for the OpenAI base URL in any SDK:

=== "Python"

    ```python
    from openai import OpenAI
    client = OpenAI(
        base_url="http://localhost:3000/api/v1",
        api_key="sk-loom-...",
    )
    ```

=== "TypeScript"

    ```ts
    import OpenAI from "openai";
    const openai = new OpenAI({
        baseURL: "http://localhost:3000/api/v1",
        apiKey: "sk-loom-...",
    });
    ```

=== "curl"

    ```bash
    curl http://localhost:3000/api/v1/chat/completions \
      -H "Authorization: Bearer sk-loom-..." \
      -H "Content-Type: application/json" \
      -d '{ "model": "gpt-4o-mini", "messages": [...] }'
    ```

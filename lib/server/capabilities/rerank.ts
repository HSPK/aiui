import "server-only";
import { registerCapability } from "./index";

registerCapability({
    id: "rerank",
    label: "Rerank",
    description: "Cross-encoder re-ranking (Cohere /rerank-style).",
    defaultVariantId: "rerank",
    priority: 30,
    matches: (id) => /\brerank|\brerank-|\bbge-reranker|\bjina-reranker|\bcohere-rerank/i.test(id),
    summarizeInput: (body) => {
        const query = (body as { query?: string }).query;
        const docs = (body as { documents?: unknown[] }).documents;
        const count = Array.isArray(docs) ? docs.length : 0;
        const q = typeof query === "string" ? query.slice(0, 160) : "";
        return `(over ${count} doc${count === 1 ? "" : "s"}) ${q}`;
    },
});

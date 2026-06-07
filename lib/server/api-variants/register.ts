import "server-only";

// Variant registrations live behind side-effect imports for the same
// TDZ-safety reason as adapters/capabilities — the registry maps in
// `./index.ts` would be hit before initialization if these imports
// lived there.
import "./chat-completions";
import "./responses";
import "./embeddings";
import "./images-generations";
import "./audio-speech";
import "./audio-transcriptions";
import "./rerank";

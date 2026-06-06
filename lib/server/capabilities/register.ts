import "server-only";
// Importing this module registers every built-in capability handler with the
// registry in ./index. The gateway imports this once so that downstream code
// (forwardGeneration, classifyModel, listCapabilities, …) sees the full set.
//
// To add a new capability, drop a file in this directory that calls
// `registerCapability(...)` at module scope, then add one `import "./your-file"`
// line below. The gateway core never needs to change.

import "./chat";
import "./embedding";
import "./image";
import "./audio-speech";
import "./audio-transcription";
import "./rerank";

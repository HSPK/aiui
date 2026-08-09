import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Emits `.next/standalone` alongside the normal build: Next traces the
    // files the server actually needs, which is what the container ships.
    // Cuts the image's node_modules from ~600 MB to ~55 MB.
    //
    // The npm tarball keeps using the regular `.next` output and a full
    // dependency install — `scripts/prepack-trim.mjs` strips the standalone
    // copy so the two distribution paths don't double up.
    output: "standalone",
};

export default nextConfig;

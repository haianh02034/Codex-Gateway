import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The gateway's lockfile sits one level up, so Turbopack cannot infer which
  // directory is the root. Saying so removes the ambiguity.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;

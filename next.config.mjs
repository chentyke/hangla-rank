/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/tts": ["./.voice-clone/default-reference.mp3"],
  },
};

export default nextConfig;

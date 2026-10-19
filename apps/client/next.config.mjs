/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@japalife/shared"],
  // Phones on the same Wi-Fi open `next dev` at http://<lan-ip>:3000. Next blocks dev
  // resources for addresses it does not know, which leaves the page dead (no buttons
  // work). These are the private home and hotspot ranges, so it keeps working when the
  // router hands the Mac a new address. Dev only: production builds ignore it.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
};

export default nextConfig;

import type { ReactNode } from "react";

export const metadata = {
  title: "JapaLife",
  description: "A life simulator about the japa journey.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* The game fills the screen; nothing should scroll or bounce under a thumb. */}
      <body style={{ margin: 0, overflow: "hidden", overscrollBehavior: "none" }}>{children}</body>
    </html>
  );
}

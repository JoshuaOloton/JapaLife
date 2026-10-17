import { COPY } from "@japalife/shared/copy";
import type { ReactNode } from "react";

export const metadata = {
  title: COPY.app.title,
  description: COPY.app.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={COPY.language}>
      {/* The game fills the screen; nothing should scroll or bounce under a thumb. */}
      <body style={{ margin: 0, overflow: "hidden", overscrollBehavior: "none" }}>{children}</body>
    </html>
  );
}

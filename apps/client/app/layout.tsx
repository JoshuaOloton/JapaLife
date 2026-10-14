import type { ReactNode } from "react";

export const metadata = {
  title: "JapaLife",
  description: "A life simulator about the japa journey.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

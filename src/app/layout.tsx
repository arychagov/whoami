import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anton Rychagov",
  description: "Personal website of Anton Rychagov",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Business Support",
  description: "Business Support Chatbot frontend demo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F8F7F2] text-[#17251D] antialiased">
        {children}
      </body>
    </html>
  );
}

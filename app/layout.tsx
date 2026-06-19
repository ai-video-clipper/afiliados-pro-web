import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Afiliados Pro",
  description: "Painel de automação para ofertas no Telegram",
};

const menuItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/telegram", label: "Telegram" },
  { href: "/canais", label: "Canais" },
  { href: "/produtos", label: "Produtos" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="min-h-screen bg-slate-950 text-white">
          <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-slate-800 bg-slate-900 p-6 md:block">
            <h1 className="text-2xl font-bold">Afiliados Pro</h1>
            <p className="mt-2 text-sm text-slate-400">
              Telegram automático
            </p>

            <nav className="mt-10 space-y-2">
              {menuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-xl px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          <div className="md:pl-64">{children}</div>
        </div>
      </body>
    </html>
  );
}
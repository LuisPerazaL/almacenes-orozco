import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title:"Almacenes Orozco — Preview", description:"Pedidos con fotos y alternativas" };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>}

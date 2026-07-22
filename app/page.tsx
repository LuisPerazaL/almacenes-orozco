"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import JSZip from "jszip";
import { supabase } from "@/lib/supabase-browser";
import { CATALOG_IMPORT_ITEMS, CATALOG_IMPORT_LOTS } from "./catalog-import-data";
import "./visual.css";

type Product = { id: number; name: string; sku: string; category: string; stock: number; min: number; price: number };
type AlternativeRow = { id: number; label: string; image_url: string; is_selected: boolean };
type OrderItem = { id: number; productId: number; productName: string; sku: string; quantity: number; reserved: number; presentation: string; notes: string; alternatives: AlternativeRow[] };
type Order = { dbId: number; id: string; customer: string; items: OrderItem[]; date: string; status: "Listo" | "Parcial" | "Pendiente" | "Entregado" | "Cancelado" };
type Alternative = { label: string; imageUrl: string };
type OrderLine = { productId: number; quantity: number; productName?: string; sku?: string; presentation?: string; notes?: string; alternatives?: Alternative[] };
type CatalogImage = { id: number; name: string; category: string; color: string; presentation: string; image_url: string };

const initialProducts: Product[] = [];
const initialOrders: Order[] = [];
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const canonicalZipName = (name: string) => name.replace(/\(\d+\)(?=\.zip$)/i, "");
const catalogSkuFromUrl = (imageUrl: string) => {
  const match = imageUrl.match(/\/catalog\/([A-Z0-9-]+)__[0-9a-f-]+\.(?:jpe?g|png|webp)(?:\?.*)?$/i);
  return match?.[1]?.toUpperCase() ?? "";
};

export default function Home() {
  const [tab, setTab] = useState("Resumen");
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"product" | "order" | "restock" | "delete" | null>(null);
  const [selectedId, setSelectedId] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [catalog, setCatalog] = useState<CatalogImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [galleryLine, setGalleryLine] = useState<number | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!session) { setLoading(false); return; }
    try {
      const [{ data: productRows, error: productError }, { data: orderRows, error: orderError }, { data: catalogRows, error: catalogError }] = await Promise.all([supabase.from("products").select("*").order("name"), supabase.from("orders").select("*, order_items(*, products(name, sku), order_item_alternatives(id,label,image_url,is_selected))").order("created_at", { ascending: false }), supabase.from("visual_catalog").select("id,name,category,color,presentation,image_url").eq("active", true).order("created_at", { ascending: false })]);
      if (productError || orderError || catalogError) throw productError ?? orderError ?? catalogError;
      const nextProducts = (productRows ?? []).map((p) => ({ id: p.id, name: p.name, sku: p.sku, category: p.category, stock: p.stock, min: p.min_stock, price: Number(p.price) }));
      const nextOrders = (orderRows ?? []).map((o) => ({ dbId:o.id, id: `PED-${String(1000 + o.id).padStart(4, "0")}`, customer: o.customer, items: (o.order_items ?? []).map((item: { id:number; product_id:number; quantity:number; reserved_quantity:number; presentation:string|null; notes:string|null; products:{name:string;sku:string} | null; order_item_alternatives:AlternativeRow[]|null }) => ({ id:item.id, productId:item.product_id, productName:item.products?.name ?? "Producto", sku:item.products?.sku ?? "", quantity:item.quantity, reserved:item.reserved_quantity, presentation:item.presentation ?? "", notes:item.notes ?? "", alternatives:item.order_item_alternatives ?? [] })), date: new Date(o.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }), status: o.status as Order["status"] }));
      setProducts(nextProducts); setOrders(nextOrders); setCatalog((catalogRows ?? []) as CatalogImage[]);
      if (nextProducts.length && !nextProducts.some((p: Product) => p.id === selectedId)) setSelectedId(nextProducts[0].id);
    } catch (error) { flash(error instanceof Error ? error.message : "No fue posible cargar el inventario"); }
    finally { setLoading(false); }
  }, [selectedId, session]);

  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => data.subscription.unsubscribe(); }, []);
  useEffect(() => { void loadData(); }, [loadData]);
  async function authenticate(mode: "login" | "signup") { setAuthBusy(true); const result = mode === "login" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password }); setAuthBusy(false); if (result.error) flash(result.error.message); else flash(mode === "login" ? "Sesión iniciada" : "Cuenta creada; revisa tu correo si requiere confirmación"); }

  const lowStock = products.filter((p) => p.stock <= p.min);
  const inventoryValue = products.reduce((sum, p) => sum + p.stock * p.price, 0);
  const filtered = products.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(query.toLowerCase()));
  const shoppingList = orders.filter((o) => !["Entregado","Cancelado"].includes(o.status)).flatMap((o) => o.items.filter((item) => item.reserved < item.quantity).map((item) => ({ ...item, missing:item.quantity-item.reserved }))).reduce<Array<{productId:number;productName:string;sku:string;missing:number}>>((list,item) => { const found=list.find((row)=>row.productId===item.productId); if(found) found.missing+=item.missing; else list.push({productId:item.productId,productName:item.productName,sku:item.sku,missing:item.missing}); return list; },[]);
  const productById = (id: number) => products.find((p) => p.id === id);
  const primaryImageForProduct = (productId: number): Alternative[] => {
    const product = productById(productId);
    if (!product) return [];
    const picture = catalog.find((pic) => catalogSkuFromUrl(pic.image_url) === product.sku.toUpperCase());
    return picture ? [{ label: picture.name, imageUrl: picture.image_url }] : [];
  };
  async function saveProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    const values = { name: String(fd.get("name")).trim(), sku: String(fd.get("sku")).trim().toUpperCase(), category: String(fd.get("category")), stock: Number(fd.get("stock")), min: Number(fd.get("min")), price: Number(fd.get("price")) };
    if (products.some((p) => p.sku.toLowerCase() === values.sku.toLowerCase() && p.id !== editingId)) { flash("Ya existe un producto con ese SKU"); return; }
    try { const row = { name: values.name, sku: values.sku, category: values.category, stock: values.stock, min_stock: values.min, price: values.price, owner_id: session!.user.id }; const result = editingId ? await supabase.from("products").update(row).eq("id", editingId) : await supabase.from("products").insert(row); if (result.error) throw result.error; await loadData(); setEditingId(null); setModal(null); flash(editingId ? "Producto actualizado correctamente" : "Producto agregado correctamente"); }
    catch (error) { flash(error instanceof Error ? error.message : "No fue posible guardar el producto"); }
  }
  function openCreate() { setEditingId(null); setModal("product"); }
  function openEdit(id: number) { setEditingId(id); setSelectedId(id); setModal("product"); }
  function requestDelete(id: number) { setSelectedId(id); setModal("delete"); }
  function openOrder() { const productId=products[0].id; setOrderLines([{ productId, quantity: 1, presentation:"", notes:"", alternatives:primaryImageForProduct(productId) }]); setModal("order"); }
  async function deleteProduct() {
    if (orders.some((o) => o.items.some((item) => item.productId === selectedId))) { setModal(null); flash("No se puede eliminar: el producto tiene pedidos asociados"); return; }
    try { const { error } = await supabase.from("products").delete().eq("id", selectedId); if (error) throw error; await loadData(); setModal(null); flash("Producto eliminado"); }
    catch (error) { setModal(null); flash(error instanceof Error ? error.message : "No fue posible eliminar el producto"); }
  }
  async function createOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const customerInput = e.currentTarget.elements.namedItem("customer") as HTMLInputElement | null;
    if (!orderLines.length || orderLines.some((line) => line.quantity < 1 || (line.productId === 0 && !line.productName?.trim()))) { flash("Completa el nombre y cantidad de cada producto"); return; }
    try { const { error } = await supabase.rpc("create_order_with_options", { p_customer: customerInput?.value.trim() ?? "", p_items: orderLines.map((line) => ({ product_id: line.productId || null, product_name: line.productName?.trim() || null, sku: line.sku?.trim().toUpperCase() || null, quantity: line.quantity, presentation:line.presentation ?? "", notes:line.notes ?? "", alternatives:(line.alternatives ?? []).map(a=>({label:a.label,image_url:a.imageUrl})) })) }); if (error) throw error; await loadData(); setModal(null); flash("Pedido guardado; los productos faltantes se agregaron al inventario"); }
    catch (error) { flash(error instanceof Error ? error.message : "No fue posible crear el pedido"); }
  }
  async function restock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const amount = Number(new FormData(e.currentTarget).get("amount"));
    try { const { error } = await supabase.rpc("restock_and_fulfill", { p_product_id: selectedId, p_amount: amount }); if (error) throw error; await loadData(); setModal(null); flash("Entrada registrada y pedidos pendientes reevaluados"); }
    catch (error) { flash(error instanceof Error ? error.message : "No fue posible registrar la entrada"); }
  }
  async function deliverOrder(orderId: number) { const { error } = await supabase.rpc("deliver_order", { p_order_id:orderId }); if(error) flash(error.message); else { await loadData(); flash("Pedido marcado como entregado"); } }
  async function cancelOrder(orderId: number) { if(!window.confirm("¿Cancelar el pedido y liberar todo el stock apartado?")) return; const { error } = await supabase.rpc("cancel_order", { p_order_id:orderId }); if(error) flash(error.message); else { await loadData(); flash("Pedido cancelado y stock liberado"); } }
  async function uploadCatalogImage(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); try { const form=e.currentTarget,fd=new FormData(form),file=fd.get("image") as File; if(!file?.size) throw new Error("Selecciona una imagen"); const ext=file.name.split(".").pop()||"jpg",path=`${session!.user.id}/${crypto.randomUUID()}.${ext}`; const upload=await supabase.storage.from("order-alternatives").upload(path,file); if(upload.error) throw upload.error; const image_url=supabase.storage.from("order-alternatives").getPublicUrl(path).data.publicUrl; const {error}=await supabase.from("visual_catalog").insert({name:String(fd.get("name")),category:String(fd.get("category")||"Otros"),color:String(fd.get("color")||""),presentation:String(fd.get("presentation")||""),image_url}); if(error) throw error; form.reset(); await loadData(); flash("Imagen agregada al catálogo"); } catch(error) { flash(error instanceof Error?error.message:"No se pudo guardar la imagen"); } finally { setBusy(false); } }
  async function importCatalogBatch() {
    if (!session || busy) return;
    const filesByLot = new Map<string, File>();
    for (const file of importFiles) {
      const lot = CATALOG_IMPORT_LOTS[canonicalZipName(file.name)];
      if (lot && !filesByLot.has(lot)) filesByLot.set(lot, file);
    }
    const missingLots = Object.values(CATALOG_IMPORT_LOTS).filter((lot) => !filesByLot.has(lot));
    if (missingLots.length) { flash(`Faltan ${missingLots.length} ZIP del catálogo`); return; }
    if (!window.confirm("Se crearán hasta 216 variantes con existencia 0 y precio por definir. ¿Continuar?")) return;

    setBusy(true); setImportProgress(0); setImportStatus("Preparando productos...");
    try {
      const ownerId = session.user.id;
      const skus = CATALOG_IMPORT_ITEMS.map((item) => item.sku);
      const { data: existingProducts, error: productQueryError } = await supabase.from("products").select("sku").in("sku", skus);
      if (productQueryError) throw productQueryError;
      const existingSkus = new Set((existingProducts ?? []).map((row) => String(row.sku).toUpperCase()));
      const newProducts = CATALOG_IMPORT_ITEMS.filter((item) => !existingSkus.has(item.sku)).map((item) => ({ owner_id: ownerId, name: item.name, sku: item.sku, category: item.category, stock: 0, min_stock: 1, price: 0 }));
      for (const group of chunk(newProducts, 50)) { const { error } = await supabase.from("products").insert(group); if (error) throw error; }

      const { data: existingCatalog, error: catalogQueryError } = await supabase.from("visual_catalog").select("image_url");
      if (catalogQueryError) throw catalogQueryError;
      const importedSkus = new Set<string>();
      for (const row of existingCatalog ?? []) {
        const match = String(row.image_url).match(/\/catalog\/([A-Z0-9-]+)__[0-9a-f-]+\.(?:jpe?g|png|webp)$/i);
        if (match) importedSkus.add(match[1].toUpperCase());
      }

      let completed = importedSkus.size;
      const pendingTotal = CATALOG_IMPORT_ITEMS.filter((item) => !importedSkus.has(item.sku)).length;
      if (!pendingTotal) { setImportProgress(100); setImportStatus("El catálogo ya estaba completo."); await loadData(); return; }

      for (const lot of [...new Set(CATALOG_IMPORT_ITEMS.map((item) => item.lot))]) {
        const entries = CATALOG_IMPORT_ITEMS.filter((item) => item.lot === lot && !importedSkus.has(item.sku));
        if (!entries.length) continue;
        setImportStatus(`Procesando ${lot.replace("_", " ")}...`);
        const zip = await JSZip.loadAsync(filesByLot.get(lot)!);
        const zipImages = new Map(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => [entry.name.split("/").pop()!, entry]));
        const catalogRows: Array<{owner_id:string;name:string;category:string;color:string;presentation:string;image_url:string}> = [];
        for (const group of chunk(entries, 4)) {
          const rows = await Promise.all(group.map(async (item) => {
            const entry = zipImages.get(item.filename);
            if (!entry) throw new Error(`No se encontró la foto ${item.id} en ${lot}`);
            const blob = await entry.async("blob");
            const extension = item.filename.split(".").pop()?.toLowerCase() || "jpeg";
            const path = `${ownerId}/catalog/${item.sku}__${crypto.randomUUID()}.${extension}`;
            const { error: uploadError } = await supabase.storage.from("order-alternatives").upload(path, blob, { contentType: blob.type || `image/${extension}` });
            if (uploadError) throw uploadError;
            const imageUrl = supabase.storage.from("order-alternatives").getPublicUrl(path).data.publicUrl;
            return { owner_id: ownerId, name: item.family, category: item.category, color: item.variant, presentation: item.presentation, image_url: imageUrl };
          }));
          catalogRows.push(...rows);
          completed += group.length;
          setImportProgress(Math.round((completed / CATALOG_IMPORT_ITEMS.length) * 100));
        }
        for (const group of chunk(catalogRows, 50)) { const { error } = await supabase.from("visual_catalog").insert(group); if (error) throw error; }
      }
      setImportProgress(100); setImportStatus("216 fotografías listas. Precios pendientes de definir."); setImportFiles([]); await loadData(); flash("Catálogo importado correctamente");
    } catch (error) { setImportStatus("La carga se detuvo. Puedes reintentarla sin duplicar lo ya guardado."); flash(error instanceof Error ? error.message : "No se pudo importar el catálogo"); }
    finally { setBusy(false); }
  }
  async function chooseAlternative(itemId:number,alternativeId:number){const {error}=await supabase.rpc("select_order_alternative",{p_item_id:itemId,p_alternative_id:alternativeId});if(error)flash(error.message);else{await loadData();flash("Opción seleccionada");}}
  function toggleCatalogImage(lineIndex:number,pic:CatalogImage){setOrderLines(all=>all.map((line,index)=>{if(index!==lineIndex)return line;const alternatives=line.alternatives??[],exists=alternatives.some(a=>a.imageUrl===pic.image_url);return {...line,alternatives:exists?alternatives.filter(a=>a.imageUrl!==pic.image_url):[...alternatives,{label:pic.name,imageUrl:pic.image_url}]};}));}

  const activeOrders=orders.filter(o=>!["Entregado","Cancelado"].includes(o.status));
  const historyOrders=orders.filter(o=>["Entregado","Cancelado"].includes(o.status));
  const visibleCatalog=catalog.filter(pic=>`${pic.name} ${pic.category} ${pic.color} ${pic.presentation}`.toLowerCase().includes(catalogQuery.toLowerCase()));
  const nav = ["Resumen", "Productos", "Pedidos", "Compras", "Catálogo visual", "Historial"];
  if (!session) return <main className="auth-page"><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark">A</span><div><strong>Almacenes Orozco</strong><small>Inventario en la nube</small></div></div><p className="eyebrow">ACCESO SEGURO</p><h1>Bienvenido</h1><p>Inicia sesión para administrar tus productos y pedidos.</p><label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" /></label><label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} /></label><button className="primary" disabled={authBusy} onClick={() => void authenticate("login")}>Iniciar sesión</button><button className="cancel" disabled={authBusy} onClick={() => void authenticate("signup")}>Crear cuenta</button>{toast && <div className="toast">{toast}</div>}</section></main>;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><div><strong>Almacenes Orozco</strong><small>Control de inventario</small></div></div>
      <nav>{nav.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><span>{item === "Resumen" ? "⌂" : item === "Productos" ? "□" : item === "Pedidos" ? "≡" : "↕"}</span>{item}</button>)}</nav>
      <div className="sidebar-help"><b>¿Todo en orden?</b><p>Revisa las alertas para evitar faltantes.</p><button onClick={() => setTab("Productos")}>Ver inventario</button></div>
      <button className="user user-button" onClick={() => void supabase.auth.signOut()}><span>{session.user.email?.slice(0,2).toUpperCase()}</span><div><b>{session.user.email}</b><small>Cerrar sesión</small></div></button>
    </aside>

    <main>
      <header><div className="mobile-brand">Almacenes Orozco</div><label className="search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto, SKU..." /></label><div className="header-actions"><button className="ghost" onClick={() => { setTab("Productos"); setQuery(""); }}>⌕</button><button className={`primary ${products.length === 0 ? "disabled" : ""}`} onClick={() => products.length ? openOrder() : flash("Primero registra al menos un producto")}>＋ Nuevo pedido</button></div></header>
      <div className="content">
        <section className="page-title"><div><p className="eyebrow">OPERACIÓN DIARIA</p><h1>{tab}</h1><p>{tab === "Resumen" ? "Aquí tienes el estado de tu negocio hoy." : tab === "Productos" ? "Consulta, crea, edita y administra tu inventario." : tab === "Pedidos" ? "Pedidos activos, reservas y entregas." : tab === "Compras" ? "Lista consolidada de productos por abastecer." : tab === "Catálogo visual" ? "Administra las fotografías, modelos y presentaciones disponibles." : "Consulta los pedidos entregados y cancelados."}</p></div>{tab === "Productos" && <button className="primary" onClick={openCreate}>＋ Agregar producto</button>}</section>

        {tab === "Resumen" && <>
          <section className="kpis">
            <article><span className="kpi-icon green">□</span><div><small>Productos activos</small><strong>{products.length}</strong><em>Catálogo actualizado</em></div></article>
            <article><span className="kpi-icon coral">!</span><div><small>Stock bajo</small><strong>{lowStock.length}</strong><em>Requieren atención</em></div></article>
            <article><span className="kpi-icon orange">≡</span><div><small>Pedidos registrados</small><strong>{orders.length}</strong><em>Historial total</em></div></article>
            <article><span className="kpi-icon blue">$</span><div><small>Valor del inventario</small><strong>{money.format(inventoryValue)}</strong><em>Stock disponible</em></div></article>
          </section>
          <section className="dashboard-grid">
            <article className="panel"><div className="panel-head"><div><h2>Productos con stock bajo</h2><p>Prioriza el reabastecimiento de estos artículos.</p></div><button className="link" onClick={() => setTab("Productos")}>Ver todos →</button></div>
              <div className="stock-list">{lowStock.map((p) => <div className="stock-row" key={p.id}><div className="product-symbol">{p.name.slice(0,2).toUpperCase()}</div><div className="stock-info"><b>{p.name}</b><small>{p.sku} · Mínimo {p.min}</small><div className="bar"><i style={{ width: `${Math.min(100, p.stock / p.min * 100)}%` }} /></div></div><div className="stock-count"><strong>{p.stock}</strong><small>unidades</small></div><button className="restock" onClick={() => { setSelectedId(p.id); setModal("restock"); }}>Reabastecer</button></div>)}{products.length === 0 && <div className="empty-state compact"><b>Tu inventario está vacío</b><p>Registra tu primer producto para comenzar.</p><button className="primary" onClick={() => { setTab("Productos"); openCreate(); }}>＋ Agregar producto</button></div>}</div>
            </article>
            <article className="panel orders-panel"><div className="panel-head"><div><h2>Pedidos recientes</h2><p>Últimas listas solicitadas.</p></div></div>{orders.slice(0,4).map((o) => <div className="order-mini" key={o.id}><span>{o.customer.split(" ").map(x => x[0]).join("")}</span><div><b>{o.customer}</b><small>{o.id} · {o.items.length} productos</small></div><div><strong>{o.status}</strong><small>{o.date}</small></div></div>)}<button className="wide-link" onClick={() => setTab("Pedidos")}>Ver todos los pedidos</button></article>
          </section>
        </>}

        {tab === "Productos" && <section className="panel table-panel"><div className="toolbar"><label className="search inner">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en el catálogo" /></label><span>{filtered.length} productos</span></div><div className="table-wrap"><table><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filtered.map((p) => <tr key={p.id}><td><b>{p.name}</b><small>{p.sku}</small></td><td>{p.category}</td><td>{p.price > 0 ? money.format(p.price) : <span className="price-pending">Por definir</span>}</td><td><b>{p.stock}</b> un.<small>Mínimo: {p.min}</small></td><td><span className={`status ${p.stock <= p.min ? "danger" : "ok"}`}>{p.stock <= p.min ? "Stock bajo" : "Disponible"}</span></td><td><div className="row-actions"><button className="restock" onClick={() => { setSelectedId(p.id); setModal("restock"); }}>＋ Entrada</button><button className="icon-action edit" onClick={() => openEdit(p.id)}>Editar</button><button className="icon-action remove" onClick={() => requestDelete(p.id)}>Eliminar</button></div></td></tr>)}</tbody></table></div>{filtered.length === 0 && <div className="empty-state"><b>No encontramos productos</b><p>Prueba otra búsqueda o agrega un producto nuevo.</p><button className="primary" onClick={openCreate}>＋ Agregar producto</button></div>}</section>}

        {tab === "Pedidos" && <section className="panel table-panel"><div className="toolbar"><h2>Pedidos activos</h2><span>{activeOrders.length} registros</span></div><div className="table-wrap"><table><thead><tr><th>Folio</th><th>Cliente</th><th>Lista solicitada</th><th>Por abastecer</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{activeOrders.map((o) => <tr key={o.id}><td><b>{o.id}</b><small>{o.date}</small></td><td>{o.customer}</td><td>{o.items.map((item) => <div className="order-item-detail" key={item.id}><small><b>{item.quantity}×</b> {item.productName} <em>({item.reserved} apartados)</em></small>{(item.presentation||item.notes)&&<small>{[item.presentation,item.notes].filter(Boolean).join(" · ")}</small>} {!!item.alternatives.length&&<div className="mini-thumbs">{item.alternatives.map(a=><button className={a.is_selected?"selected":""} key={a.id} onClick={()=>void chooseAlternative(item.id,a.id)}><img src={a.image_url} alt={a.label}/></button>)}</div>}</div>)}</td><td>{o.items.filter((item) => item.reserved < item.quantity).map((item) => <small className="shortage" key={item.id}>⚠ {item.productName}: faltan {item.quantity - item.reserved}</small>)}{o.status==="Listo" && <span className="status ok">Sin faltantes</span>}</td><td><span className={`status ${o.status === "Listo" ? "ok" : o.status === "Parcial" ? "warning" : "danger"}`}>{o.status}</span></td><td><div className="row-actions">{o.status === "Listo" && <button className="icon-action edit" onClick={() => void deliverOrder(o.dbId)}>Entregar</button>}<button className="icon-action remove" onClick={() => void cancelOrder(o.dbId)}>Cancelar</button></div></td></tr>)}</tbody></table></div>{!activeOrders.length&&<div className="empty-state"><b>No hay pedidos activos</b><p>Los pedidos entregados y cancelados se conservan en Historial.</p></div>}</section>}
        {tab === "Compras" && <section className="panel table-panel"><div className="toolbar"><div><h2>Lista para surtir</h2><small>Consolidada desde todos los pedidos activos</small></div><span>{shoppingList.length} productos</span></div><div className="table-wrap"><table><thead><tr><th>Producto</th><th>SKU</th><th>Cantidad faltante</th><th>Acción</th></tr></thead><tbody>{shoppingList.map((item) => <tr key={item.productId}><td><b>{item.productName}</b></td><td>{item.sku}</td><td><strong className="missing-count">{item.missing} unidades</strong></td><td><button className="restock" onClick={() => {setSelectedId(item.productId);setModal("restock")}}>＋ Registrar compra</button></td></tr>)}</tbody></table></div>{shoppingList.length===0 && <div className="empty-state"><b>No hay productos pendientes</b><p>Todos los pedidos activos tienen sus existencias apartadas.</p></div>}</section>}
        {tab === "Catálogo visual" && <section><article className="panel bulk-import"><div><p className="eyebrow">CARGA MASIVA</p><h2>Importar catálogo completo</h2><p>Selecciona los 8 ZIP originales. La app relacionará las 216 fotos con sus variantes y SKU; los precios quedarán por definir.</p></div><label className="zip-picker"><input type="file" multiple accept=".zip,application/zip" disabled={busy} onChange={(event)=>setImportFiles(Array.from(event.target.files ?? []))}/><span>{importFiles.length ? `${importFiles.length} ZIP seleccionados` : "Seleccionar los 8 ZIP"}</span></label><button className="primary" disabled={busy||!importFiles.length} onClick={()=>void importCatalogBatch()}>{busy&&importStatus?"Importando...":"Importar 216 fotos"}</button>{(importStatus||importProgress>0)&&<div className="import-progress"><div><i style={{width:`${importProgress}%`}}/></div><small>{importStatus} {importProgress>0?`${importProgress}%`:""}</small></div>}</article><form className="panel catalog-form" onSubmit={uploadCatalogImage}><input name="name" required placeholder="Nombre o modelo"/><input name="category" placeholder="Categoría"/><input name="color" placeholder="Color"/><input name="presentation" placeholder="Medida o presentación"/><input name="image" required type="file" accept="image/*"/><button className="primary" disabled={busy}>{busy?"Guardando...":"＋ Agregar imagen"}</button></form><label className="catalog-search">⌕<input value={catalogQuery} onChange={e=>setCatalogQuery(e.target.value)} placeholder="Buscar por modelo, color o medida..."/></label><div className="catalog-grid">{visibleCatalog.map(pic=><button className="catalog-card" key={pic.id} onClick={()=>setLightbox(pic.image_url)}><img src={pic.image_url} alt={pic.name}/><strong>{pic.name}</strong><small>{[pic.color,pic.presentation].filter(Boolean).join(" · ")||pic.category}</small></button>)}</div>{!visibleCatalog.length&&<div className="panel empty-state"><b>No hay imágenes en el catálogo</b><p>Agrega la primera fotografía para comenzar.</p></div>}</section>}
        {tab === "Historial" && <section className="panel table-panel"><div className="toolbar"><h2>Pedidos finalizados</h2><span>{historyOrders.length} registros</span></div><div className="table-wrap"><table><thead><tr><th>Folio</th><th>Cliente</th><th>Productos</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>{historyOrders.map(o=><tr key={o.id}><td><b>{o.id}</b></td><td>{o.customer}</td><td>{o.items.map(item=><small key={item.id}><b>{item.quantity}×</b> {item.productName}</small>)}</td><td>{o.date}</td><td><span className={`status ${o.status==="Entregado"?"ok":"neutral"}`}>{o.status}</span></td></tr>)}</tbody></table></div>{!historyOrders.length&&<div className="empty-state"><b>El historial está vacío</b><p>Los pedidos entregados y cancelados aparecerán aquí sin borrarse.</p></div>}</section>}
      </div>
    </main>

    {modal && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setModal(null)}>×</button>
      {modal === "product" && <form onSubmit={saveProduct}><p className="eyebrow">{editingId ? "EDITAR REGISTRO" : "NUEVO REGISTRO"}</p><h2>{editingId ? "Editar producto" : "Agregar producto"}</h2><p>{editingId ? "Actualiza la información del producto seleccionado." : "Completa los datos para incorporarlo al catálogo."}</p><div className="form-grid"><label>Nombre<input name="name" required placeholder="Ej. Vaso térmico" defaultValue={editingId ? productById(editingId)?.name : ""} /></label><label>SKU<input name="sku" required placeholder="VAS-012" defaultValue={editingId ? productById(editingId)?.sku : ""} /></label><label>Categoría<select name="category" defaultValue={editingId ? productById(editingId)?.category : "Otros"}><option>Recámara</option><option>Almohadas</option><option>Hogar</option><option>Lavandería</option><option>Baño</option><option>Cortinas</option><option>Sala</option><option>Consumibles</option><option>Empaque</option><option>Accesorios</option><option>Otros</option></select></label><label>Precio<input name="price" required min="0" step="0.01" type="number" defaultValue={editingId ? productById(editingId)?.price : ""} /></label><label>Stock actual<input name="stock" required min="0" type="number" defaultValue={editingId ? productById(editingId)?.stock : ""} /></label><label>Stock mínimo<input name="min" required min="0" type="number" defaultValue={editingId ? productById(editingId)?.min : ""} /></label></div><button className="primary submit">{editingId ? "Guardar cambios" : "Guardar producto"}</button></form>}
      {modal === "order" && <form onSubmit={createOrder}><p className="eyebrow">NUEVO PEDIDO</p><h2>Lista de productos</h2><p>Se apartará el stock disponible. Puedes añadir medidas, indicaciones y referencias visuales.</p><label>Cliente<input name="customer" required placeholder="Nombre del cliente" /></label><div className="order-lines">{orderLines.map((line, index) => { const item = productById(line.productId); const shortage = Math.max(0, line.quantity - (item?.stock ?? 0)); return <div className={`order-line ${line.productId === 0 ? "new-product-line" : ""}`} key={index}><label>Producto<select value={line.productId} onChange={(e) => { const productId=Number(e.target.value); setOrderLines((all) => all.map((row,i) => i === index ? {...row,productId,productName:"",sku:"",alternatives:primaryImageForProduct(productId)} : row)); }}><option value={0}>＋ Producto no registrado</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock} disponibles</option>)}</select></label><label>Cantidad<input min="1" type="number" value={line.quantity} onChange={(e) => setOrderLines((all) => all.map((row,i) => i === index ? {...row,quantity:Number(e.target.value)} : row))} /></label>{orderLines.length > 1 && <button type="button" className="remove-line" onClick={() => setOrderLines((all) => all.filter((_,i) => i !== index))}>×</button>}{line.productId === 0 && <div className="new-product-fields"><label>Nombre del producto<input required value={line.productName ?? ""} onChange={(e) => setOrderLines((all) => all.map((row,i) => i === index ? {...row,productName:e.target.value} : row))} placeholder="Ej. Cortina blackout" /></label><label>SKU opcional<input value={line.sku ?? ""} onChange={(e) => setOrderLines((all) => all.map((row,i) => i === index ? {...row,sku:e.target.value} : row))} placeholder="Se genera automáticamente" /></label></div>}<div className="new-product-fields"><label>Presentación / medida<input value={line.presentation ?? ""} onChange={e=>setOrderLines(all=>all.map((row,i)=>i===index?{...row,presentation:e.target.value}:row))} placeholder="Ej. Matrimonial"/></label><label>Observaciones<input value={line.notes ?? ""} onChange={e=>setOrderLines(all=>all.map((row,i)=>i===index?{...row,notes:e.target.value}:row))} placeholder="Color, modelo o indicaciones"/></label></div>{!!line.alternatives?.length&&<div className="selected-pics">{line.alternatives.map(a=><button type="button" key={a.imageUrl} onClick={()=>setLightbox(a.imageUrl)}><img src={a.imageUrl} alt={a.label}/><span>{a.label}</span></button>)}</div>}<button type="button" className="gallery-button" onClick={()=>{setGalleryLine(index);setCatalogQuery("")}}>▦ Elegir del catálogo ({line.alternatives?.length??0})</button><small className="line-alert">⚠ Faltan {shortage}; se agregará a abastecimiento</small></div>})}</div><button type="button" className="add-line" onClick={() => { const productId=products[0]?.id ?? 0; setOrderLines((all) => [...all,{productId,quantity:1,presentation:"",notes:"",alternatives:primaryImageForProduct(productId)}]); }}>＋ Agregar otro producto</button><button className="primary submit">Guardar pedido</button></form>}
      {modal === "restock" && <form onSubmit={restock}><p className="eyebrow">ENTRADA DE INVENTARIO</p><h2>Reabastecer producto</h2><p><b>{productById(selectedId)?.name}</b><br />Stock actual: {productById(selectedId)?.stock} unidades</p><label>Unidades a ingresar<input name="amount" required autoFocus min="1" type="number" defaultValue="10" /></label><button className="primary submit">Registrar entrada</button></form>}
      {modal === "delete" && <div className="delete-confirm"><span className="delete-icon">!</span><p className="eyebrow">CONFIRMAR ELIMINACIÓN</p><h2>¿Eliminar producto?</h2><p>Vas a eliminar <b>{productById(selectedId)?.name}</b>. Esta acción no se puede deshacer. Los productos con pedidos asociados se conservarán para proteger el historial.</p><div className="confirm-actions"><button className="cancel" onClick={() => setModal(null)}>Cancelar</button><button className="delete-button" onClick={deleteProduct}>Sí, eliminar</button></div></div>}
    </div></div>}
    {galleryLine !== null && <div className="modal-backdrop gallery-backdrop"><section className="gallery-modal"><button className="modal-close" onClick={()=>setGalleryLine(null)}>×</button><p className="eyebrow">CATÁLOGO VISUAL</p><h2>Elige las referencias</h2><label className="catalog-search">⌕<input value={catalogQuery} onChange={e=>setCatalogQuery(e.target.value)} placeholder="Buscar por modelo, color o medida..."/></label><div className="gallery-grid">{visibleCatalog.map(pic=>{const selected=(orderLines[galleryLine]?.alternatives??[]).some(a=>a.imageUrl===pic.image_url);return <article className={selected?"gallery-pic selected":"gallery-pic"} key={pic.id}><button className="zoom" onClick={()=>setLightbox(pic.image_url)}><img src={pic.image_url} alt={pic.name}/></button><strong>{pic.name}</strong><small>{[pic.color,pic.presentation].filter(Boolean).join(" · ")||pic.category}</small><button className="select-pic" onClick={()=>toggleCatalogImage(galleryLine,pic)}>{selected?"✓ Seleccionada":"Seleccionar"}</button></article>})}</div><button className="primary gallery-done" onClick={()=>setGalleryLine(null)}>Listo, usar seleccionadas</button></section></div>}
    {lightbox && <div className="lightbox" onClick={()=>setLightbox(null)}><button>×</button><img src={lightbox} alt="Vista ampliada"/></div>}
    {toast && <div className="toast">✓ {toast}</div>}
  </div>;
}

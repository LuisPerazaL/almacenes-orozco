"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";

type Product = { id: number; name: string; sku: string; category: string; stock: number; min: number; price: number };
type OrderItem = { id: number; productId: number; productName: string; sku: string; quantity: number; reserved: number };
type Order = { id: string; customer: string; items: OrderItem[]; date: string; status: "Completado" | "Parcial" | "Pendiente" };
type OrderLine = { productId: number; quantity: number; productName?: string; sku?: string };

const initialProducts: Product[] = [];
const initialOrders: Order[] = [];
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

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
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!session) { setLoading(false); return; }
    try {
      const [{ data: productRows, error: productError }, { data: orderRows, error: orderError }] = await Promise.all([supabase.from("products").select("*").order("name"), supabase.from("orders").select("*, order_items(*, products(name, sku))").order("created_at", { ascending: false })]);
      if (productError || orderError) throw productError ?? orderError;
      const nextProducts = (productRows ?? []).map((p) => ({ id: p.id, name: p.name, sku: p.sku, category: p.category, stock: p.stock, min: p.min_stock, price: Number(p.price) }));
      const nextOrders = (orderRows ?? []).map((o) => ({ id: `PED-${String(1000 + o.id).padStart(4, "0")}`, customer: o.customer, items: (o.order_items ?? []).map((item: { id:number; product_id:number; quantity:number; reserved_quantity:number; products:{name:string;sku:string} | null }) => ({ id:item.id, productId:item.product_id, productName:item.products?.name ?? "Producto", sku:item.products?.sku ?? "", quantity:item.quantity, reserved:item.reserved_quantity })), date: new Date(o.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }), status: o.status as "Completado" | "Parcial" | "Pendiente" }));
      setProducts(nextProducts); setOrders(nextOrders);
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
  const productById = (id: number) => products.find((p) => p.id === id);
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
  function openOrder() { setOrderLines([{ productId: products[0].id, quantity: 1 }]); setModal("order"); }
  async function deleteProduct() {
    if (orders.some((o) => o.items.some((item) => item.productId === selectedId))) { setModal(null); flash("No se puede eliminar: el producto tiene pedidos asociados"); return; }
    try { const { error } = await supabase.from("products").delete().eq("id", selectedId); if (error) throw error; await loadData(); setModal(null); flash("Producto eliminado"); }
    catch (error) { setModal(null); flash(error instanceof Error ? error.message : "No fue posible eliminar el producto"); }
  }
  async function createOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    if (!orderLines.length || orderLines.some((line) => line.quantity < 1 || (line.productId === 0 && !line.productName?.trim()))) { flash("Completa el nombre y cantidad de cada producto"); return; }
    try { const { error } = await supabase.rpc("create_order", { p_customer: String(fd.get("customer")), p_items: orderLines.map((line) => ({ product_id: line.productId || null, product_name: line.productName?.trim() || null, sku: line.sku?.trim().toUpperCase() || null, quantity: line.quantity })) }); if (error) throw error; await loadData(); setModal(null); flash("Pedido guardado; los productos faltantes se agregaron al inventario"); }
    catch (error) { flash(error instanceof Error ? error.message : "No fue posible crear el pedido"); }
  }
  async function restock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const amount = Number(new FormData(e.currentTarget).get("amount"));
    try { const { error } = await supabase.rpc("restock_and_fulfill", { p_product_id: selectedId, p_amount: amount }); if (error) throw error; await loadData(); setModal(null); flash("Entrada registrada y pedidos pendientes reevaluados"); }
    catch (error) { flash(error instanceof Error ? error.message : "No fue posible registrar la entrada"); }
  }

  const nav = ["Resumen", "Productos", "Pedidos", "Movimientos"];
  if (!session) return <main className="auth-page"><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark">A</span><div><strong>Almacenes Orozco</strong><small>Inventario en la nube</small></div></div><p className="eyebrow">ACCESO SEGURO</p><h1>Bienvenido</h1><p>Inicia sesión para administrar tus productos y pedidos.</p><label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" /></label><label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} /></label><button className="primary" disabled={authBusy} onClick={() => void authenticate("login")}>Iniciar sesión</button><button className="cancel" disabled={authBusy} onClick={() => void authenticate("signup")}>Crear cuenta</button>{toast && <div className="toast">{toast}</div>}</section></main>;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><div><strong>Almacén</strong><small>Control de inventario</small></div></div>
      <nav>{nav.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><span>{item === "Resumen" ? "⌂" : item === "Productos" ? "□" : item === "Pedidos" ? "≡" : "↕"}</span>{item}</button>)}</nav>
      <div className="sidebar-help"><b>¿Todo en orden?</b><p>Revisa las alertas para evitar faltantes.</p><button onClick={() => setTab("Productos")}>Ver inventario</button></div>
      <button className="user user-button" onClick={() => void supabase.auth.signOut()}><span>{session.user.email?.slice(0,2).toUpperCase()}</span><div><b>{session.user.email}</b><small>Cerrar sesión</small></div></button>
    </aside>

    <main>
      <header><div className="mobile-brand">Almacén</div><label className="search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto, SKU..." /></label><div className="header-actions"><button className="ghost" onClick={() => { setTab("Productos"); setQuery(""); }}>⌕</button><button className={`primary ${products.length === 0 ? "disabled" : ""}`} onClick={() => products.length ? openOrder() : flash("Primero registra al menos un producto")}>＋ Nuevo pedido</button></div></header>
      <div className="content">
        <section className="page-title"><div><p className="eyebrow">OPERACIÓN DIARIA</p><h1>{tab}</h1><p>{tab === "Resumen" ? "Aquí tienes el estado de tu negocio hoy." : tab === "Productos" ? "Consulta, crea, edita y administra tu catálogo." : tab === "Pedidos" ? "Pedidos recientes y consumo de inventario." : "Historial consolidado de entradas y salidas."}</p></div>{tab === "Productos" && <button className="primary" onClick={openCreate}>＋ Agregar producto</button>}</section>

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

        {tab === "Productos" && <section className="panel table-panel"><div className="toolbar"><label className="search inner">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en el catálogo" /></label><span>{filtered.length} productos</span></div><div className="table-wrap"><table><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filtered.map((p) => <tr key={p.id}><td><b>{p.name}</b><small>{p.sku}</small></td><td>{p.category}</td><td>{money.format(p.price)}</td><td><b>{p.stock}</b> un.<small>Mínimo: {p.min}</small></td><td><span className={`status ${p.stock <= p.min ? "danger" : "ok"}`}>{p.stock <= p.min ? "Stock bajo" : "Disponible"}</span></td><td><div className="row-actions"><button className="restock" onClick={() => { setSelectedId(p.id); setModal("restock"); }}>＋ Entrada</button><button className="icon-action edit" onClick={() => openEdit(p.id)}>Editar</button><button className="icon-action remove" onClick={() => requestDelete(p.id)}>Eliminar</button></div></td></tr>)}</tbody></table></div>{filtered.length === 0 && <div className="empty-state"><b>No encontramos productos</b><p>Prueba otra búsqueda o agrega un producto nuevo.</p><button className="primary" onClick={openCreate}>＋ Agregar producto</button></div>}</section>}

        {(tab === "Pedidos" || tab === "Movimientos") && <section className="panel table-panel"><div className="toolbar"><h2>{tab === "Pedidos" ? "Todos los pedidos" : "Reservas y faltantes"}</h2><span>{orders.length} registros</span></div><div className="table-wrap"><table><thead><tr><th>Folio</th><th>Cliente</th><th>Lista solicitada</th><th>Por abastecer</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>{orders.map((o) => <tr key={o.id}><td><b>{o.id}</b></td><td>{o.customer}</td><td>{o.items.map((item) => <small key={item.id}><b>{item.quantity}×</b> {item.productName} <em>({item.reserved} apartados)</em></small>)}</td><td>{o.items.filter((item) => item.reserved < item.quantity).map((item) => <small className="shortage" key={item.id}>⚠ {item.productName}: faltan {item.quantity - item.reserved}</small>)}{o.status === "Completado" && <span className="status ok">Sin faltantes</span>}</td><td>{o.date}</td><td><span className={`status ${o.status === "Completado" ? "ok" : o.status === "Parcial" ? "warning" : "danger"}`}>{o.status}</span></td></tr>)}</tbody></table></div></section>}
      </div>
    </main>

    {modal && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setModal(null)}>×</button>
      {modal === "product" && <form onSubmit={saveProduct}><p className="eyebrow">{editingId ? "EDITAR REGISTRO" : "NUEVO REGISTRO"}</p><h2>{editingId ? "Editar producto" : "Agregar producto"}</h2><p>{editingId ? "Actualiza la información del producto seleccionado." : "Completa los datos para incorporarlo al catálogo."}</p><div className="form-grid"><label>Nombre<input name="name" required placeholder="Ej. Vaso térmico" defaultValue={editingId ? productById(editingId)?.name : ""} /></label><label>SKU<input name="sku" required placeholder="VAS-012" defaultValue={editingId ? productById(editingId)?.sku : ""} /></label><label>Categoría<select name="category" defaultValue={editingId ? productById(editingId)?.category : "Consumibles"}><option>Consumibles</option><option>Empaque</option><option>Accesorios</option><option>Otros</option></select></label><label>Precio<input name="price" required min="0" step="0.01" type="number" defaultValue={editingId ? productById(editingId)?.price : ""} /></label><label>Stock actual<input name="stock" required min="0" type="number" defaultValue={editingId ? productById(editingId)?.stock : ""} /></label><label>Stock mínimo<input name="min" required min="0" type="number" defaultValue={editingId ? productById(editingId)?.min : ""} /></label></div><button className="primary submit">{editingId ? "Guardar cambios" : "Guardar producto"}</button></form>}
      {modal === "order" && <form onSubmit={createOrder}><p className="eyebrow">NUEVO PEDIDO</p><h2>Lista de productos</h2><p>Se apartará el stock disponible. También puedes pedir artículos que aún no estén registrados.</p><label>Cliente<input name="customer" required placeholder="Nombre del cliente" /></label><div className="order-lines">{orderLines.map((line, index) => { const item = productById(line.productId); const shortage = Math.max(0, line.quantity - (item?.stock ?? 0)); return <div className={`order-line ${line.productId === 0 ? "new-product-line" : ""}`} key={index}><label>Producto<select value={line.productId} onChange={(e) => setOrderLines((all) => all.map((row,i) => i === index ? {...row,productId:Number(e.target.value),productName:"",sku:""} : row))}><option value={0}>＋ Producto no registrado</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock} disponibles</option>)}</select></label><label>Cantidad<input min="1" type="number" value={line.quantity} onChange={(e) => setOrderLines((all) => all.map((row,i) => i === index ? {...row,quantity:Number(e.target.value)} : row))} /></label>{orderLines.length > 1 && <button type="button" className="remove-line" onClick={() => setOrderLines((all) => all.filter((_,i) => i !== index))}>×</button>}{line.productId === 0 && <div className="new-product-fields"><label>Nombre del producto<input required value={line.productName ?? ""} onChange={(e) => setOrderLines((all) => all.map((row,i) => i === index ? {...row,productName:e.target.value} : row))} placeholder="Ej. Chocolate en polvo" /></label><label>SKU opcional<input value={line.sku ?? ""} onChange={(e) => setOrderLines((all) => all.map((row,i) => i === index ? {...row,sku:e.target.value} : row))} placeholder="Se genera automáticamente" /></label></div>}<small className="line-alert">⚠ Faltan {shortage}; se agregará a abastecimiento</small></div>})}</div><button type="button" className="add-line" onClick={() => setOrderLines((all) => [...all,{productId:products[0]?.id ?? 0,quantity:1}])}>＋ Agregar otro producto</button><button className="primary submit">Guardar pedido</button></form>}
      {modal === "restock" && <form onSubmit={restock}><p className="eyebrow">ENTRADA DE INVENTARIO</p><h2>Reabastecer producto</h2><p><b>{productById(selectedId)?.name}</b><br />Stock actual: {productById(selectedId)?.stock} unidades</p><label>Unidades a ingresar<input name="amount" required autoFocus min="1" type="number" defaultValue="10" /></label><button className="primary submit">Registrar entrada</button></form>}
      {modal === "delete" && <div className="delete-confirm"><span className="delete-icon">!</span><p className="eyebrow">CONFIRMAR ELIMINACIÓN</p><h2>¿Eliminar producto?</h2><p>Vas a eliminar <b>{productById(selectedId)?.name}</b>. Esta acción no se puede deshacer. Los productos con pedidos asociados se conservarán para proteger el historial.</p><div className="confirm-actions"><button className="cancel" onClick={() => setModal(null)}>Cancelar</button><button className="delete-button" onClick={deleteProduct}>Sí, eliminar</button></div></div>}
    </div></div>}
    {toast && <div className="toast">✓ {toast}</div>}
  </div>;
}

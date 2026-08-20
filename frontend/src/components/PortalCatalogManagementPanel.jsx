import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  useCatalogCollectionMutation,
  useCatalogCollectionsQuery,
  useCatalogManagementMutation,
  useCatalogManagementQuery,
} from "../hooks/useCatalogManagementQueries";
import Modal from "./Modal";
import PortalToast from "./PortalToast";

const emptyForm = {
  variantRef: "",
  handle: "",
  title: "",
  priceAmount: "",
  sku: "",
  description: "",
  collectionId: "",
  images: [],
  existingImages: [],
  removedImageIds: [],
  imageOrder: [],
};

function readPositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default function PortalCatalogManagementPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingProduct, setEditingProduct] = useState(null);
  const [isProductFormOpen, setIsProductFormOpen] = useState(false);
  const [isCollectionFormOpen, setIsCollectionFormOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState(null);
  const [collectionForm, setCollectionForm] = useState({ handle: "", title: "", description: "", sortOrder: 0 });
  const [stockTarget, setStockTarget] = useState(null);
  const [stockDelta, setStockDelta] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [initialForm, setInitialForm] = useState(emptyForm);
  const [imageError, setImageError] = useState("");
  const [toast, setToast] = useState(null);
  const search = searchParams.get("search") || "";
  const activeParam = searchParams.get("active");
  const isActive = activeParam === null ? undefined : activeParam === "true";
  const page = readPositiveInt(searchParams.get("page"));
  const catalogQuery = useCatalogManagementQuery({ search, isActive, page });
  const mutation = useCatalogManagementMutation();
  const collectionsQuery = useCatalogCollectionsQuery();
  const collectionMutation = useCatalogCollectionMutation();
  const products = catalogQuery.data?.results || [];
  const collections = collectionsQuery.data?.results || [];
  const totalCount = Number(
    catalogQuery.data?.total_count ||
      catalogQuery.data?.totalCount ||
      products.length,
  );
  const totalPages = Math.max(
    1,
    Number(
      catalogQuery.data?.total_pages || catalogQuery.data?.totalPages || 1,
    ),
  );
  const pageSize = Number(
    catalogQuery.data?.page_size || catalogQuery.data?.pageSize || 50,
  );
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(totalCount, rangeStart + products.length - 1);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function updateQuery(next) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      Object.entries(next).forEach(([key, value]) => {
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, String(value));
      });
      return params;
    });
  }

  function openCreate() {
    setEditingProduct(null);
    setForm(emptyForm);
    setInitialForm(emptyForm);
    setImageError("");
    setIsProductFormOpen(true);
  }

  function openCreateCollection() {
    setEditingCollection(null);
    setCollectionForm({ handle: "", title: "", description: "", sortOrder: 0 });
    setIsCollectionFormOpen(true);
  }

  function openEditCollection(collection) {
    setEditingCollection(collection);
    setCollectionForm({
      handle: collection.handle || "",
      title: collection.title || "",
      description: collection.description || "",
      sortOrder: collection.sortOrder || 0,
    });
    setIsCollectionFormOpen(true);
  }

  function submitCollection(event) {
    event.preventDefault();
    collectionMutation.mutate(
      {
        collectionId: editingCollection?.id,
        action: editingCollection ? "update" : "create",
        payload: collectionForm,
      },
      {
        onSuccess: () => {
          setIsCollectionFormOpen(false);
          setEditingCollection(null);
          setToast({
            title: editingCollection ? "Collection updated" : "Collection created",
            message: `${collectionForm.title} is ready.`,
          });
        },
      },
    );
  }

  function openEdit(product) {
    const existingImages = Array.isArray(product.images)
      ? product.images.map((image) => ({ ...image }))
      : [];
    setEditingProduct(product);
    const nextForm = {
      variantRef: product.variantRef,
      handle: product.handle,
      title: product.title,
      priceAmount: product.priceAmount,
      sku: product.sku || "",
      description: product.description || "",
      collectionId: product.collectionId || "",
      images: [],
      existingImages,
      removedImageIds: [],
      imageOrder: existingImages.map((image) => image.id),
    };
    setForm(nextForm);
    setInitialForm(nextForm);
    setImageError("");
    setIsProductFormOpen(true);
  }

  function submit(event) {
    event.preventDefault();
    if (imageError) return;
    mutation.mutate(
      {
        productId: editingProduct?.id,
        action: editingProduct ? "update" : "create",
        payload: form,
      },
      {
        onSuccess: (product) => {
          setForm(emptyForm);
          setEditingProduct(null);
          setIsProductFormOpen(false);
          setToast({
            title: editingProduct ? "Product updated" : "Product created",
            message: `${product?.title || "Product"} is ready.`,
          });
        },
      },
    );
  }

  function selectImages(event) {
    const files = Array.from(event.target.files || []);
    const invalid = files.find(
      (file) =>
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) {
      setImageError(
        "Images must be PNG, JPG, JPEG, or WEBP files no larger than 10MB.",
      );
      return;
    }
    setImageError("");
    setForm((current) => ({ ...current, images: files }));
  }

  function moveImage(index, direction) {
    setForm((current) => {
      const next = [...current.existingImages];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return {
        ...current,
        existingImages: next,
        imageOrder: next.map((image) => image.id),
      };
    });
  }

  function adjustStock(event) {
    event.preventDefault();
    const delta = Number(stockDelta);
    if (!Number.isInteger(delta) || delta === 0 || !stockReason.trim()) return;
    mutation.mutate(
      {
        productId: stockTarget.id,
        action: "stock",
        payload: { delta, reason: stockReason.trim() },
      },
      {
        onSuccess: () => {
          setToast({
            title: "Stock updated",
            message: `${stockTarget.title} stock was adjusted.`,
          });
          setStockTarget(null);
          setStockDelta("");
          setStockReason("");
        },
      },
    );
  }

  const visibleFormImages = useMemo(
    () => form.existingImages || [],
    [form.existingImages],
  );
  const newImagePreviews = useMemo(
    () => form.images.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [form.images],
  );

  useEffect(
    () => () => {
      newImagePreviews.forEach(({ url }) => URL.revokeObjectURL(url));
    },
    [newImagePreviews],
  );
  const formDirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  function closeProductForm() {
    if (formDirty && !window.confirm("Discard unsaved product changes?"))
      return;
    setIsProductFormOpen(false);
    setEditingProduct(null);
  }

  return (
    <>
      <PortalToast toast={toast} onClose={() => setToast(null)} />
      <section
        aria-labelledby="catalog-management-heading"
        className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
      >
        <div className="border-b border-slate-200 pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Store structure</p>
              <h2 className="mt-1 text-2xl font-extrabold text-[#123A7A]">Store collections</h2>
              <p className="mt-1 text-sm text-slate-600">Group products into customer-facing collections.</p>
            </div>
            <button type="button" onClick={openCreateCollection} className="min-h-11 rounded-md border border-[#123A7A] px-4 py-2 text-sm font-semibold text-[#123A7A]">
              Add collection
            </button>
          </div>
          {collectionMutation.isError && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{collectionMutation.error?.message || "Collection update failed."}</p>}
          {collectionsQuery.isError && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{collectionsQuery.error?.message || "Collections could not be loaded."}</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <article key={collection.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-[#123A7A]">{collection.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">/{collection.handle} · {collection.productCount} products</p>
                  </div>
                  <span className={`text-xs font-semibold ${collection.isActive ? "text-emerald-700" : "text-slate-500"}`}>{collection.isActive ? "Active" : "Archived"}</span>
                </div>
                {collection.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{collection.description}</p>}
                <div className="mt-4 flex gap-3">
                  <button type="button" onClick={() => openEditCollection(collection)} className="text-sm font-semibold text-[#123A7A]">Edit</button>
                  <button
                    type="button"
                    disabled={collectionMutation.isPending}
                    onClick={() => collectionMutation.mutate({ collectionId: collection.id, action: "state", payload: { action: collection.isActive ? "archive" : "reactivate" } })}
                    className="text-sm font-semibold text-[#C61F2A]"
                  >
                    {collection.isActive ? "Archive" : "Reactivate"}
                  </button>
                </div>
              </article>
            ))}
            {!collectionsQuery.isPending && collections.length === 0 && <p className="text-sm text-slate-600">No collections yet.</p>}
          </div>
        </div>
        <div className="flex flex-col gap-5 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">
              Store management
            </p>
            <h2
              id="catalog-management-heading"
              className="mt-1 text-2xl font-extrabold text-[#123A7A]"
            >
              Store products
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Manage product identity, media, visibility, and sellable stock.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="min-h-11 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white"
          >
            Add product
          </button>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_auto]">
          <label className="text-sm font-semibold text-slate-700">
            <span className="mb-1 block">Find a product</span>
            <span className="relative block">
              <input
                value={search}
                onChange={(event) =>
                  updateQuery({ search: event.target.value, page: undefined })
                }
                placeholder="Search by name or handle"
                className="min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 pr-10 font-normal"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear product search"
                  onClick={() =>
                    updateQuery({ search: undefined, page: undefined })
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-900"
                >
                  <X size={17} />
                </button>
              )}
            </span>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            <span className="mb-1 block">Visibility</span>
            <span className="relative block">
              <select
                aria-label="Visibility"
                value={isActive == null ? "" : String(isActive)}
                onChange={(event) =>
                  updateQuery({ active: event.target.value, page: undefined })
                }
                className="min-h-11 w-full appearance-none rounded-md border border-slate-300 bg-white px-3 py-2 pr-9 font-normal"
              >
                <option value="">All products</option>
                <option value="true">Active only</option>
                <option value="false">Archived only</option>
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                size={16}
                aria-hidden="true"
              />
            </span>
          </label>
          <div className="flex items-end text-sm text-slate-600">
            {totalCount > 0
              ? `Showing ${rangeStart}-${rangeEnd} of ${totalCount}`
              : "No products yet"}
          </div>
        </div>
        {mutation.isError && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {mutation.error?.message || "Catalog update failed."}
          </p>
        )}
        {catalogQuery.isPending && (
          <p className="mt-5 text-sm text-slate-600" role="status">
            Loading store products...
          </p>
        )}
        {catalogQuery.isError && (
          <p
            role="alert"
            className="mt-5 rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {catalogQuery.error.message}
          </p>
        )}
        {!catalogQuery.isPending &&
          !catalogQuery.isError &&
          products.length === 0 && (
            <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <p className="font-semibold text-slate-900">
                {search || isActive !== undefined
                  ? "No products match these filters."
                  : "No products have been added yet."}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {search || isActive !== undefined
                  ? "Try clearing the filters or search for another product."
                  : "Create your first product to start selling."}
              </p>
              <button
                type="button"
                onClick={
                  search || isActive !== undefined
                    ? () =>
                        updateQuery({
                          search: undefined,
                          active: undefined,
                          page: undefined,
                        })
                    : openCreate
                }
                className="mt-4 min-h-10 rounded-md border border-[#123A7A] px-3 py-2 text-sm font-semibold text-[#123A7A]"
              >
                {search || isActive !== undefined
                  ? "Clear filters"
                  : "Add product"}
              </button>
            </div>
          )}
        {products.length > 0 && (
          <>
            <div className="mt-5 space-y-3 md:hidden">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onEdit={openEdit}
                  onAdjust={setStockTarget}
                />
              ))}
            </div>
            <div className="mt-5 hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th scope="col" className="px-3 py-2">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Price
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Stock
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Visibility
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      onEdit={openEdit}
                      onAdjust={setStockTarget}
                      mutation={mutation}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {totalPages > 1 && (
          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => updateQuery({ page: page - 1 })}
              className="inline-flex min-h-10 items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            <span className="text-sm text-slate-600">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => updateQuery({ page: page + 1 })}
              className="inline-flex min-h-10 items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </section>
      <Modal
        open={isCollectionFormOpen}
        onClose={() => setIsCollectionFormOpen(false)}
        ariaLabel={editingCollection ? "Edit collection" : "Add a collection"}
      >
        <form onSubmit={submitCollection} className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">{editingCollection ? "Edit collection" : "Add a collection"}</h3>
              <p className="mt-1 text-sm text-slate-600">Collections can be archived without deleting their products.</p>
            </div>
            <button type="button" aria-label="Close collection form" onClick={() => setIsCollectionFormOpen(false)} className="rounded-md border border-slate-300 p-2 text-slate-600"><X size={18} /></button>
          </div>
          {[
            ["handle", "Collection handle", "Lowercase URL handle"],
            ["title", "Collection name", "Customer-facing name"],
            ["sortOrder", "Display order", "0"],
          ].map(([field, label, placeholder]) => (
            <label key={field} className="block text-sm font-semibold text-slate-700">
              <span className="mb-1 block">{label}</span>
              <input required={field !== "sortOrder"} type={field === "sortOrder" ? "number" : "text"} min={field === "sortOrder" ? "0" : undefined} value={collectionForm[field]} placeholder={placeholder} onChange={(event) => setCollectionForm((current) => ({ ...current, [field]: event.target.value }))} className="min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" />
            </label>
          ))}
          <label className="block text-sm font-semibold text-slate-700">
            <span className="mb-1 block">Description</span>
            <textarea value={collectionForm.description} onChange={(event) => setCollectionForm((current) => ({ ...current, description: event.target.value }))} rows={4} className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <button type="submit" disabled={collectionMutation.isPending} className="min-h-11 rounded-md bg-[#123A7A] px-4 py-2 font-semibold text-white disabled:opacity-60">{collectionMutation.isPending ? "Saving..." : editingCollection ? "Save collection changes" : "Add collection"}</button>
        </form>
      </Modal>
      <Modal
        open={isProductFormOpen}
        onClose={closeProductForm}
        ariaLabel={editingProduct ? "Edit product" : "Add a product"}
      >
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {editingProduct ? "Edit product" : "Add a product"}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Identity, pricing, and media are managed here. Stock is adjusted
                separately.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close product form"
              onClick={closeProductForm}
              className="rounded-md border border-slate-300 p-2 text-slate-600"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              [
                "variantRef",
                "Variant reference",
                "Internal product or variant ID",
              ],
              ["handle", "Product handle", "Lowercase URL handle"],
              ["title", "Product name", "Customer-facing name"],
              ["priceAmount", "Price (EUR)", "Selling price"],
              ["sku", "SKU", "Optional stock-keeping reference"],
            ].map(([field, label, hint]) => (
              <label
                key={field}
                className="text-sm font-semibold text-slate-700"
              >
                <span className="mb-1 block">{label}</span>
                <input
                  required={[
                    "variantRef",
                    "handle",
                    "title",
                    "priceAmount",
                  ].includes(field)}
                  value={form[field]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                  placeholder={hint}
                  type={field === "priceAmount" ? "number" : "text"}
                  step={field === "priceAmount" ? "0.01" : undefined}
                  min={field === "priceAmount" ? "0" : undefined}
                  className="min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
                />
              </label>
            ))}
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            <span className="mb-1 block">Description</span>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Customer-facing product description"
              rows={4}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            <span className="mb-1 block">Collection</span>
            <select
              value={form.collectionId}
              onChange={(event) => setForm((current) => ({ ...current, collectionId: event.target.value }))}
              className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal"
            >
              <option value="">No collection</option>
              {collections.filter((collection) => collection.isActive || String(collection.id) === String(form.collectionId)).map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.title}</option>
              ))}
            </select>
          </label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-slate-900">Product images</h4>
                <p className="mt-1 text-xs text-slate-600">
                  PNG, JPG, JPEG, or WEBP up to 10MB each.
                </p>
              </div>
              <ImagePlus size={20} className="text-[#123A7A]" />
            </div>
            {visibleFormImages.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {visibleFormImages.map((image, index) => (
                  <div
                    key={image.id}
                    className="relative overflow-hidden rounded-md border bg-white"
                  >
                    <img
                      src={image.url}
                      alt={image.alt || ""}
                      className="aspect-square w-full object-cover"
                    />
                    <div className="flex items-center justify-between p-1">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Move image ${index + 1} earlier`}
                          disabled={index === 0}
                          onClick={() => moveImage(index, -1)}
                          className="rounded p-1 text-slate-600 disabled:opacity-30"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move image ${index + 1} later`}
                          disabled={index === visibleFormImages.length - 1}
                          onClick={() => moveImage(index, 1)}
                          className="rounded p-1 text-slate-600 disabled:opacity-30"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove image ${index + 1}`}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              existingImages: current.existingImages.filter(
                                (item) => item.id !== image.id,
                              ),
                              removedImageIds: [
                                ...current.removedImageIds,
                                image.id,
                              ],
                              imageOrder: current.imageOrder.filter(
                                (id) => id !== image.id,
                              ),
                            }))
                          }
                          className="rounded p-1 text-red-700"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {index + 1}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {newImagePreviews.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {newImagePreviews.map(({ file, url }) => (
                  <div
                    key={`${file.name}-${file.lastModified}`}
                    className="overflow-hidden rounded-md border bg-white"
                  >
                    <img
                      src={url}
                      alt=""
                      className="aspect-square w-full object-cover"
                    />
                    <p className="truncate p-1 text-[10px] text-slate-500">
                      {file.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <label className="mt-3 block text-sm font-semibold text-slate-700">
              <span className="sr-only">Add product images</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={selectImages}
                className="block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
            {imageError && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {imageError}
              </p>
            )}
            {form.images.length > 0 && (
              <p className="mt-2 text-xs text-slate-600">
                {form.images.length} new image(s) selected.
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={mutation.isPending || Boolean(imageError)}
            className="min-h-11 rounded-md bg-[#123A7A] px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {mutation.isPending
              ? "Saving..."
              : editingProduct
                ? "Save product changes"
                : "Add product"}
          </button>
        </form>
      </Modal>
      <Modal
        open={Boolean(stockTarget)}
        onClose={() => setStockTarget(null)}
        ariaLabel="Adjust stock"
      >
        {stockTarget && (
          <form onSubmit={adjustStock} className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Adjust stock
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {stockTarget.title} currently has {stockTarget.availableQty}{" "}
                  available.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close stock adjustment"
                onClick={() => setStockTarget(null)}
                className="rounded-md border p-2"
              >
                <X size={18} />
              </button>
            </div>
            <label className="block text-sm font-semibold text-slate-700">
              Quantity change
              <input
                required
                type="number"
                value={stockDelta}
                onChange={(event) => setStockDelta(event.target.value)}
                placeholder="e.g. 10 or -2"
                className="mt-1 min-h-11 w-full rounded-md border px-3 py-2 font-normal"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Reason
              <input
                required
                value={stockReason}
                onChange={(event) => setStockReason(event.target.value)}
                placeholder="Why is stock changing?"
                className="mt-1 min-h-11 w-full rounded-md border px-3 py-2 font-normal"
              />
            </label>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="min-h-11 rounded-md bg-[#123A7A] px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {mutation.isPending ? "Updating..." : "Confirm stock update"}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}

function ProductRow({ product, onEdit, onAdjust, mutation }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-3">
        <div className="flex items-center gap-3">
          <ProductThumbnail product={product} />
          <div className="font-semibold">
            {product.title}
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {product.handle}
              {product.sku ? ` · ${product.sku}` : ""}
            </span>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 tabular-nums">
        {product.currencyCode} {product.priceAmount}
      </td>
      <td className="px-3 py-3">
        <span
          className={
            product.availableQty < 5 ? "font-semibold text-amber-700" : ""
          }
        >
          {product.availableQty} available
        </span>
        <span className="mt-1 block text-xs text-slate-500">
          {product.reservedQty} reserved
        </span>
      </td>
      <td className="px-3 py-3">{product.isActive ? "Active" : "Archived"}</td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-label={`Adjust stock for ${product.title}`}
            onClick={() => onAdjust(product)}
            className="min-h-10 rounded-md border px-3 py-2 text-xs font-semibold"
          >
            Adjust stock
          </button>
          <button
            type="button"
            onClick={() => onEdit(product)}
            className="min-h-10 px-2 py-2 text-xs font-semibold text-[#123A7A]"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                productId: product.id,
                action: "state",
                payload: {
                  action: product.isActive ? "archive" : "reactivate",
                },
              })
            }
            className="min-h-10 px-2 py-2 text-xs font-semibold text-[#C61F2A]"
          >
            {product.isActive ? "Archive" : "Reactivate"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function ProductCard({ product, onEdit, onAdjust }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <ProductThumbnail product={product} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900">{product.title}</h3>
          <p className="mt-1 truncate text-xs text-slate-500">
            {product.handle}
          </p>
          <p className="mt-2 text-sm font-semibold">
            {product.currencyCode} {product.priceAmount}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">
          {product.isActive ? "Active" : "Archived"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="block text-xs text-slate-500">Available</span>
          <span
            className={
              product.availableQty < 5
                ? "font-semibold text-amber-700"
                : "font-semibold"
            }
          >
            {product.availableQty}
          </span>
        </div>
        <div>
          <span className="block text-xs text-slate-500">Reserved</span>
          <span className="font-semibold">{product.reservedQty}</span>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          aria-label={`Adjust stock for ${product.title}`}
          onClick={() => onAdjust(product)}
          className="min-h-10 flex-1 rounded-md border px-3 py-2 text-sm font-semibold"
        >
          Adjust stock
        </button>
        <button
          type="button"
          onClick={() => onEdit(product)}
          className="min-h-10 rounded-md border border-[#123A7A] px-3 py-2 text-sm font-semibold text-[#123A7A]"
        >
          Edit
        </button>
      </div>
    </article>
  );
}

function ProductThumbnail({ product }) {
  const image = product.images?.[0]?.url || product.imageUrl;
  return image ? (
    <img
      src={image}
      alt=""
      className="h-12 w-12 shrink-0 rounded-md border border-slate-200 object-cover"
    />
  ) : (
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-[10px] font-semibold uppercase text-slate-400">
      No image
    </div>
  );
}
